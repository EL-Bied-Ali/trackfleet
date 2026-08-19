import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const [automationSource, tickRoute, heartbeatStore, healthRoute] = await Promise.all([
  readFile(new URL("../app/lib/server-automation.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/automation/tick/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/automation-heartbeat.vercel.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/health/route.ts", import.meta.url), "utf8"),
]);

test("a disconnected SENDATRACK snapshot is an automation failure", () => {
  assert.match(automationSource, /if \(!snapshot\.connected\) throw new Error\("sendatrack_snapshot_disconnected"\)/);
  assert.doesNotMatch(automationSource, /if \(!snapshot\.connected\) \{[\s\S]*connected:\s*false/);
});

test("tick records success only after runFleetAutomation resolves", () => {
  const runIndex = tickRoute.indexOf("await runFleetAutomation(");
  const successIndex = tickRoute.indexOf('bestEffortHeartbeat("success"');
  const failureIndex = tickRoute.indexOf('bestEffortHeartbeat("failure"');
  assert.ok(runIndex >= 0);
  assert.ok(successIndex > runIndex);
  assert.ok(failureIndex > runIndex);
});

test("provider failures are classified into bounded non-secret codes", () => {
  for (const code of [
    "sendatrack_authentication_failed",
    "sendatrack_service_unavailable",
    "sendatrack_unexpected_response",
    "sendatrack_not_configured",
    "sendatrack_disconnected",
    "automation_failed",
  ]) {
    assert.match(heartbeatStore, new RegExp(`\\"${code}\\"`));
  }
  assert.match(tickRoute, /failureCodeFor\(message\)/);
  assert.match(tickRoute, /recordAutomationFailure\(failureCode\)/);
  assert.doesNotMatch(healthRoute, /error:\s*message/);
  assert.match(healthRoute, /lastFailureCode/);
});

test("failure diagnostics reuse heartbeat rows without schema expansion", () => {
  assert.match(heartbeatStore, /fleet_tick_failure:\$\{code\}/);
  assert.match(heartbeatStore, /id LIKE 'fleet_tick_failure:%'/);
  assert.doesNotMatch(heartbeatStore, /ALTER TABLE/);
});
