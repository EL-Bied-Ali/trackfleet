export const DEFAULT_UNLOAD_GRACE_MINUTES = 120;
export const MIN_UNLOAD_GRACE_MINUTES = 15;
export const MAX_UNLOAD_GRACE_MINUTES = 12 * 60;

export function parseUnloadGraceMinutes(value: string | undefined) {
  if (!value?.trim()) return DEFAULT_UNLOAD_GRACE_MINUTES;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_UNLOAD_GRACE_MINUTES;
  return Math.max(MIN_UNLOAD_GRACE_MINUTES, Math.min(MAX_UNLOAD_GRACE_MINUTES, Math.round(parsed)));
}

type ArrivalDwellInput = {
  status: "In transit" | "Delayed" | "Loading" | "Delivered";
  distanceToDestinationKm: number;
  speed: number;
  positionAgeMinutes: number;
  arrivalRadiusKm: number;
  arrivalSiteSince: Date | null;
  observationAt: Date;
  unloadGraceMinutes: number;
};

export type ArrivalDwellResult = {
  insideArrivalZone: boolean;
  arrivalSiteSince: Date | null;
  justEntered: boolean;
  unloadElapsedMinutes: number;
  delivered: boolean;
};

export function evaluateArrivalDwell(input: ArrivalDwellInput): ArrivalDwellResult {
  if (input.status === "Delivered") {
    return {
      insideArrivalZone: true,
      arrivalSiteSince: input.arrivalSiteSince,
      justEntered: false,
      unloadElapsedMinutes: input.unloadGraceMinutes,
      delivered: true,
    };
  }

  const safeRadiusKm = Math.max(0.05, Math.min(10, input.arrivalRadiusKm));
  const freshPosition = input.positionAgeMinutes <= 30;
  const insideArrivalZone = freshPosition
    && input.distanceToDestinationKm <= safeRadiusKm
    && input.speed <= 5;

  if (!insideArrivalZone) {
    return {
      insideArrivalZone: false,
      arrivalSiteSince: null,
      justEntered: false,
      unloadElapsedMinutes: 0,
      delivered: false,
    };
  }

  const observationTime = input.observationAt.getTime();
  const previousSince = input.arrivalSiteSince?.getTime();
  const validPreviousSince = typeof previousSince === "number" && Number.isFinite(previousSince) && previousSince <= observationTime;
  const arrivalSiteSince = validPreviousSince ? input.arrivalSiteSince! : input.observationAt;
  const unloadElapsedMinutes = Math.max(0, (observationTime - arrivalSiteSince.getTime()) / 60_000);

  return {
    insideArrivalZone: true,
    arrivalSiteSince,
    justEntered: !validPreviousSince,
    unloadElapsedMinutes,
    delivered: unloadElapsedMinutes >= input.unloadGraceMinutes,
  };
}
