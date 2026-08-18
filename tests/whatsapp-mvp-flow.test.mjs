import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { isAutomaticWhatsAppEvent } from "../app/lib/notification-policy.ts";

const [deliveryEvents, deliveryRoute, automation, runner, whatsapp, page, publicView, postgresStore, cloudflareStore] = await Promise.all([
  readFile(new URL("../app/lib/delivery-events.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/deliveries/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/server-automation.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/notification-runner.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/whatsapp-automation.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/public-delivery-view.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/delivery-store.postgres.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/delivery-store.cloudflare.ts", import.meta.url), "utf8"),
]);

test("MVP WhatsApp pushes only high-value customer states", () => {
  for (const event of ["REGISTERED", "DEPARTED", "DELAY_DETECTED", "NEAR_DESTINATION", "ARRIVED"]) {
    assert.equal(isAutomaticWhatsAppEvent(event), true, `${event} should be pushed`);
  }
  for (const event of ["GPS_BASELINE", "GPS_STALE", "PROGRESS_25", "PROGRESS_50", "PROGRESS_75"]) {
    assert.equal(isAutomaticWhatsAppEvent(event), false, `${event} should stay out of WhatsApp`);
  }
});

test("automatic payload builder uses the same strict event policy", () => {
  assert.match(whatsapp, /isAutomaticWhatsAppEvent\(event\)/);
  assert.match(whatsapp, /reason: ["']internal_event["']/);
});

test("registration is a first-class delivery event and visible in every UI language", () => {
  assert.match(deliveryEvents, /\| ["']REGISTERED["']/);
  assert.match(page, /type DeliveryEventType = [^;]*["']REGISTERED["']/);
  assert.match(page, /REGISTERED: ["']Colis enregistré["']/);
  assert.match(page, /REGISTERED: ["']Parcel registered["']/);
  assert.match(page, /REGISTERED: ["']Zending geregistreerd["']/);
});

test("new parcel creation immediately queues registration and processes notifications", () => {
  assert.match(deliveryRoute, /recordEvent\(delivery\.id, ["']REGISTERED["'], delivery\.progress\)/);
  assert.match(deliveryRoute, /processPendingNotifications\(session\.companyId, new URL\(request\.url\)\.origin\)/);
});

test("WhatsApp consent is explicit, voluntary and persisted on parcel creation", () => {
  assert.match(page, /type=["']checkbox["'] name=["']whatsappOptIn["']/);
  assert.doesNotMatch(page, /type=["']checkbox["'] name=["']whatsappOptIn["'][^>]*defaultChecked/);
  assert.match(page, /form\.get\(["']whatsappOptIn["']\) === ["']on["']/);
  assert.match(deliveryRoute, /payload\.whatsappOptIn === true/);
  assert.match(deliveryRoute, /WhatsApp consent requires a valid customer phone number/);
  assert.match(deliveryRoute, /whatsappOptInAt: whatsappOptIn \? new Date\(\) : null/);
  assert.match(postgresStore, /whatsapp_opt_in boolean NOT NULL DEFAULT false/);
  assert.match(postgresStore, /whatsapp_opt_in_at timestamptz/);
  assert.match(cloudflareStore, /whatsapp_opt_in integer DEFAULT 0 NOT NULL/);
  assert.match(cloudflareStore, /whatsapp_opt_in_at integer/);
});

test("automatic WhatsApp payload refuses missing consent", () => {
  assert.match(whatsapp, /delivery\.whatsappOptIn !== true/);
  assert.match(whatsapp, /reason: ["']consent_missing["']/);
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

test("missing consent and missing customer phone are suppressed instead of retried forever", () => {
  assert.match(runner, /result\.reason === ["']consent_missing["']/);
  assert.match(runner, /result\.reason === ["']recipient_missing["']/);
  const suppressionBranch = runner.indexOf('result.reason === "consent_missing"');
  const markSent = runner.indexOf("markNotificationSent", suppressionBranch);
  const continueIndex = runner.indexOf("continue;", markSent);
  const releaseClaim = runner.indexOf("releaseNotification", suppressionBranch);
  assert.ok(suppressionBranch >= 0);
  assert.ok(markSent > suppressionBranch);
  assert.ok(continueIndex > markSent);
  assert.ok(releaseClaim === -1 || releaseClaim > continueIndex);
});

test("public tracking uses an explicit allowlist and never returns internal consent/contact fields", () => {
  assert.match(deliveryRoute, /publicDeliveryView\(enriched\.delivery\)/);
  for (const field of ["companyId", "contact", "trackingToken", "whatsappOptIn", "whatsappOptInAt"]) {
    assert.doesNotMatch(publicView, new RegExp(`\\b${field}\\s*:`), `${field} must not be projected publicly`);
  }
});

test("registration, departure and delay copy direct customers to self-service tracking", () => {
  assert.match(whatsapp, /case ["']REGISTERED["']/);
  assert.match(whatsapp, /estimation d'arrivée ici/);
  assert.match(whatsapp, /case ["']DEPARTED["']/);
  assert.match(whatsapp, /case ["']DELAY_DETECTED["']/);
  assert.match(whatsapp, /trackingUrl/);
  assert.doesNotMatch(whatsapp, /WHATSAPP_DEMO_RECIPIENT/);
});
