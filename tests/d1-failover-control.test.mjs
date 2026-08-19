import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow = fs.readFileSync(".github/workflows/cloudflare-d1-failover-control.yml", "utf8");
const health = fs.readFileSync("app/lib/storage-health.ts", "utf8");
const envExample = fs.readFileSync(".env.example", "utf8");

test("production failover control is manual and defaults disabled", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\npush:/);
  assert.match(workflow, /default: "false"/);
  assert.match(workflow, /options:[\s\S]*- "false"[\s\S]*- "true"/);
  assert.match(envExample, /TRACKFLEET_D1_READ_FAILOVER=false/);
});

test("enable is refused unless the real production standby is fully ready", () => {
  assert.match(workflow, /if: \$\{\{ inputs\.enabled == 'true' \}\}/);
  assert.match(workflow, /\/api\/health/);
  assert.match(workflow, /failover\?\.connected !== true/);
  assert.match(workflow, /failover\?\.ready !== true/);
  assert.match(workflow, /failover\?\.reason !== "replication_ready"/);
  assert.match(workflow, /operationalFresh !== true/);
  assert.match(workflow, /telemetryFresh !== true/);
  assert.match(workflow, /history\?\.complete !== true/);
});

test("control persists a true or false Cloudflare secret and verifies health afterwards", () => {
  assert.match(workflow, /wrangler secret put TRACKFLEET_D1_READ_FAILOVER --name trackfleet/);
  assert.match(workflow, /printf '%s' "\$\{\{ inputs\.enabled \}\}"/);
  assert.match(workflow, /failover\?\.automatic === expected/);
  assert.match(workflow, /!expected \|\| \(failover\?\.ready === true && failover\?\.reason === "replication_ready"\)/);
  assert.match(health, /const automatic = d1ReadFailoverConfigured\(\)/);
});

test("disabling never depends on standby readiness", () => {
  const readinessGate = workflow.match(/- name: Require ready production D1 standby before enabling[\s\S]*?\n\s*- name: Set persistent Cloudflare failover flag/)?.[0] ?? "";
  assert.match(readinessGate, /inputs\.enabled == 'true'/);
  assert.doesNotMatch(workflow, /inputs\.enabled == 'false'[\s\S]*replication_ready/);
});
