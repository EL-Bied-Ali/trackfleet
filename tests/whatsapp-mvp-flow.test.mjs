import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { isAutomaticWhatsAppEvent } from "../app/lib/notification-policy.ts";

const [deliveryEvents, deliveryRoute, automation, runner, whatsapp, page, publicView, postgresStore, cloudflareStore, schema] = await Promise.all([
  readFile(new URL("../app/lib/delivery-events.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/deliveries/route.ts", import.meta.url), "utf8"),
  Promise.all([
    readFile(new URL("../app/lib/server-automation.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/fleet-business-tick.ts", import.meta.url), "utf8"),
  ]).then((sources) => sources.join("\n")),
  readFile(new URL("../app/lib/notification-runner.ts", import.meta.url), "utf8"),
  Promise.all([
    readFile(new URL("../app/lib/whatsapp-automation.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/whatsapp-message.ts", import.meta.url), "utf8"),
  ]).then((sources) => sources.join("\n")),
  readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/public-delivery-view.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/delivery-store.postgres.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/delivery-store.cloudflare.ts", import.meta.url), "utf8"),
  readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
]);

test("MVP WhatsApp pushes only the two events with real customer action attached", () => {
  for (const event of ["REGISTERED", "ARRIVED_AT_SITE"]) {
    assert.equal(isAutomaticWhatsAppEvent(event), true, `${event} should be pushed`);
  }
  // DEPARTED/NEAR_DESTINATION/DELAY_DETECTED are FYI-only status changes --
  // still visible on the tracking page (linked from the REGISTERED message),
  // just not worth a separate paid push each.
  for (const event of ["GPS_BASELINE", "GPS_STALE", "PROGRESS_25", "PROGRESS_50", "PROGRESS_75", "DEPARTED", "NEAR_DESTINATION", "DELAY_DETECTED", "ARRIVED", "MANUAL_ARRIVAL_CONFIRMED"]) {
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
  assert.match(schema, /["']REGISTERED["']/);
});

test("new parcel creation immediately queues registration and processes notifications", () => {
  assert.match(deliveryRoute, /recordEvent\(delivery\.id, ["']REGISTERED["'], delivery\.progress\)/);
  assert.match(deliveryRoute, /processPendingNotifications\(session\.companyId, new URL\(request\.url\)\.origin\)/);
});

test("WhatsApp consent is explicit for new numbers, remembered, and persisted for both contacts", () => {
  assert.match(page, /type=["']checkbox["'] name=["']whatsappOptIn["']/);
  // The only way this checkbox can start checked is a restored form draft
  // reflecting the dispatcher's own prior explicit choice (see
  // delivery-creation-draft.ts) -- never a hardcoded opt-in-by-default.
  assert.match(page, /type=["']checkbox["'] name=["']whatsappOptIn["'][^>]*defaultChecked=\{creationDraftSeed\?\.whatsappOptIn \?\? false\}/);
  assert.match(page, /form\.get\(["']whatsappOptIn["']\) === ["']on["']/);
  assert.match(deliveryRoute, /payload\.whatsappOptIn === true/);
  assert.match(deliveryRoute, /rememberedConsentForPhone/);
  assert.match(deliveryRoute, /recipientWhatsappOptIn/);
  assert.match(deliveryRoute, /whatsappOptInAt: whatsappOptIn \? new Date\(\) : null/);
  assert.match(postgresStore, /whatsapp_opt_in boolean NOT NULL DEFAULT false/);
  assert.match(postgresStore, /whatsapp_opt_in_at timestamptz/);
  assert.match(cloudflareStore, /whatsapp_opt_in AS whatsappOptIn/);
  assert.match(cloudflareStore, /whatsapp_opt_in_at AS whatsappOptInAt/);
  assert.match(cloudflareStore, /delivery\.whatsappOptIn === true \? 1 : 0/);
  assert.match(cloudflareStore, /delivery\.whatsappOptInAt\?\.getTime\(\) \?\? null/);
  assert.match(schema, /whatsappOptIn: integer\(["']whatsapp_opt_in["']/);
  assert.match(schema, /whatsappOptInAt: integer\(["']whatsapp_opt_in_at["']/);
  assert.match(schema, /recipientWhatsappOptIn: integer\(["']recipient_whatsapp_opt_in["']/);
  assert.match(schema, /recipientWhatsappOptInAt: integer\(["']recipient_whatsapp_opt_in_at["']/);
});

test("automatic WhatsApp payload refuses missing sender consent", () => {
  assert.match(whatsapp, /delivery\.whatsappOptIn !== true/);
  assert.match(whatsapp, /reason: ["']consent_missing["']/);
});

test("automatic WhatsApp delivery targets only the sender, never the recipient, to keep volume to one message per event", () => {
  // Deliberately scoped to the sender-only send path: the recipient's own
  // contact/opt-in is still recorded elsewhere (delivery creation, the
  // dispatcher UI) but must never be read here, since that's exactly what
  // used to double message volume for deliveries with both parties opted in.
  assert.doesNotMatch(whatsapp, /delivery\.recipientName/);
  assert.doesNotMatch(whatsapp, /delivery\.recipientContact/);
  assert.doesNotMatch(whatsapp, /delivery\.recipientWhatsappOptIn/);
  assert.match(whatsapp, /delivery\.whatsappOptIn/);
});

test("scheduler provides a safe registration fallback without messaging historical parcels", () => {
  assert.match(automation, /delivery\.createdAt\.getTime\(\) >= automationStartAt\.getTime\(\)/);
  assert.match(automation, /!events\.some\(\(event\) => event\.type === ["']REGISTERED["']\)/);
  assert.match(automation, /recordEvent(?:Tracked)?\(delivery\.id, ["']REGISTERED["']/);
});

test("notification runner filters low-value progress events before newest-event compaction", () => {
  const eligibleIndex = runner.indexOf("const eligible = pending.filter");
  const splitIndex = runner.indexOf("splitLatestPendingNotifications(eligible)");
  assert.ok(eligibleIndex >= 0);
  assert.ok(splitIndex > eligibleIndex);
});

test("missing consent, missing customer phone, and missing customer email are all permanent (suppressed, not retried forever) -- while a genuine provider/config failure on any channel stays retryable", () => {
  // Email (baseline, every plan) and WhatsApp (Pro-tier add-on) are now
  // attempted independently per queued notification -- see
  // permanentChannelReasons in notification-runner.ts. consent_missing and
  // recipient_missing are WhatsApp-specific; no_email is email's
  // equivalent. None of these become a five-minute retry loop, because
  // retrying wouldn't change the outcome for that queued event.
  assert.match(runner, /const permanentChannelReasons = new Set\(\["consent_missing", "recipient_missing", "internal_event", "no_email"\]\);/);
  const suppressionStart = runner.indexOf('results.every((result) => permanentChannelReasons.has(result.reason ?? ""))');
  const retryStart = runner.indexOf("await store.releaseNotification", suppressionStart);
  assert.ok(suppressionStart >= 0);
  assert.ok(retryStart > suppressionStart);
  const suppressionBranch = runner.slice(suppressionStart, retryStart);
  assert.match(suppressionBranch, /markNotificationSent/);
  assert.match(suppressionBranch, /suppressed \+= 1/);
  assert.doesNotMatch(suppressionBranch, /releaseNotification/);
});

test("WhatsApp is only attempted when this company's plan actually includes it -- a Standard-tier company still gets the email attempt, and 'not on this plan' is never counted as a failure", () => {
  assert.match(runner, /whatsappEligible \? sendAutomaticWhatsAppNotification\(item\.event\.type, item\.delivery, parcelCount\) : null,/);
  assert.match(runner, /sendAutomaticEmailNotification\(item\.event\.type, item\.delivery, trackingUrl\.toString\(\), parcelCount\),/);
  assert.match(runner, /const results = attempts\.filter\(\(result\): result is NonNullable<typeof result> => result !== null\);/);
});

test("automatic customer links require a private tracking token and never fall back to parcel id", () => {
  assert.match(runner, /if \(!item\.delivery\.trackingToken\)/);
  assert.match(runner, /markNotificationSent/);
  assert.match(runner, /searchParams\.set\(["']tracking["'], item\.delivery\.trackingToken\)/);
  assert.doesNotMatch(runner, /trackingToken \|\| item\.delivery\.id/);
});

test("public tracking uses an explicit allowlist and never returns internal consent/contact fields", () => {
  assert.match(deliveryRoute, /publicDeliveryView\(enriched, \{ destinationWhatsapp \}\)/);
  for (const field of ["companyId", "contact", "recipientName", "recipientContact", "trackingToken", "whatsappOptIn", "whatsappOptInAt", "recipientWhatsappOptIn", "recipientWhatsappOptInAt"]) {
    assert.doesNotMatch(publicView, new RegExp(`\\b${field}\\s*:`), `${field} must not be projected publicly`);
  }
});

test("registration, departure and delay copy direct customers to self-service tracking", () => {
  assert.match(whatsapp, /case ["']REGISTERED["']/);
  assert.match(whatsapp, /Suivi et estimation d'arrivée/);
  assert.match(whatsapp, /case ["']DEPARTED["']/);
  assert.match(whatsapp, /case ["']DELAY_DETECTED["']/);
  assert.match(whatsapp, /trackingUrl/);
  assert.doesNotMatch(whatsapp, /WHATSAPP_DEMO_RECIPIENT/);
});

test("arrival-at-site notifies once before unloading completion", () => {
  assert.match(whatsapp, /case ["']ARRIVED_AT_SITE["']/);
  assert.equal(isAutomaticWhatsAppEvent("ARRIVED_AT_SITE"), true);
  assert.equal(isAutomaticWhatsAppEvent("ARRIVED"), false);
});

test("a priced parcel's arrival message points to the tracking page for the invoice instead of restating full billing details", async () => {
  const { automaticWhatsAppMessage } = await import("../app/lib/whatsapp-message.ts");
  const unpriced = automaticWhatsAppMessage("ARRIVED_AT_SITE", { id: "TF-1", destination: "Casablanca" }, "https://trackfleet.app/?tracking=abc");
  assert.equal(unpriced, "Arrivé à Casablanca.");

  const priced = automaticWhatsAppMessage("ARRIVED_AT_SITE", { id: "TF-1", destination: "Casablanca", priceAmount: 150, priceCurrency: "MAD" }, "https://trackfleet.app/?tracking=abc");
  assert.match(priced, /150\.00 MAD/);
  assert.match(priced, /https:\/\/trackfleet\.app\/\?tracking=abc/);
  assert.doesNotMatch(priced, /150\.00 MAD.*150\.00 MAD/);
});
