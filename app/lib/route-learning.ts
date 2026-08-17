export type RouteLearningState = {
  historicalTrips: number;
  requiredTrips: number;
  learnedStops: number;
  futureStops: number;
  etaHistoryReady: boolean;
  dwellHistoryReady: boolean;
  stage: "collecting" | "partial" | "ready";
};

export function routeLearningState(input: {
  historicalTrips: number;
  learnedStops: number;
  futureStops: number;
  requiredTrips?: number;
}): RouteLearningState {
  const requiredTrips = Math.max(1, Math.round(input.requiredTrips ?? 5));
  const historicalTrips = Math.max(0, Math.round(input.historicalTrips));
  const futureStops = Math.max(0, Math.round(input.futureStops));
  const learnedStops = Math.max(0, Math.min(futureStops, Math.round(input.learnedStops)));
  const etaHistoryReady = historicalTrips >= requiredTrips;
  const dwellHistoryReady = futureStops === 0 || learnedStops >= futureStops;
  return {
    historicalTrips,
    requiredTrips,
    learnedStops,
    futureStops,
    etaHistoryReady,
    dwellHistoryReady,
    stage: etaHistoryReady && dwellHistoryReady ? "ready" : historicalTrips > 0 || learnedStops > 0 ? "partial" : "collecting",
  };
}

export function stablePlanRouteTemplateId(
  computedRouteTemplateId: string,
  deliveryIds: string[],
  stableContexts: ReadonlyMap<string, { routeTemplateId: string } | null>,
) {
  for (const deliveryId of deliveryIds) {
    const routeTemplateId = stableContexts.get(deliveryId)?.routeTemplateId;
    if (routeTemplateId) return routeTemplateId;
  }
  return computedRouteTemplateId;
}
