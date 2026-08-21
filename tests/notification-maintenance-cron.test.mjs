import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const worker = fs.readFileSync("worker/index.ts", "utf8");
const wrangler = fs.readFileSync("wrangler.jsonc", "utf8");
const automationSource = fs.readFileSync("app/lib/server-automation.ts", "utf8");
const notificationTickRoute = fs.readFileSync("app/api/automation/notification-tick/route.ts", "utf8");

test("notification maintenance runs on its own cron, offset from fleet sync", () => {
  // Regression guard: notification sends and telemetry pruning used to run
  // inside the same invocation as fleet sync, competing for the same
  // subrequest budget -- reproduced live via wrangler tail, a tick that
  // finished fleet sync fine still failed to record success because the
  // notification/telemetry work tacked onto the same invocation pushed it
  // over Cloudflare's per-invocation subrequest limit.
  assert.match(wrangler, /"2,7,12,17,22,27,32,37,42,47,52,57 \* \* \* \*"/);
  assert.match(worker, /const notificationMaintenanceCron = "2,7,12,17,22,27,32,37,42,47,52,57 \* \* \* \*";/);
  assert.match(worker, /cron === notificationMaintenanceCron[\s\S]*await runNotificationMaintenanceTick\(env, ctx\)/);
  assert.match(worker, /https:\/\/trackfleet\.internal\/api\/automation\/notification-tick/);
});

test("fleet sync no longer sends notifications or prunes telemetry itself", () => {
  assert.doesNotMatch(automationSource, /processPendingNotifications/);
  assert.doesNotMatch(automationSource, /pruneTelemetry/);
  assert.match(automationSource, /runFleetBusinessTick/);
});

test("the notification maintenance tick is authenticated and heartbeats under its own job id, separate from fleet sync", () => {
  assert.match(notificationTickRoute, /runtimeEnv\.CRON_SECRET/);
  assert.match(notificationTickRoute, /authorization/);
  assert.match(notificationTickRoute, /const heartbeatJob = "notification_tick" as const;/);
  assert.match(notificationTickRoute, /recordRuntimeAttempt\(heartbeatJob\)/);
  assert.match(notificationTickRoute, /recordRuntimeSuccess\(heartbeatJob\)/);
  assert.match(notificationTickRoute, /recordRuntimeFailure\(heartbeatJob\)/);
});
