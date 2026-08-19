import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadMicroBatcher() {
  const source = await readFile(new URL("../app/lib/micro-batcher.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("exports", output)(exports);
  return exports;
}

test("record batcher collapses concurrent calls into one loader invocation", async () => {
  const { createRecordBatcher } = await loadMicroBatcher();
  let calls = 0;
  let loadedKeys = [];
  const batched = createRecordBatcher(async (keys) => {
    calls += 1;
    loadedKeys = keys;
    return Object.fromEntries(keys.map((key) => [key, key.toUpperCase()]));
  }, () => "missing");

  const values = await Promise.all(Array.from({ length: 50 }, (_, index) => batched(`key-${index % 10}`)));
  assert.equal(calls, 1);
  assert.equal(loadedKeys.length, 10);
  assert.equal(values[0], "KEY-0");
  assert.equal(values[11], "KEY-1");
});

test("record batcher starts a new batch after the previous microtask wave", async () => {
  const { createRecordBatcher } = await loadMicroBatcher();
  let calls = 0;
  const batched = createRecordBatcher(async (keys) => {
    calls += 1;
    return Object.fromEntries(keys.map((key) => [key, key]));
  }, () => "");

  await batched("first");
  await batched("second");
  assert.equal(calls, 2);
});

test("limited array batcher uses one max-limit query and slices per caller", async () => {
  const { createLimitedArrayBatcher } = await loadMicroBatcher();
  let calls = 0;
  let observedMaxLimit = 0;
  const batched = createLimitedArrayBatcher(async (keys, maxLimit) => {
    calls += 1;
    observedMaxLimit = maxLimit;
    return Object.fromEntries(keys.map((key) => [key, Array.from({ length: maxLimit }, (_, index) => `${key}-${index}`)]));
  }, (limit) => Math.max(1, Math.min(20, Math.round(limit ?? 3))));

  const [short, long, duplicate] = await Promise.all([
    batched("delivery-a", 2),
    batched("delivery-b", 7),
    batched("delivery-a", 4),
  ]);

  assert.equal(calls, 1);
  assert.equal(observedMaxLimit, 7);
  assert.deepEqual(short, ["delivery-a-0", "delivery-a-1"]);
  assert.equal(long.length, 7);
  assert.equal(duplicate.length, 4);
});

test("batch loader failures reject every waiting caller", async () => {
  const { createRecordBatcher } = await loadMicroBatcher();
  const batched = createRecordBatcher(async () => { throw new Error("database down"); }, () => []);
  const results = await Promise.allSettled([batched("a"), batched("b"), batched("a")]);
  assert.ok(results.every((result) => result.status === "rejected"));
  assert.ok(results.every((result) => result.status !== "rejected" || result.reason.message === "database down"));
});
