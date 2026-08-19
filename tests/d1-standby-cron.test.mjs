import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const worker = fs.readFileSync("worker/index.ts", "utf8");
const wrangler = fs.readFileSync("wrangler.jsonc", "utf8");

test("Cloudflare schedules standby maintenance as separate invocations", () => {
  assert.match(wrangler, /"\*\/15 \* \* \* \*"/);
  assert.match(wrangler, /"5,20,35,50 \* \* \* \*"/);
  assert.match(wrangler, /"10,25,40,55 \* \* \* \*"/);
  assert.match(worker, /async scheduled\(/);
  assert.match(worker, /controller\.cron/);
});

test("each cron dispatches exactly one bounded standby maintenance slice", () => {
  assert.match(worker, /cron === operationalReconciliationCron[\s\S]*await reconcileD1Standby\(\)/);
  assert.match(worker, /cron === telemetryReconciliationCron[\s\S]*await reconcileD1Telemetry\(\)/);
  assert.match(worker, /cron === historyBackfillCron[\s\S]*await backfillD1DeliveryHistory\(\)/);
  assert.doesNotMatch(worker, /Promise\.all\(\[\s*reconcileD1Standby/);
});

test("scheduled maintenance failures are surfaced instead of swallowed", () => {
  assert.match(worker, /scheduled standby maintenance failed/);
  assert.match(worker, /throw error/);
});
