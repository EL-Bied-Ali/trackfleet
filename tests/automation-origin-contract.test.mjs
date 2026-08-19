import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const [workflow, tickRoute, worker, runner, smokeWorkflow] = await Promise.all([
  readFile(new URL("../.github/workflows/automation-tick.yml", import.meta.url), "utf8"),
  readFile(new URL("../app/api/automation/tick/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/notification-runner.ts", import.meta.url), "utf8"),
  readFile(new URL("../.github/workflows/deployed-smoke-test.yml", import.meta.url), "utf8"),
]);

test("automation heartbeat audit defaults to the stable production hostname", () => {
  assert.match(workflow, /https:\/\/trackfleet\.chronoplan\.workers\.dev/);
  assert.match(workflow, /TRACKFLEET_BASE_URL/);
  assert.match(workflow, /\/api\/health/);
  assert.doesNotMatch(workflow, /\/api\/automation\/tick/);
});

test("native Cloudflare scheduler calls the protected tick route with the Worker secret", () => {
  assert.match(worker, /\/api\/automation\/tick/);
  assert.match(worker, /Bearer \$\{secret\}/);
  assert.match(tickRoute, /runtimeEnv\.CRON_SECRET/);
  assert.match(tickRoute, /authorization/);
  assert.match(tickRoute, /Bearer \$\{secret\}/);
  assert.doesNotMatch(workflow, /secrets\.TRACKFLEET_CRON_SECRET/);
});

test("automation failures are logged server-side but not reflected to callers", () => {
  assert.match(tickRoute, /console\.error\("\[trackfleet:automation\] tick failed", \{ message \}\)/);
  assert.match(tickRoute, /error: "automation_failed"/);
  assert.doesNotMatch(tickRoute, /error: message/);
});

test("GitHub audits readiness and liveness without executing production automation", () => {
  assert.match(workflow, /automation\.ready === true/);
  assert.match(workflow, /automation\.live === true/);
  assert.match(workflow, /heartbeatAvailable/);
  assert.match(workflow, /trackfleet\/automation-heartbeat/);
  assert.doesNotMatch(workflow, /production_not_ready/);
});

test("tracking links inherit the stable tick request origin and require private tokens", () => {
  assert.match(tickRoute, /runFleetAutomation\(new URL\(request\.url\)\.origin\)/);
  assert.match(runner, /const trackingUrl = new URL\(origin\)/);
  assert.match(runner, /searchParams\.set\(["']tracking["'], item\.delivery\.trackingToken\)/);
  assert.doesNotMatch(runner, /trackingToken \|\| item\.delivery\.id/);
});

test("expensive deployed browser smoke test is manual-only", () => {
  assert.match(smokeWorkflow, /workflow_dispatch:/);
  assert.doesNotMatch(smokeWorkflow, /\n\s+push:/);
});
