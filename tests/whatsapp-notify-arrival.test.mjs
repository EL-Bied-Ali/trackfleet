import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildArrivalNotificationMessage } from "../app/lib/whatsapp-inbound-message.ts";
import { trackingLinkExpiryAnchorFromEvents } from "../app/lib/delivery-events.ts";

const baseDelivery = {
  id: "TF-1",
  customer: "Jean Dupont",
  destination: "Casablanca",
};

test("the arrival notification names the parcel, its destination and includes the tracking link", () => {
  const message = buildArrivalNotificationMessage(baseDelivery, "https://trackfleet.chronoplan.workers.dev/?tracking=abc123", "Jean Dupont");
  assert.match(message, /Jean Dupont/);
  assert.match(message, /TF-1/);
  assert.match(message, /Casablanca/);
  assert.match(message, /https:\/\/trackfleet\.chronoplan\.workers\.dev\/\?tracking=abc123/);
});

test("the arrival notification greets whoever is passed as greetingName, matching the recipient-vs-sender pattern used for the auto-reply", () => {
  const message = buildArrivalNotificationMessage(baseDelivery, "https://example.com/?tracking=xyz", "Fatima Zahra");
  assert.match(message, /Fatima Zahra/);
  assert.doesNotMatch(message, /Jean Dupont/);
});

test("the arrival notification is signed with the agency's own company branding, when configured, same as the inbound auto-reply", () => {
  const signed = buildArrivalNotificationMessage(baseDelivery, "https://example.com/?tracking=xyz", "Jean Dupont", "Net Transport");
  assert.match(signed, /— Net Transport$/);
  const unsigned = buildArrivalNotificationMessage(baseDelivery, "https://example.com/?tracking=xyz", "Jean Dupont");
  assert.doesNotMatch(unsigned, /—/);
});

test("trackingLinkExpiryAnchorFromEvents treats a WhatsApp arrival notification as an expiry trigger, even without a Delivered event", () => {
  const notifiedAt = new Date("2026-08-20T09:00:00.000Z");
  assert.equal(trackingLinkExpiryAnchorFromEvents([
    { type: "ARRIVED_AT_SITE", createdAt: new Date("2026-08-19T09:00:00.000Z") },
    { type: "WHATSAPP_ARRIVAL_NOTIFIED", createdAt: notifiedAt },
  ])?.toISOString(), notifiedAt.toISOString());
});

test("trackingLinkExpiryAnchorFromEvents picks the earliest of a real delivery and a notification, keeping the deadline as tight as possible", () => {
  const notifiedAt = new Date("2026-08-19T09:00:00.000Z");
  const deliveredAt = new Date("2026-08-20T09:00:00.000Z");
  assert.equal(trackingLinkExpiryAnchorFromEvents([
    { type: "MANUAL_DELIVERED", createdAt: deliveredAt },
    { type: "WHATSAPP_ARRIVAL_NOTIFIED", createdAt: notifiedAt },
  ])?.toISOString(), notifiedAt.toISOString());
});

const [notifyRoute, deliveryEventsLib] = await Promise.all([
  readFile(new URL("../app/api/deliveries/notify-arrival/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/delivery-events.ts", import.meta.url), "utf8"),
]);

test("the notify-arrival route rejects cross-origin requests and requires an authenticated session", () => {
  assert.match(notifyRoute, /if \(!requestIsSameOrigin\(request\)\) return originRejectedResponse\(\);/);
  assert.match(notifyRoute, /if \(!session\) return noStore\(\{ error: "unauthorized" \}, 401\);/);
});

