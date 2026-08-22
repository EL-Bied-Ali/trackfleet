import { MANUAL_ARRIVAL_MINIMUM_SAMPLES } from "./manual-arrival-duration.ts";

export type EtaSource = "unavailable" | "baseline-model" | "route-history" | "observed-pace";
export type EtaConfidence = "none" | "low" | "medium";
export type EtaDisplayLocale = "fr" | "en" | "nl";

// Rough, intentionally coarse formatting -- these come from employee-reported
// arrival confirmations on a route with no live GPS, so a precise-looking
// number (e.g. "52.3 h") would overstate confidence the underlying data
// doesn't have. Sub-day durations show in hours; anything longer rounds to
// the nearest whole day.
function formatDurationEstimate(hours: number, locale: EtaDisplayLocale) {
  if (hours < 20) {
    const roundedHours = Math.max(1, Math.round(hours));
    return locale === "fr" ? `${roundedHours} h` : locale === "nl" ? `${roundedHours} u` : `${roundedHours}h`;
  }
  const days = Math.max(1, Math.round(hours / 24));
  return locale === "fr" ? `${days} jour${days > 1 ? "s" : ""}` : locale === "nl" ? `${days} dag${days > 1 ? "en" : ""}` : `${days} day${days === 1 ? "" : "s"}`;
}

export function etaExplanation(input: {
  source?: EtaSource | null;
  confidence?: EtaConfidence | null;
  historyTrips?: number | null;
  // See customerEtaNote: true when the destination is beyond a local/relay
  // leg our GPS-tracked trucks never physically visit.
  finalLegTrackingUnavailable?: boolean;
  // Median hours from departure to an employee-confirmed arrival at this
  // destination, over its most recent deliveries. null/0-sample-count means
  // no estimate exists yet.
  manualArrivalEstimateHours?: number | null;
  manualArrivalEstimateSampleCount?: number | null;
}, locale: EtaDisplayLocale) {
  const source = input.source ?? "unavailable";
  const confidence = input.confidence ?? "none";
  const historyTrips = Math.max(0, Math.round(input.historyTrips ?? 0));

  if (input.finalLegTrackingUnavailable) {
    const sampleCount = Math.max(0, Math.round(input.manualArrivalEstimateSampleCount ?? 0));
    if (typeof input.manualArrivalEstimateHours === "number" && sampleCount >= MANUAL_ARRIVAL_MINIMUM_SAMPLES) {
      const duration = formatDurationEstimate(input.manualArrivalEstimateHours, locale);
      const sourceLabel = {
        fr: `Estimation employé · ~${duration}`,
        en: `Employee-reported estimate · ~${duration}`,
        nl: `Schatting werknemer · ~${duration}`,
      }[locale];
      const confidenceLabel = {
        fr: `Basé sur ${sampleCount} arrivée${sampleCount > 1 ? "s" : ""} confirmée${sampleCount > 1 ? "s" : ""}`,
        en: `Based on ${sampleCount} confirmed arrival${sampleCount === 1 ? "" : "s"}`,
        nl: `Gebaseerd op ${sampleCount} bevestigde aankomst${sampleCount === 1 ? "" : "en"}`,
      }[locale];
      return { sourceLabel, confidenceLabel };
    }
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
  // See etaExplanation.
  manualArrivalEstimateHours?: number | null;
  manualArrivalEstimateSampleCount?: number | null;
}, locale: EtaDisplayLocale) {
  if (input.finalLegTrackingUnavailable) {
    const sampleCount = Math.max(0, Math.round(input.manualArrivalEstimateSampleCount ?? 0));
    if (typeof input.manualArrivalEstimateHours === "number" && sampleCount >= MANUAL_ARRIVAL_MINIMUM_SAMPLES) {
      const duration = formatDurationEstimate(input.manualArrivalEstimateHours, locale);
      return {
        fr: `Estimation : généralement environ ${duration} (${sampleCount} livraison${sampleCount > 1 ? "s" : ""} précédente${sampleCount > 1 ? "s" : ""})`,
        en: `Estimate: usually about ${duration} (based on ${sampleCount} previous deliver${sampleCount === 1 ? "y" : "ies"})`,
        nl: `Schatting: meestal ongeveer ${duration} (op basis van ${sampleCount} eerdere levering${sampleCount === 1 ? "" : "en"})`,
      }[locale];
    }
    const untrackedLegCopy = {
      fr: "Suivi GPS en direct non disponible pour la dernière étape",
      en: "Live GPS tracking is not available for the final leg",
      nl: "Live GPS-tracking is niet beschikbaar voor het laatste traject",
    };
    return untrackedLegCopy[locale];
  }

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
