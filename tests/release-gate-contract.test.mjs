import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const runtimeWorkflow = new URL("../.github/workflows/runtime-schema-safety.yml", import.meta.url);
const deployWorkflow = new URL("../.github/workflows/cloudflare-production-deploy.yml", import.meta.url);
const smokeWorkflow = new URL("../.github/workflows/deployed-smoke-test.yml", import.meta.url);
const automationWorkflow = new URL("../.github/workflows/automation-tick.yml", import.meta.url);

const criticalRegressionTests = [
  "runtime-schema-safety.test.mjs",
  "postgres-query-budget.test.mjs",
  "micro-batcher.test.mjs",
  "postgres-read-batching.test.mjs",
  "bulk-delivery-import.test.mjs",
  "delivery-idempotency.test.mjs",
  "operational-alerts.test.mjs",
  "storage-schema-health.test.mjs",
  "quick-tools-navigation.test.mjs",
  "telemetry-growth.test.mjs",
  "telemetry-retention.test.mjs",
  "retention-heartbeat.test.mjs",
  "tenant-data-export.test.mjs",
  "full-history-export-scaling.test.mjs",
  "operational-delivery-window.test.mjs",
  "delivery-history-pagination.test.mjs",
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

test("production deploy publishes observable Cloudflare and D1 commit statuses", async () => {
  const source = await readFile(deployWorkflow, "utf8");
  assert.match(source, /statuses:\s*write/);
  assert.match(source, /context="trackfleet\/cloudflare-production"/);
  assert.match(source, /context="trackfleet\/d1-standby"/);
  assert.match(source, /failover\?\.ready === true/);
  assert.match(source, /failover\?\.reason === "replication_ready"/);
  assert.match(source, /failover\?\.automatic === true/);
  assert.match(source, /if: always\(\)/);
});

test("client smoke test targets Cloudflare and checks launch readiness", async () => {
  const source = await readFile(smokeWorkflow, "utf8");
  assert.match(source, /https:\/\/trackfleet\.chronoplan\.workers\.dev/);
  assert.match(source, /storage\?\.mode !== "postgres"/);
  assert.match(source, /storage\?\.persistent !== true/);
  assert.match(source, /storage\?\.connected !== true/);
  assert.match(source, /sessionEncryptionConfigured !== true/);
  assert.match(source, /sendatrackConfigured !== true/);
  assert.match(source, /automation\?\.tickProtected !== true/);
  assert.match(source, /api\/auth\/session/);
  assert.match(source, /input\[name="accountID"\]/);
  assert.match(source, /input\[name="password"\]/);
});

test("business automation defaults to the Cloudflare production origin", async () => {
  const source = await readFile(automationWorkflow, "utf8");
  assert.match(source, /TRACKFLEET_BASE_URL \|\| 'https:\/\/trackfleet\.chronoplan\.workers\.dev'/);
  assert.doesNotMatch(source, /trackfleet-self\.vercel\.app/);
});
