import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const platformWorkflow = new URL("../.github/workflows/vercel-build-check.yml", import.meta.url);
const deployWorkflow = new URL("../.github/workflows/cloudflare-production-deploy.yml", import.meta.url);

const criticalRegressionTests = [
  "env-value.test.mjs",
  "telemetry-retention.test.mjs",
  "runtime-schema-safety.test.mjs",
  "postgres-query-budget.test.mjs",
  "micro-batcher.test.mjs",
  "postgres-read-batching.test.mjs",
  "bulk-delivery-import.test.mjs",
  "operational-alerts.test.mjs",
  "storage-schema-health.test.mjs",
  "quick-tools-navigation.test.mjs",
  "release-gate-contract.test.mjs",
];

test("production platform gate includes recent critical regressions", async () => {
  const source = await readFile(platformWorkflow, "utf8");
  for (const filename of criticalRegressionTests) {
    assert.ok(source.includes(filename), `production gate is missing ${filename}`);
  }
});

test("Cloudflare validation build uses the same shared Postgres mode as production", async () => {
  const source = await readFile(platformWorkflow, "utf8");
  const cloudflareJob = source.slice(source.indexOf("  build-cloudflare:"));
  assert.match(cloudflareJob, /TRACKFLEET_STORAGE:\s*postgres/);
  assert.match(cloudflareJob, /pnpm exec vinext build/);
});

test("Cloudflare deploy remains gated by Platform build check and validates persistent Postgres health", async () => {
  const source = await readFile(deployWorkflow, "utf8");
  assert.match(source, /workflows:\s*\["Platform build check"\]/);
  assert.match(source, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(source, /health\?\.storage\?\.mode === "postgres"/);
  assert.match(source, /health\?\.storage\?\.connected === true/);
});
