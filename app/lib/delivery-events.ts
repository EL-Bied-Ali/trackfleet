export type DeliveryEventType =
  | "DEPARTED"
  | "PROGRESS_25"
  | "PROGRESS_50"
  | "PROGRESS_75"
  | "NEAR_DESTINATION"
  | "ARRIVED"
  | "GPS_STALE";

export type DeliveryEventInput = {
  previousStatus: "In transit" | "Delayed" | "Loading" | "Delivered";
  nextStatus: "In transit" | "Delayed" | "Loading" | "Delivered";
  previousProgress: number;
  nextProgress: number;
  distanceToDestinationKm: number;
  positionAgeMinutes: number;
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

  if (
    input.previousProgress < 90
    && input.nextProgress >= 90
    && input.distanceToDestinationKm > 0.5
  ) {
    events.push("NEAR_DESTINATION");
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
  return event !== "GPS_STALE";
}
