export type DeliveryEventType =
  | "GPS_BASELINE"
  | "REGISTERED"
  | "DEPARTED"
  | "PROGRESS_25"
  | "PROGRESS_50"
  | "PROGRESS_75"
  | "NEAR_DESTINATION"
  | "ARRIVED_AT_SITE"
  | "MANUAL_ARRIVAL_CONFIRMED"
  | "DELAY_DETECTED"
  | "ARRIVED"
  | "MANUAL_DELIVERED"
  | "GPS_STALE"
  | "WHATSAPP_OPT_OUT"
  // Recorded once, the first time an agency dispatcher successfully
  // notifies a customer via WhatsApp that their parcel is ready for
  // pickup (see app/api/deliveries/notify-arrival/route.ts) -- an internal
  // bookkeeping marker, not a route milestone, so it's excluded from
  // customerFacingEvent below like the other internal-only types.
  | "WHATSAPP_ARRIVAL_NOTIFIED"
  // A dispatcher manually confirming a delivery has left origin (see
  // app/api/deliveries/manual-completion/route.ts) -- for deliveries with
  // no SENDATRACK-tracked vehicle, nothing ever detects the automatic
  // DEPARTED event above, so they'd sit in Loading forever otherwise. Same
  // internal-bookkeeping role as MANUAL_ARRIVAL_CONFIRMED: the real,
  // customer-facing DEPARTED event is still recorded alongside it.
  | "MANUAL_DEPARTURE_CONFIRMED"
  // Same idea as WHATSAPP_ARRIVAL_NOTIFIED, but for a dispatcher's manual
  // "the truck just left" notice (see
  // app/api/deliveries/notify-departure/route.ts).
  | "WHATSAPP_DEPARTURE_NOTIFIED"
  // Recorded the first time a QR-code scan (see app/api/scan/route.ts)
  // marks a parcel loaded onto its truck -- internal bookkeeping only,
  // like MANUAL_ARRIVAL_CONFIRMED, deliberately decoupled from the
  // GPS-driven status/progress machine (loading doesn't move status). The
  // full, repeatable scan history (who, when, which truck) lives in the
  // separate delivery_scans table -- this is just enough to show a
  // milestone in the existing timeline. The scanner's other checkpoint,
  // "arrived", has no SCAN_ARRIVED counterpart: it reuses
  // confirmArrivalManually directly (see confirm-arrival-manually.ts), the
  // same proven path the existing "Confirmer l'arrivée" button already
  // uses, so scanning at arrival really does move status/progress and
  // trigger the WhatsApp arrival notice -- not just log a marker.
  | "SCAN_LOADED";

export type DeliveryEventInput = {
  previousStatus: "In transit" | "Delayed" | "Loading" | "Delivered";
  nextStatus: "In transit" | "Delayed" | "Loading" | "Delivered";
  previousProgress: number;
  nextProgress: number;
  distanceToDestinationKm: number;
  positionAgeMinutes: number;
  arrivalRadiusKm?: number;
  arrivedAtSite?: boolean;
};

export function detectDeliveryEvents(input: DeliveryEventInput): DeliveryEventType[] {
  const events: DeliveryEventType[] = [];

  if (input.previousStatus === "Loading" && input.nextStatus === "In transit") {
    events.push("DEPARTED");
  }

  for (const threshold of [25, 50, 75] as const) {
    if (input.previousProgress < threshold && input.nextProgress >= threshold) {
      events.push(`PROGRESS_${threshold}` as DeliveryEventType);
    }
  }

  const arrivalRadiusKm = Math.max(0.05, Math.min(10, input.arrivalRadiusKm ?? 0.5));
  const nearDestinationRadiusKm = Math.max(10, arrivalRadiusKm * 4);
  if (
    input.nextStatus !== "Delivered"
    && input.distanceToDestinationKm > arrivalRadiusKm
    && input.distanceToDestinationKm <= nearDestinationRadiusKm
  ) {
    events.push("NEAR_DESTINATION");
  }

  if (input.arrivedAtSite) {
    events.push("ARRIVED_AT_SITE");
  }

  if (input.previousStatus !== "Delivered" && input.nextStatus === "Delivered") {
    events.push("ARRIVED");
  }

  if (input.positionAgeMinutes > 30) {
    events.push("GPS_STALE");
  }

  return events;
}

export function customerFacingEvent(event: DeliveryEventType) {
  return event !== "GPS_STALE"
    && event !== "GPS_BASELINE"
    && event !== "WHATSAPP_OPT_OUT"
    && event !== "MANUAL_ARRIVAL_CONFIRMED"
    && event !== "MANUAL_DELIVERED"
    && event !== "WHATSAPP_ARRIVAL_NOTIFIED"
    && event !== "MANUAL_DEPARTURE_CONFIRMED"
    && event !== "WHATSAPP_DEPARTURE_NOTIFIED"
    && event !== "SCAN_LOADED";
}

export function whatsappConsentWithdrawn(events: Array<{ type: DeliveryEventType }>) {
  return events.some((event) => event.type === "WHATSAPP_OPT_OUT");
}

// Earliest createdAt among events matching any of the given types, or null
// if none occurred -- every event type here is recorded at most once per
// delivery (see the UNIQUE (delivery_id, type) constraint backing every
// store's recordEvent), so "earliest" only matters when several different
// qualifying types are present, and picking the earliest keeps whichever
// derived deadline (e.g. tracking-link expiry) as tight as possible.
export function earliestEventAt(events: Array<{ type: DeliveryEventType; createdAt: Date }>, types: DeliveryEventType[]): Date | null {
  const matches = events.filter((event) => types.includes(event.type)).map((event) => event.createdAt.getTime());
  return matches.length ? new Date(Math.min(...matches)) : null;
}

// ARRIVED (automatic GPS completion) and MANUAL_DELIVERED (dispatcher/agency
// manual completion) are the two terminal event types -- whichever is
// present is the real "became Delivered" moment, used to tighten the public
// tracking link's expiry beyond the generic post-planned-arrival window
// (see tracking-access.ts).
export function deliveredAtFromEvents(events: Array<{ type: DeliveryEventType; createdAt: Date }>): Date | null {
  return earliestEventAt(events, ["ARRIVED", "MANUAL_DELIVERED"]);
}

// Same idea as deliveredAtFromEvents, but also treats an agency's WhatsApp
// arrival notification as an expiry trigger -- the product intent is that
// notifying the customer closes out their need for the link even before the
// delivery is formally marked Delivered (e.g. it's arrived at a relay site
// awaiting pickup, not yet handed off). See notify-arrival/route.ts.
export function trackingLinkExpiryAnchorFromEvents(events: Array<{ type: DeliveryEventType; createdAt: Date }>): Date | null {
  return earliestEventAt(events, ["ARRIVED", "MANUAL_DELIVERED", "WHATSAPP_ARRIVAL_NOTIFIED"]);
}
