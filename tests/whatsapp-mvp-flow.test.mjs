import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { isAutomaticWhatsAppEvent } from "../app/lib/notification-policy.ts";

const [deliveryEvents, deliveryRoute, automation, runner, whatsapp] = await Promise.all([
  readFile(new URL("../app/lib/delivery-events.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/deliveries/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/server-automation.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/notification-runner.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/whatsapp-automation.ts", import.meta.url), "utf8"),
]);

test("MVP WhatsApp pushes only high-value customer states", () => {
  for (const event of ["REGISTERED", "DEPARTED", "DELAY_DETECTED", "NEAR_DESTINATION", "ARRIVED"]) {
    assert.equal(isAutomaticWhatsAppEvent(event), true, `${event} should be pushed`);
  }
  for (const event of ["GPS_BASELINE", "GPS_STALE", "PROGRESS_25", "PROGRESS_50", "PROGRESS_75"]) {
    assert.equal(isAutomaticWhatsAppEvent(event), false, `${event} should stay out of WhatsApp`);
  }
});

test("registration is a first-class delivery event", () => {
  assert.match(deliveryEvents, /\| ["']REGISTERED["']/);
});

test("new parcel creation immediately queues registration and processes notifications", () => {
  assert.match(deliveryRoute, /recordEvent\(delivery\.id, ["']REGISTERED["'], delivery\.progress\)/);
  assert.match(deliveryRoute, /processPendingNotifications\(session\.companyId, new URL\(request\.url\)\.origin\)/);
});

test("scheduler provides a safe registration fallback without messaging historical parcels", () => {
  assert.match(automation, /delivery\.createdAt\.getTime\(\) >= automationStartAt\.getTime\(\)/);
  assert.match(automation, /!events\.some\(\(event\) => event\.type === ["']REGISTERED["']\)/);
  assert.match(automation, /recordEvent\(delivery\.id, ["']REGISTERED["']/);
});

test("notification runner filters low-value progress events before newest-event compaction", () => {
  const eligibleIndex = runner.indexOf("const eligible = pending.filter");
  const splitIndex = runner.indexOf("splitLatestPendingNotifications(eligible)");
  assert.ok(eligibleIndex >= 0);
  assert.ok(splitIndex > eligibleIndex);
});

test("registration, departure and delay copy direct customers to self-service tracking", () => {
  assert.match(whatsapp, /case ["']REGISTERED["']/);
  assert.match(whatsapp, /estimation d'arrivée ici/);
  assert.match(whatsapp, /case ["']DEPARTED["']/);
  assert.match(whatsapp, /case ["']DELAY_DETECTED["']/);
  assert.match(whatsapp, /trackingUrl/);
  assert.doesNotMatch(whatsapp, /WHATSAPP_DEMO_RECIPIENT/);
});
