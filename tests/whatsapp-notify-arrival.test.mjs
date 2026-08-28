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

test("the notify-arrival route rejects cross-origin requests and requires an authenticated agency session", () => {
  assert.match(notifyRoute, /if \(!requestIsSameOrigin\(request\)\) return originRejectedResponse\(\);/);
  assert.match(notifyRoute, /if \(!session\) return noStore\(\{ error: "unauthorized" \}, 401\);/);
  assert.match(notifyRoute, /if \(session\.role !== "agency"\) return noStore\(\{ error: "agency_only" \}, 403\);/);
});

test("the notify-arrival route scopes to the agency's own destination site, same as the existing arrival-confirmation action", () => {
  assert.match(notifyRoute, /delivery\.destinationSiteId !== session\.siteId/);
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
