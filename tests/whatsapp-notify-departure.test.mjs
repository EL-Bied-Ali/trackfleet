import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildDepartureNotificationMessage } from "../app/lib/whatsapp-inbound-message.ts";

const baseDelivery = {
  id: "TF-1",
  customer: "Jean Dupont",
  destination: "Casablanca",
};

test("the departure notification names the parcel, its destination and includes the tracking link", () => {
  const message = buildDepartureNotificationMessage(baseDelivery, "https://trackfleet.chronoplan.workers.dev/?tracking=abc123", "Jean Dupont");
  assert.match(message, /Jean Dupont/);
  assert.match(message, /TF-1/);
  assert.match(message, /Casablanca/);
  assert.match(message, /https:\/\/trackfleet\.chronoplan\.workers\.dev\/\?tracking=abc123/);
});

test("the departure notification greets whoever is passed as greetingName, matching the recipient-vs-sender pattern used for the auto-reply", () => {
  const message = buildDepartureNotificationMessage(baseDelivery, "https://example.com/?tracking=xyz", "Fatima Zahra");
  assert.match(message, /Fatima Zahra/);
  assert.doesNotMatch(message, /Jean Dupont/);
});

test("the departure notification is signed with the company's own branding, when configured, same as the other freeform messages", () => {
  const signed = buildDepartureNotificationMessage(baseDelivery, "https://example.com/?tracking=xyz", "Jean Dupont", "Net Transport");
  assert.match(signed, /— Net Transport$/);
  const unsigned = buildDepartureNotificationMessage(baseDelivery, "https://example.com/?tracking=xyz", "Jean Dupont");
  assert.doesNotMatch(unsigned, /—/);
});

test("unlike the arrival notification, the departure one doesn't frame the link as closing soon -- it has no tracking-link-expiry side effect", () => {
  const message = buildDepartureNotificationMessage(baseDelivery, "https://example.com/?tracking=xyz", "Jean Dupont");
  assert.doesNotMatch(message, /clôturé/);
});

// Requested live: mention the same server-computed estimate the creation
// form and schedule editor already show (see relay-eta-estimate.ts) so the
// customer gets a rough arrival date up front, not just a tracking link.
test("mentions the estimated arrival date when the delivery has a plannedArrivalAt on file", () => {
  const withEstimate = { ...baseDelivery, plannedArrivalAt: new Date("2026-09-07T08:00:00.000Z") };
  const message = buildDepartureNotificationMessage(withEstimate, "https://example.com/?tracking=xyz", "Jean Dupont");
  assert.match(message, /Arrivée estimée : 07 sept\. 2026/);
});

test("omits the estimate line entirely rather than inventing one when plannedArrivalAt isn't set", () => {
  const message = buildDepartureNotificationMessage(baseDelivery, "https://example.com/?tracking=xyz", "Jean Dupont");
  assert.doesNotMatch(message, /Arrivée estimée/);
});

// Requested live: set the expectation early that the destination agency's
// own number is coming, since it's only revealed once the parcel actually
// arrives (see public-delivery-view.ts's destinationWhatsapp).
test("tells the customer they'll receive the agency's number once the parcel arrives", () => {
  const message = buildDepartureNotificationMessage(baseDelivery, "https://example.com/?tracking=xyz", "Jean Dupont");
  assert.match(message, /Vous recevrez le numéro de l'agence dès que votre colis sera arrivé\./);
});

const [notifyRoute, deliveryEventsLib] = await Promise.all([
  readFile(new URL("../app/api/deliveries/notify-departure/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/delivery-events.ts", import.meta.url), "utf8"),
]);

test("the notify-departure route rejects cross-origin requests and requires an authenticated dispatcher session", () => {
  assert.match(notifyRoute, /if \(!requestIsSameOrigin\(request\)\) return originRejectedResponse\(\);/);
  assert.match(notifyRoute, /if \(!session\) return noStore\(\{ error: "unauthorized" \}, 401\);/);
  assert.match(notifyRoute, /if \(session\.role !== "dispatcher"\) return noStore\(\{ error: "dispatcher_only" \}, 403\);/);
});

test("the notify-departure route has no agency destination-site scoping -- departure happens at origin, not a destination site", () => {
  assert.doesNotMatch(notifyRoute, /destinationSiteId !== session\.siteId/);
});

test("the notify-departure route only records WHATSAPP_DEPARTURE_NOTIFIED after at least one send actually succeeds", () => {
  assert.match(notifyRoute, /const anySent = results\.some\(\(result\) => result\.sent\);/);
  assert.match(notifyRoute, /if \(anySent\) await store\.recordEvent\(deliveryId, "WHATSAPP_DEPARTURE_NOTIFIED", delivery\.progress\);/);
});

test("WHATSAPP_DEPARTURE_NOTIFIED and MANUAL_DEPARTURE_CONFIRMED are excluded from the customer-facing event timeline -- internal markers, not route milestones", () => {
  assert.match(deliveryEventsLib, /&& event !== "MANUAL_DEPARTURE_CONFIRMED"\s*\n\s*&& event !== "WHATSAPP_DEPARTURE_NOTIFIED"/);
});

test("the notify-departure route signs the message with the company's own branding, looked up once for the whole batch of recipients", () => {
  assert.match(notifyRoute, /import \{ getCompanyBranding \} from "trackfleet-auth-session-store";/);
  assert.match(notifyRoute, /const branding = await getCompanyBranding\(session\.companyId\);/);
  assert.match(notifyRoute, /buildDepartureNotificationMessage\(delivery, trackingUrl\.toString\(\), recipient\.name, branding\?\.name \?\? null\);/);
});

test("the notify-departure route refuses to send when the customer withdrew WhatsApp consent, same rule the automatic pipeline already enforces", () => {
  assert.match(notifyRoute, /import \{ whatsappConsentWithdrawn \} from "\.\.\/\.\.\/\.\.\/lib\/delivery-events";/);
  assert.match(notifyRoute, /const events = await store\.listEvents\(deliveryId\);/);
  assert.match(notifyRoute, /if \(whatsappConsentWithdrawn\(events\)\) return noStore\(\{ error: "consent_withdrawn" \}, 403\);/);
});

// Same fix and reasoning as notify-arrival/route.ts: the group "confirm
// departure" action fires this automatically, and a standalone trigger can
// also reach it afterward -- without a pre-send check, both firing sent the
// customer two separate messages for the same milestone.
test("the notify-departure route is idempotent -- a delivery that already has WHATSAPP_DEPARTURE_NOTIFIED recorded is not messaged again", () => {
  assert.match(notifyRoute, /if \(events\.some\(\(event\) => event\.type === "WHATSAPP_DEPARTURE_NOTIFIED"\)\) \{\s*\n\s*return noStore\(\{ ok: true, alreadyNotified: true, results: \[\] \}\);\s*\n\s*\}/);
  const consentIndex = notifyRoute.indexOf('if (whatsappConsentWithdrawn(events))');
  const idempotencyIndex = notifyRoute.indexOf('event.type === "WHATSAPP_DEPARTURE_NOTIFIED"');
  const sendIndex = notifyRoute.indexOf("sendWhatsAppTextReply(recipient.phone");
  assert.ok(consentIndex >= 0 && idempotencyIndex > consentIndex && sendIndex > idempotencyIndex);
});
