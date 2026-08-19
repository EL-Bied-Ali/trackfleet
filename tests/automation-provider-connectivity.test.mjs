import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const [automationSource, tickRoute] = await Promise.all([
  readFile(new URL("../app/lib/server-automation.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/automation/tick/route.ts", import.meta.url), "utf8"),
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