// Widened from agency-only so the delivery table's inline "confirm arrival"
// group action (dispatcher-triggerable) can also fire this notify, not just
// the agency-side card list -- same permission model confirmArrival already
// has in manual-completion/route.ts: dispatcher unrestricted, agency scoped
// to its own destination site.
test("the notify-arrival route scopes an agency session to its own destination site, but leaves a dispatcher session unrestricted, same as the existing arrival-confirmation action", () => {
  assert.doesNotMatch(notifyRoute, /if \(session\.role !== "agency"\) return noStore\(\{ error: "agency_only" \}, 403\);/);
  assert.match(notifyRoute, /if \(session\.role === "agency" && delivery\.destinationSiteId !== session\.siteId\) \{/);
});

test("the notify-arrival route only records WHATSAPP_ARRIVAL_NOTIFIED after at least one send actually succeeds", () => {
  assert.match(notifyRoute, /const anySent = results\.some\(\(result\) => result\.sent\);/);
  assert.match(notifyRoute, /if \(anySent\) await store\.recordEvent\(deliveryId, "WHATSAPP_ARRIVAL_NOTIFIED", delivery\.progress\);/);
});

test("WHATSAPP_ARRIVAL_NOTIFIED is excluded from the customer-facing event timeline -- it's an internal marker, not a route milestone", () => {
  assert.match(deliveryEventsLib, /&& event !== "WHATSAPP_ARRIVAL_NOTIFIED"/);
});

test("the notify-arrival route signs the message with the agency's own company branding, looked up once for the whole batch of recipients", () => {
  assert.match(notifyRoute, /import \{ getCompanyBranding \} from "trackfleet-auth-session-store";/);
  assert.match(notifyRoute, /const branding = await getCompanyBranding\(session\.companyId\);/);
  assert.match(notifyRoute, /buildArrivalNotificationMessage\(delivery, trackingUrl\.toString\(\), recipient\.name, branding\?\.name \?\? null\);/);
});

// Found live during a business-logic audit: the automatic push pipeline
// already refuses to notify a withdrawn-consent customer
// (whatsappConsentWithdrawn in notification-runner.ts), but this manual,
// agency-triggered send skipped that check entirely -- a dispatcher could
// click "Notifier par WhatsApp" and message a customer who'd explicitly
// opted out, as long as Meta's unrelated 24h window happened to be open.
test("the notify-arrival route refuses to send when the customer withdrew WhatsApp consent, same rule the automatic pipeline already enforces", () => {
  assert.match(notifyRoute, /import \{ whatsappConsentWithdrawn \} from "\.\.\/\.\.\/\.\.\/lib\/delivery-events";/);
  assert.match(notifyRoute, /const events = await store\.listEvents\(deliveryId\);/);
  assert.match(notifyRoute, /if \(whatsappConsentWithdrawn\(events\)\) return noStore\(\{ error: "consent_withdrawn" \}, 403\);/);
});

// Live audit finding: two independent UI paths reach this same endpoint for
// the same delivery -- the group "confirm arrival" action fires it
// automatically, and a standalone popover button stays clickable
// afterward. Neither used to check whether WHATSAPP_ARRIVAL_NOTIFIED was
// already recorded, so a dispatcher clicking both sent the customer two
// separate messages for the same milestone.
test("the notify-arrival route is idempotent -- a delivery that already has WHATSAPP_ARRIVAL_NOTIFIED recorded is not messaged again", () => {
  assert.match(notifyRoute, /if \(events\.some\(\(event\) => event\.type === "WHATSAPP_ARRIVAL_NOTIFIED"\)\) \{\s*\n\s*return noStore\(\{ ok: true, alreadyNotified: true, results: \[\] \}\);\s*\n\s*\}/);
  // Must come after the consent check (both read the same already-fetched
  // events array) but before any recipient/branding lookup or send attempt.
  const consentIndex = notifyRoute.indexOf('if (whatsappConsentWithdrawn(events))');
  const idempotencyIndex = notifyRoute.indexOf('event.type === "WHATSAPP_ARRIVAL_NOTIFIED"');
  const sendIndex = notifyRoute.indexOf("sendWhatsAppTextReply(recipient.phone");
  assert.ok(consentIndex >= 0 && idempotencyIndex > consentIndex && sendIndex > idempotencyIndex);
});
