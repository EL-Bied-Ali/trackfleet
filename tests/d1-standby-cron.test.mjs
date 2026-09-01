import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const worker = fs.readFileSync("worker/index.ts", "utf8");
const wrangler = fs.readFileSync("wrangler.jsonc", "utf8");

test("Cloudflare schedules automation and standby maintenance as separate invocations", () => {
  assert.match(wrangler, /"\*\/5 \* \* \* \*"/);
  assert.match(wrangler, /"18 \* \* \* \*"/);
  assert.match(wrangler, /"48 \* \* \* \*"/);
  assert.match(wrangler, /"10,25,40,55 \* \* \* \*"/);
  assert.match(worker, /async scheduled\(/);
  assert.match(worker, /controller\.cron/);
});

test("native automation cron uses the Worker secret and the protected internal tick route", () => {
  assert.match(worker, /cron === automationCron[\s\S]*await runAutomationTick\(env, ctx\)/);
  assert.match(worker, /env\.CRON_SECRET\?\.trim\(\)/);
  assert.match(worker, /new Request\(`\$\{productionOrigin\}\/api\/automation\/tick`/);
  assert.match(worker, /authorization: `Bearer \$\{secret\}`/);
  assert.match(worker, /if \(!response\.ok\) throw new Error\(`automation_tick_http_\$\{response\.status\}`\)/);
});

test("each standby cron dispatches exactly one bounded maintenance slice", () => {
  assert.match(worker, /cron === operationalReconciliationCron[\s\S]*await reconcileD1StandbySafely\(\)/);
  assert.match(worker, /cron === telemetryReconciliationCron[\s\S]*await reconcileD1Telemetry\(\)/);
  assert.match(worker, /cron === historyBackfillCron[\s\S]*await backfillD1DeliveryHistory\(\)/);
  assert.doesNotMatch(worker, /Promise\.all\(\[\s*reconcileD1StandbySafely/);
});

test("scheduled task failures are surfaced instead of swallowed", () => {
  assert.match(worker, /scheduled task failed/);
  assert.match(worker, /throw error/);
});
