export type EtaSource = "unavailable" | "baseline-model" | "route-history" | "observed-pace";
export type EtaConfidence = "none" | "low" | "medium";
export type EtaDisplayLocale = "fr" | "en" | "nl";

export function etaExplanation(input: {
  source?: EtaSource | null;
  confidence?: EtaConfidence | null;
  historyTrips?: number | null;
  // See customerEtaNote: true when the destination is beyond a local/relay
  // leg our GPS-tracked trucks never physically visit.
  finalLegTrackingUnavailable?: boolean;
}, locale: EtaDisplayLocale) {
  const source = input.source ?? "unavailable";
  const confidence = input.confidence ?? "none";
  const historyTrips = Math.max(0, Math.round(input.historyTrips ?? 0));

  if (input.finalLegTrackingUnavailable) {
    const untrackedLegLabel = {
      fr: "Dernière étape non suivie par GPS",
      en: "Final leg not GPS-tracked",
      nl: "Laatste traject niet GPS-gevolgd",
    };
    return { sourceLabel: untrackedLegLabel[locale], confidenceLabel: "" };
  }

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

export function customerEtaNote(input: {
  source?: EtaSource | null;
  delayMinutes?: number | null;
  historyTrips?: number | null;
  // True when the destination is only reached via a local/relay leg our
  // GPS-tracked trucks never physically visit. Any delay/pace figure derived
  // from a frozen last-known GPS position would be misleading, so this takes
  // priority over the delay-minutes note below.
  finalLegTrackingUnavailable?: boolean;
}, locale: EtaDisplayLocale) {
  const untrackedLegCopy = {
    fr: "Suivi GPS en direct non disponible pour la dernière étape",
    en: "Live GPS tracking is not available for the final leg",
    nl: "Live GPS-tracking is niet beschikbaar voor het laatste traject",
  };
  if (input.finalLegTrackingUnavailable) return untrackedLegCopy[locale];

  const delayMinutes = input.delayMinutes ?? null;
  if (typeof delayMinutes === "number" && delayMinutes >= 60) return `+${Math.round(delayMinutes / 60)} h`;

  const copy = {
    fr: {
      observed: "Estimation basée sur le trajet réel",
      history: (count: number) => count > 0 ? `Estimation basée sur ${count} trajet${count > 1 ? "s" : ""} précédent${count > 1 ? "s" : ""}` : "Estimation basée sur l’historique de cette route",
      baseline: "Estimation indicative",
    },
    en: {
      observed: "Estimate based on current trip pace",
      history: (count: number) => count > 0 ? `Estimate based on ${count} previous trip${count === 1 ? "" : "s"}` : "Estimate based on this route’s history",
      baseline: "Indicative estimate",
    },
    nl: {
      observed: "Schatting op basis van de huidige rit",
      history: (count: number) => count > 0 ? `Schatting op basis van ${count} eerdere rit${count === 1 ? "" : "ten"}` : "Schatting op basis van de routehistoriek",
      baseline: "Indicatieve schatting",
    },
  }[locale];

  const count = Math.max(0, Math.round(input.historyTrips ?? 0));
  if (input.source === "observed-pace") return copy.observed;
  if (input.source === "route-history") return copy.history(count);
  return copy.baseline;
}
