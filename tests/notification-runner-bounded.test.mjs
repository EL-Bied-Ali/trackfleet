import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const runnerSource = await readFile(new URL("../app/lib/notification-runner.ts", import.meta.url), "utf8");
const maintenanceTickSource = await readFile(new URL("../app/lib/notification-maintenance-tick.ts", import.meta.url), "utf8");
const deliveriesRoute = await readFile(new URL("../app/api/deliveries/route.ts", import.meta.url), "utf8");

test("processPendingNotifications caps how many sends it attempts per call", () => {
  // Regression guard: a dispatcher GET request must never be able to time
  // out because of a WhatsApp/Meta backlog. Each send has its own
  // multi-second timeout (see whatsapp-automation.ts's metaRequestTimeoutMs),
  // and with no cap a large or currently-failing queue processed
  // sequentially can, on its own, consume the whole request budget --
  // reproduced live: /api/deliveries returned a Cloudflare "Worker exceeded
  // resource limits" 503 after test deliveries accumulated in the pending
  // queue while WHATSAPP_ACCESS_TOKEN was invalid.
  assert.match(runnerSource, /export async function processPendingNotifications\(companyId: string, origin: string, maxPerCall = defaultMaxNotificationsPerCall\)/);
  assert.match(runnerSource, /for \(const \{ item, parcelCount \} of representative\.slice\(0, maxPerCall\)\)/);
});

test("the ignored (non-WhatsApp) and superseded (older duplicate) housekeeping loops are also capped per call", () => {
  // Regression guard: the actionable loop above was capped after a live
  // "Worker exceeded resource limits" incident, but the ignored/superseded
  // loops process the same underlying pending queue and were left uncapped
  // -- each item still costs two DB round trips (claim + markSent), so a
  // sudden backlog (a large CSV import landing many REGISTERED events at
  // once, or automation having been disabled for a while) could reproduce
  // the same failure mode through a different door.
  assert.match(runnerSource, /const maxHousekeepingItemsPerCall = \d+;/);
  assert.match(runnerSource, /for \(const item of ignored\.slice\(0, maxHousekeepingItemsPerCall\)\)/);
  assert.match(runnerSource, /for \(const item of superseded\.slice\(0, maxHousekeepingItemsPerCall\)\)/);
  // Same reasoning applies to the redundant-parcel bucket a multi-parcel
  // shipment produces (see groupActionableByShipment in
  // notification-policy.ts) -- it's the same shape of "process the same
  // underlying pending queue" work as ignored/superseded.
  assert.match(runnerSource, /for \(const item of redundant\.slice\(0, maxHousekeepingItemsPerCall\)\)/);
});

test("uncapped items stay pending for the next call instead of being dropped", () => {
  // The cap must only limit how many are attempted per call, not shrink the
  // reported backlog or silently discard the rest -- claimNotification is
  // never invoked for items beyond the slice, so they remain claimable by
  // the next dispatcher request or the next automation tick.
  assert.match(runnerSource, /return \{ pending: pending\.length, sent, failed, suppressed \};/);
});

test("the notification maintenance tick keeps its cap conservative even though it no longer shares a budget with fleet sync", () => {
  // Regression guard: a cap of 20 (on top of fleet sync/business-tick/
  // telemetry-pruning work all sharing one invocation) reliably blew
  // Cloudflare's per-invocation subrequest limit on every tick once the
  // WhatsApp token went invalid (every send attempted and failed), which
  // kept tripping the D1 read-only failover safety net app-wide --
  // reproduced live via wrangler tail. Notification sends now run in their
  // own tick (see notification-maintenance-tick.ts, no longer sharing a
  // budget with fleet sync), but the cap stays conservative because each
  // guaranteed-to-fail send still costs several subrequests on its own.
  assert.match(maintenanceTickSource, /processPendingNotifications\(companyId, origin, 8\)/);
});

test("interactive dispatcher reads never process the notification backlog", () => {
  const getBody = deliveriesRoute.slice(deliveriesRoute.indexOf("export async function GET"), deliveriesRoute.indexOf("export async function POST"));
  assert.doesNotMatch(getBody, /processPendingNotifications\(/);
});
