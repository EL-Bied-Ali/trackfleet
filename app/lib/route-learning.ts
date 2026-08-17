export type RouteLearningState = {
  historicalTrips: number;
  requiredTrips: number;
  learnedStops: number;
  futureStops: number;
  unconfiguredStops: number;
  etaHistoryReady: boolean;
  dwellHistoryReady: boolean;
  stage: "collecting" | "partial" | "ready";
};

export function routeLearningState(input: {
  historicalTrips: number;
  learnedStops: number;
  futureStops: number;
  unconfiguredStops?: number;
  requiredTrips?: number;
}): RouteLearningState {
  const requiredTrips = Math.max(1, Math.round(input.requiredTrips ?? 5));
  const historicalTrips = Math.max(0, Math.round(input.historicalTrips));
  const futureStops = Math.max(0, Math.round(input.futureStops));
  const unconfiguredStops = Math.max(0, Math.min(futureStops, Math.round(input.unconfiguredStops ?? 0)));
  const learnedStops = Math.max(0, Math.min(futureStops - unconfiguredStops, Math.round(input.learnedStops)));
  const etaHistoryReady = historicalTrips >= requiredTrips;
  const dwellHistoryReady = unconfiguredStops === 0 && (futureStops === 0 || learnedStops >= futureStops);
  return {
    historicalTrips,
    requiredTrips,
    learnedStops,
    futureStops,
    unconfiguredStops,
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
