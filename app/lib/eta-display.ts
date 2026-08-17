export type EtaSource = "unavailable" | "baseline-model" | "route-history" | "observed-pace";
export type EtaConfidence = "none" | "low" | "medium";
export type EtaDisplayLocale = "fr" | "en" | "nl";

export function etaExplanation(input: {
  source?: EtaSource | null;
  confidence?: EtaConfidence | null;
  historyTrips?: number | null;
}, locale: EtaDisplayLocale) {
  const source = input.source ?? "unavailable";
  const confidence = input.confidence ?? "none";
  const historyTrips = Math.max(0, Math.round(input.historyTrips ?? 0));

  const copy = {
    fr: {
      baseline: "Estimation initiale",
      history: (count: number) => `Historique de la route · ${count} voyage${count > 1 ? "s" : ""}`,
      observed: "Rythme GPS du voyage actuel",
      unavailable: "ETA indisponible",
      confidence: { none: "Confiance indisponible", low: "Confiance faible", medium: "Confiance moyenne" },
    },
    en: {
      baseline: "Initial estimate",
      history: (count: number) => `Route history · ${count} trip${count === 1 ? "" : "s"}`,
      observed: "Current trip GPS pace",
      unavailable: "ETA unavailable",
      confidence: { none: "Confidence unavailable", low: "Low confidence", medium: "Medium confidence" },
    },
    nl: {
      baseline: "Eerste schatting",
      history: (count: number) => `Routehistoriek · ${count} rit${count === 1 ? "" : "ten"}`,
      observed: "GPS-tempo van de huidige rit",
      unavailable: "ETA niet beschikbaar",
      confidence: { none: "Betrouwbaarheid niet beschikbaar", low: "Lage betrouwbaarheid", medium: "Gemiddelde betrouwbaarheid" },
    },
  }[locale];

  const sourceLabel = source === "route-history"
    ? copy.history(historyTrips)
    : source === "observed-pace"
      ? copy.observed
      : source === "baseline-model"
        ? copy.baseline
        : copy.unavailable;

  return { sourceLabel, confidenceLabel: copy.confidence[confidence] };
}
