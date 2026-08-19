import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const runtimeWorkflow = new URL("../.github/workflows/runtime-schema-safety.yml", import.meta.url);
const deployWorkflow = new URL("../.github/workflows/cloudflare-production-deploy.yml", import.meta.url);

const criticalRegressionTests = [
  "runtime-schema-safety.test.mjs",
  "postgres-query-budget.test.mjs",
  "micro-batcher.test.mjs",
  "postgres-read-batching.test.mjs",
  "bulk-delivery-import.test.mjs",
  "operational-alerts.test.mjs",
  "storage-schema-health.test.mjs",
  "quick-tools-navigation.test.mjs",
  "telemetry-growth.test.mjs",
  "telemetry-retention.test.mjs",
  "retention-heartbeat.test.mjs",
  "tenant-data-export.test.mjs",
  "operational-delivery-window.test.mjs",
  "release-gate-contract.test.mjs",
];

test("runtime safety gate includes every recent production regression", async () => {
  const source = await readFile(runtimeWorkflow, "utf8");
  for (const filename of criticalRegressionTests) {
    assert.ok(source.includes(filename), `runtime safety gate is missing ${filename}`);
  }
});

test("runtime safety validates the same shared Postgres Cloudflare build used in production", async () => {
  const source = await readFile(runtimeWorkflow, "utf8");
  assert.match(source, /TRACKFLEET_STORAGE:\s*postgres/);
  assert.match(source, /pnpm exec vinext build/);
});

test("Cloudflare deployment requires both validation workflows for the same commit", async () => {
  const source = await readFile(deployWorkflow, "utf8");
  assert.match(source, /workflows:\s*\["Platform build check"\]/);
  assert.match(source, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(source, /Runtime schema safety/);
  assert.match(source, /head_sha=\$RELEASE_SHA/);
  assert.match(source, /conclusion\" = \"success/);
  assert.match(source, /Production deployment is blocked/);
});

test("post-deploy verification requires persistent Postgres health", async () => {
  const source = await readFile(deployWorkflow, "utf8");
  assert.match(source, /health\?\.ok === true/);
  assert.match(source, /health\?\.storage\?\.mode === "postgres"/);
  assert.match(source, /health\?\.storage\?\.connected === true/);
});
