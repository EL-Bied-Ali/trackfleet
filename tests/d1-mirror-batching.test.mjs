import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const queueSource = await readFile(new URL("../app/lib/d1-mirror-queue.ts", import.meta.url), "utf8");
const sharedPostgresStore = await readFile(new URL("../app/lib/delivery-store.shared-postgres.ts", import.meta.url), "utf8");
const workerSource = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");

test("queueing a D1 mirror statement never performs I/O itself -- only flush does", () => {
  // Regression guard: a single automation tick mirroring 6 vehicles' worth
  // of positions/ETAs/deliveries used to cost one D1 subrequest per record
  // (15-20+ per tick), which combined with the rest of the tick's Postgres
  // writes reliably exceeded Cloudflare's per-invocation subrequest limit --
  // reproduced live via wrangler tail, which kept tripping the D1 read-only
  // failover safety net app-wide.
  assert.match(queueSource, /export function queueD1Mirror\(statement: D1MirrorStatement\) \{\s*pending\.push\(statement\);\s*\}/);
});

test("flushing sends every queued statement in a single db.batch() call", () => {
  assert.match(queueSource, /await db\.batch\(batch\);/);
  assert.doesNotMatch(queueSource, /for \(.*of.*batch.*\)[\s\S]*\.run\(\)/);
});

test("a flush failure is logged but never thrown, matching the existing best-effort mirror contract", () => {
  const flushBody = queueSource.slice(queueSource.indexOf("export async function flushD1MirrorQueue"));
  assert.match(flushBody, /catch \(error\) \{\s*console\.error/);
  assert.doesNotMatch(flushBody, /catch \(error\) \{\s*console\.error[\s\S]*?throw/);
});

test("mirror functions queue statements instead of running them individually", () => {
  assert.doesNotMatch(sharedPostgresStore, /\.run\(\)/);
  assert.match(sharedPostgresStore, /queueD1Mirror\(db\.prepare/);
  const mirrorCount = (sharedPostgresStore.match(/queueD1Mirror\(/g) ?? []).length;
  assert.ok(mirrorCount >= 7, `expected at least 7 queued mirror writes, found ${mirrorCount}`);
});

test("the Worker flushes the mirror queue after every request and every scheduled tick", () => {
  // Interactive requests: flushed via waitUntil so batching adds no latency
  // to the response. Scheduled ticks: flushed in a finally block, awaited,
  // since there's no waitUntil extension point after scheduled() returns --
  // it must flush before the invocation ends, whether the tick succeeded or not.
  assert.match(workerSource, /ctx\.waitUntil\(flushD1MirrorQueue\(\)\)/);
  assert.match(workerSource, /finally \{[\s\S]*await flushD1MirrorQueue\(\);[\s\S]*\}/);
});
