import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const [workflow, tickRoute, runner, smokeWorkflow] = await Promise.all([
  readFile(new URL("../.github/workflows/automation-tick.yml", import.meta.url), "utf8"),
  readFile(new URL("../app/api/automation/tick/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/notification-runner.ts", import.meta.url), "utf8"),
  readFile(new URL("../.github/workflows/deployed-smoke-test.yml", import.meta.url), "utf8"),
]);

test("scheduled automation defaults to the stable production hostname", () => {
  assert.match(workflow, /https:\/\/trackfleet-self\.vercel\.app/);
  assert.match(workflow, /TRACKFLEET_BASE_URL/);
  assert.match(workflow, /\/api\/automation\/tick/);
});

test("scheduled automation requires a protected bearer secret", () => {
  assert.match(workflow, /secrets\.TRACKFLEET_CRON_SECRET/);
  assert.match(workflow, /authorization: `Bearer \$\{secret\}`/);
  assert.match(tickRoute, /runtimeEnv\.CRON_SECRET/);
  assert.match(tickRoute, /authorization/);
  assert.match(tickRoute, /Bearer \$\{secret\}/);
});

test("scheduler refuses to tick until the complete health contract is ready", () => {
  assert.match(workflow, /health\?\.automation\?\.ready !== true/);
  assert.match(workflow, /sendatrackConfigured/);
  assert.match(workflow, /production_not_ready/);
});

test("tracking links inherit the stable scheduler request origin and require private tokens", () => {
  assert.match(tickRoute, /runFleetAutomation\(new URL\(request\.url\)\.origin\)/);
  assert.match(runner, /const trackingUrl = new URL\(origin\)/);
  assert.match(runner, /searchParams\.set\(["']tracking["'], item\.delivery\.trackingToken\)/);
  assert.doesNotMatch(runner, /trackingToken \|\| item\.delivery\.id/);
});

test("expensive deployed browser smoke test is manual-only", () => {
  assert.match(smokeWorkflow, /workflow_dispatch:/);
  assert.doesNotMatch(smokeWorkflow, /\n\s+push:/);
});
