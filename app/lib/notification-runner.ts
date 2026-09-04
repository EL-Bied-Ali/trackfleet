import { store } from "trackfleet-delivery-store";
import { runtimeEnv } from "trackfleet-runtime-env";
import type { DeliveryEventType } from "./delivery-events";
import { whatsappConsentWithdrawn } from "./delivery-events";
import { sendAutomaticEmailNotification } from "./email-automation";
import { groupActionableByShipment, isAutomaticWhatsAppEvent, isHistoricalNotification, parseAutomationStartAt, splitLatestPendingNotifications } from "./notification-policy";
import { getSubscription, whatsappIncludedInPlan } from "./subscription-store";
import { sendAutomaticWhatsAppNotification } from "./whatsapp-automation";

// Reasons a channel attempt is treated as PERMANENT for this queued event
// (mark sent, never retry) rather than retryable: missing/invalid contact
// info for that channel, or missing consent (WhatsApp only -- Meta requires
// explicit opt-in). "not_configured" and "provider_error" are deliberately
// NOT here -- an operator adding credentials later, or a transient provider
// outage, must still get picked up by a later retry.
const permanentChannelReasons = new Set(["consent_missing", "recipient_missing", "internal_event", "no_email"]);

// A dispatcher GET request must never be able to time out because of a
// WhatsApp/Meta backlog: each send has its own multi-second timeout, and
// with no cap here a large or currently-failing queue processed
// sequentially can consume the entire request budget on its own, on top of
// whatever SENDATRACK itself is doing. Anything past the cap stays pending
// and is picked up by the next call -- either the next dispatcher request
// or the 5-minute automation tick (app/lib/server-automation.ts).
const defaultMaxNotificationsPerCall = 5;

// The ignored (non-WhatsApp, e.g. progress-milestone) and superseded
// (older duplicate) buckets don't call out to WhatsApp, but each item still
// costs two DB round trips (claim + markSent) -- same subrequest-budget
// exposure as the actionable cap above protects against, just cheaper per
// item. Bounding them too keeps a sudden backlog (e.g. a large CSV import
// landing many REGISTERED events at once, or automation having been
// disabled for a while) from processing unbounded in one call; anything
// past the cap is picked up next call, same as actionable.
const maxHousekeepingItemsPerCall = 50;

// A shipment sibling's own notification is only ever resolved to whatever
// the group's representative actually did -- never pre-marked before that's
// known (see groupActionableByShipment's own comment for the bug this
// fixes: siblings marked "sent" before the representative's send even
// happened silently lost their notification forever if that send later
// failed permanently or had to be retried). Best-effort per sibling: one
// whose own claim fails (e.g. picked up concurrently elsewhere) is simply
// left for the next call to reprocess as its own group.
async function resolveShipmentSiblings(
  siblings: Array<{ delivery: { id: string }; event: { type: DeliveryEventType } }>,
  outcome: "handled" | "retry",
) {
  for (const sibling of siblings.slice(0, maxHousekeepingItemsPerCall)) {
    const claimed = await store.claimNotification(sibling.delivery.id, sibling.event.type);
    if (!claimed) continue;
    if (outcome === "retry") await store.releaseNotification(sibling.delivery.id, sibling.event.type);
    else await store.markNotificationSent(sibling.delivery.id, sibling.event.type);
  }
}

