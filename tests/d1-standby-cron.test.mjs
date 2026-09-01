import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const worker = fs.readFileSync("worker/index.ts", "utf8");
const wrangler = fs.readFileSync("wrangler.jsonc", "utf8");

test("Cloudflare schedules automation and standby maintenance as separate invocations", () => {
  assert.match(wrangler, /"\*\/15 \* \* \* \*"/);
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

// D1 rows_written actually hit the free-tier 100k/day cap on 2026-09-02,
// even after the reconciliation-cron fix the day before -- the automation
// tick's own D1 mirror writes (position/status/ETA per vehicle, every tick)
// were still a meaningful, legitimate contributor. Slowed from every 5
// minutes to every 15: a multi-day Belgium-Morocco corridor doesn't need
// sub-15-minute position granularity the way a last-mile delivery would.
// Deliberately NOT reduced further overnight -- see the comment on
// automationCron in worker/index.ts for why (ferry crossing can complete at
// any hour; delaying arrival detection for a modest extra saving isn't
// worth the risk).
test("the fleet-sync and notification-maintenance crons both run every 15 minutes, not every 5", () => {
  assert.match(worker, /const automationCron = "\*\/15 \* \* \* \*";/);
  assert.doesNotMatch(worker, /const automationCron = "\*\/5 \* \* \* \*";/);
});

test("the dashboard's own copy honestly reflects the 15-minute cadence, not the old 30-second claim", () => {
  const i18n = fs.readFileSync("app/i18n.ts", "utf8");
  assert.match(i18n, /sendatrackRefreshing: "SENDATRACK positions refresh automatically every 15 minutes",/);
  assert.match(i18n, /sendatrackRefreshing: "Positions SENDATRACK actualisées automatiquement toutes les 15 minutes",/);
  assert.match(i18n, /sendatrackRefreshing: "SENDATRACK-posities worden elke 15 minuten automatisch vernieuwd",/);
  assert.doesNotMatch(i18n, /every 30 seconds|toutes les 30 secondes|elke 30 seconden/);
});
