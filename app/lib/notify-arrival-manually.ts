import { store } from "trackfleet-delivery-store";
import { getCompanyBranding } from "trackfleet-auth-session-store";
import type { DeliveryRow } from "./delivery-store.types";
import { whatsappConsentWithdrawn } from "./delivery-events";
import { buildArrivalNotificationMessage } from "./whatsapp-inbound-message";
import { sendWhatsAppTextReply } from "./whatsapp-inbound";

// Shared by the dispatcher/agency "Notifier par WhatsApp" button
// (notify-arrival/route.ts) and the QR "Livré à l'agence" scan checkpoint
// (scan/route.ts) -- both are the same real-world action (telling the
// customer their parcel arrived), so both should send the exact same
// freeform message and respect the exact same consent/idempotency rules,
// rather than growing a second, subtly different path to the same outcome.
// Same reasoning as confirm-arrival-manually.ts's own shared function.
export async function notifyArrivalManually(companyId: string, delivery: DeliveryRow, origin: string) {
  const events = await store.listEvents(delivery.id);
  if (whatsappConsentWithdrawn(events)) return { ok: false, reason: "consent_withdrawn" as const, results: [] };
  // Two independent paths can reach this for the same delivery -- a
  // dispatcher clicking the standalone button after the group/scan flow
  // already notified must not send the customer a second message for the
  // same milestone.
  if (events.some((event) => event.type === "WHATSAPP_ARRIVAL_NOTIFIED")) {
    return { ok: true, alreadyNotified: true as const, results: [] };
  }

  const trackingUrl = new URL(origin);
  if (delivery.trackingToken) trackingUrl.searchParams.set("tracking", delivery.trackingToken);

  const recipients = [
    delivery.recipientContact ? { phone: delivery.recipientContact, name: delivery.recipientName || delivery.customer } : null,
    delivery.contact && delivery.contact !== delivery.recipientContact ? { phone: delivery.contact, name: delivery.customer } : null,
  ].filter((entry): entry is { phone: string; name: string } => entry !== null);

  if (!recipients.length) return { ok: false, reason: "no_contact_on_file" as const, results: [] };

  const branding = await getCompanyBranding(companyId);
  const results = await Promise.all(recipients.map(async (recipient) => {
    const message = buildArrivalNotificationMessage(delivery, trackingUrl.toString(), recipient.name, branding?.name ?? null);
    const { sent } = await sendWhatsAppTextReply(recipient.phone, message);
    return { phone: recipient.phone, sent };
  }));

  const anySent = results.some((result) => result.sent);
  if (anySent) await store.recordEvent(delivery.id, "WHATSAPP_ARRIVAL_NOTIFIED", delivery.progress);

  return { ok: anySent, results };
}