export async function processPendingNotifications(companyId: string, origin: string, maxPerCall = defaultMaxNotificationsPerCall) {
  const pending = await store.listPendingNotifications(companyId);
  let sent = 0;
  let failed = 0;
  let suppressed = 0;

  // WHATSAPP_AUTOMATION_ENABLED is the master switch for automatic customer
  // notifications generally (kept under its original name rather than
  // renamed/duplicated for email -- it already governs the one real
  // company's live traffic, and email is gated on top of it the same way
  // WhatsApp itself is gated on Meta credentials below). While it's
  // disabled, all events stay pending. Once enabled,
  // WHATSAPP_AUTOMATION_START_AT defines the activation boundary so old
  // milestones are acknowledged without being sent in a burst.
  if (runtimeEnv.WHATSAPP_AUTOMATION_ENABLED !== "true") {
    return { pending: pending.length, sent, failed, suppressed };
  }

  // Email is the baseline channel available on every plan; WhatsApp is a
  // Pro-tier add-on on top of it (see app/lib/paddle-checkout.ts and the
  // SubscribeScreen copy in app/page.tsx: "Everything in Standard, plus
  // WhatsApp"). A Standard-tier company must still reach the loop below so
  // its customers get email -- only whatsappEligible (checked per item)
  // decides whether the WhatsApp channel itself is attempted.
  const subscription = await getSubscription(companyId);
  const whatsappEligible = whatsappIncludedInPlan(subscription);

  const automationStartAt = parseAutomationStartAt(runtimeEnv.WHATSAPP_AUTOMATION_START_AT);
  if (!automationStartAt) {
    console.error("[trackfleet:notifications] automation enabled without valid WHATSAPP_AUTOMATION_START_AT");
    return { pending: pending.length, sent, failed: pending.length, suppressed };
  }

  // Progress milestones stay available in the tracking timeline, but the MVP
  // deliberately does not push them to WhatsApp. The customer receives only
  // operationally useful messages: registration, departure, delay, approach,
  // and arrival.
  const eligible = pending.filter((item) => isAutomaticWhatsAppEvent(item.event.type));
  const ignored = pending.filter((item) => !isAutomaticWhatsAppEvent(item.event.type));
  for (const item of ignored.slice(0, maxHousekeepingItemsPerCall)) {
    const claimed = await store.claimNotification(item.delivery.id, item.event.type);
    if (!claimed) continue;
    await store.markNotificationSent(item.delivery.id, item.event.type);
    suppressed += 1;
  }

  // If several useful customer events accumulated for the same delivery while
  // the provider/scheduler was unavailable, send only the newest useful state.
  const { actionable, superseded } = splitLatestPendingNotifications(eligible);
  for (const item of superseded.slice(0, maxHousekeepingItemsPerCall)) {
    const claimed = await store.claimNotification(item.delivery.id, item.event.type);
    if (!claimed) continue;
    await store.markNotificationSent(item.delivery.id, item.event.type);
    suppressed += 1;
  }

  // A "weigh together" shipment is several delivery rows sharing one
  // shipmentId, each carrying its own copy of the same event -- without
  // this, a customer with 3 parcels on one truck got 3 near-identical
  // pushes for the same real-world event. One representative per shipment
  // is actually sent (with the group's size folded into its message text);
  // each sibling's own notification is resolved to whatever the
  // representative's real outcome turns out to be, at every exit point
  // below -- never pre-marked, since that previously lost a sibling's
  // notification forever the moment the representative's send didn't
  // actually go out (permanently suppressed, or released for a retry that
  // only the representative itself would ever get picked up for again).
  const groups = groupActionableByShipment(actionable);

  for (const { item, parcelCount, siblings } of groups.slice(0, maxPerCall)) {
    const claimed = await store.claimNotification(item.delivery.id, item.event.type);
    if (!claimed) continue;

    // Consent can be withdrawn after parcel intake. The withdrawal is stored as
    // an internal delivery event so the rule works identically across Postgres,
    // D1/Cloudflare and the local memory store.
    const deliveryEvents = await store.listEvents(item.delivery.id);
    if (whatsappConsentWithdrawn(deliveryEvents)) {
      await store.markNotificationSent(item.delivery.id, item.event.type);
      suppressed += 1;
      await resolveShipmentSiblings(siblings, "handled");
      continue;
    }

    if (isHistoricalNotification(item.event.createdAt, automationStartAt)) {
      await store.markNotificationSent(item.delivery.id, item.event.type);
      suppressed += 1;
      await resolveShipmentSiblings(siblings, "handled");
      continue;
    }

    // Public customer tracking is token-only. Never fall back to a predictable
    // delivery ID if an old/corrupt record is missing its private tracking token.
    if (!item.delivery.trackingToken) {
      await store.markNotificationSent(item.delivery.id, item.event.type);
      suppressed += 1;
      console.error("[trackfleet:notifications] suppressed notification without private tracking token", {
        deliveryId: item.delivery.id,
        event: item.event.type,
      });
      await resolveShipmentSiblings(siblings, "handled");
      continue;
    }

    const trackingUrl = new URL(origin);
    trackingUrl.searchParams.set("tracking", item.delivery.trackingToken);

    try {
      // Email is attempted for every plan; WhatsApp only when this
      // company's subscription actually includes it -- when it doesn't,
      // the channel is skipped entirely rather than attempted and counted
      // as a failure, since "not on this plan" isn't a provider error.
      const attempts = await Promise.all([
        whatsappEligible ? sendAutomaticWhatsAppNotification(item.event.type, item.delivery, parcelCount) : null,
        sendAutomaticEmailNotification(item.event.type, item.delivery, trackingUrl.toString(), parcelCount),
      ]);
      const results = attempts.filter((result): result is NonNullable<typeof result> => result !== null);

      if (results.some((result) => result.sent)) {
        await store.markNotificationSent(item.delivery.id, item.event.type);
        sent += 1;
        await resolveShipmentSiblings(siblings, "handled");
      } else if (results.every((result) => permanentChannelReasons.has(result.reason ?? ""))) {
        // Every attempted (or applicable) channel failed for a permanent
        // reason -- e.g. no WhatsApp consent AND no customer email on file.
        // Must not become a five-minute retry loop: nothing about retrying
        // would change the outcome.
        await store.markNotificationSent(item.delivery.id, item.event.type);
        suppressed += 1;
        await resolveShipmentSiblings(siblings, "handled");
      } else {
        // At least one channel failed for a retryable reason (provider
        // error, or not yet configured). Release the claim so a later
        // scheduler tick can try again once the problem is corrected --
        // siblings are released too, so the whole group is retried
        // together instead of the siblings being lost.
        await store.releaseNotification(item.delivery.id, item.event.type);
        failed += 1;
        await resolveShipmentSiblings(siblings, "retry");
      }
    } catch (error) {
      await store.releaseNotification(item.delivery.id, item.event.type);
      failed += 1;
      await resolveShipmentSiblings(siblings, "retry");
      console.error("[trackfleet:notifications] unexpected send failure", {
        deliveryId: item.delivery.id,
        event: item.event.type,
        message: error instanceof Error ? error.message : "unknown_error",
      });
    }
  }

  return { pending: pending.length, sent, failed, suppressed };
}
