import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const runnerSource = await readFile(new URL("../app/lib/notification-runner.ts", import.meta.url), "utf8");
const automationSource = await readFile(new URL("../app/lib/server-automation.ts", import.meta.url), "utf8");
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
  assert.match(runnerSource, /for \(const item of actionable\.slice\(0, maxPerCall\)\)/);
});

test("uncapped items stay pending for the next call instead of being dropped", () => {
  // The cap must only limit how many are attempted per call, not shrink the
  // reported backlog or silently discard the rest -- claimNotification is
  // never invoked for items beyond the slice, so they remain claimable by
  // the next dispatcher request or the next automation tick.
  assert.match(runnerSource, /return \{ pending: pending\.length, sent, failed, suppressed \};/);
});

test("the scheduled automation tick can drain a larger slice than an interactive request, since it isn't blocking a page load", () => {
  assert.match(automationSource, /processPendingNotifications\(companyId, origin, 20\)/);
});

test("interactive dispatcher requests use the safe default cap", () => {
  assert.match(deliveriesRoute, /processPendingNotifications\(session\.companyId, requestUrl\.origin\)/);
});
