"use client";

import { useState } from "react";
import type { Locale } from "./i18n";
import { maximumAgencyLocationAccuracyMeters } from "./lib/agency-access";

type AgencySite = {
  id: string;
  label: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  arrivalRadiusKm: number;
};

type CandidatePosition = {
  latitude: number;
  longitude: number;
  accuracy: number;
};

const excellentAccuracyMeters = 25;

function bestBrowserPosition() {
  return new Promise<CandidatePosition>((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("geolocation_unavailable"));
      return;
    }
    let best: CandidatePosition | null = null;
    let settled = false;
    let watchId: number | null = null;
    let timeoutId: number | null = null;
    const finish = (result?: CandidatePosition, error?: GeolocationPositionError) => {
      if (settled) return;
      settled = true;
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      if (result) resolve(result);
      else reject(error ?? new Error("geolocation_unavailable"));
    };
    watchId = navigator.geolocation.watchPosition((position) => {
      const candidate = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
      };
      if (!best || candidate.accuracy < best.accuracy) best = candidate;
      if (candidate.accuracy <= excellentAccuracyMeters) finish(candidate);
    }, (error) => finish(undefined, error), {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 12_000,
    });
    timeoutId = window.setTimeout(() => finish(best ?? undefined), 12_500);
  });
}

function mapUrl(position: CandidatePosition) {
  const offset = 0.002;
  const bbox = [
    position.longitude - offset,
    position.latitude - offset,
    position.longitude + offset,
    position.latitude + offset,
  ].join("%2C");
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${position.latitude}%2C${position.longitude}`;
}

export default function AgencyLocationSetup({
  locale,
  site,
  onLocale,
  onLogout,
  onBack,
}: {
  locale: Locale;
  site: AgencySite | null;
  onLocale: (locale: Locale) => void;
  onLogout: () => void;
  onBack?: () => void;
}) {
  const [candidate, setCandidate] = useState<CandidatePosition | null>(null);
  const [savedPosition, setSavedPosition] = useState<CandidatePosition | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const copy = {
    fr: {
      eyebrow: "ACCÈS AGENCE",
      title: "Position de l’entrée camion",
      intro: "Placez l’appareil près de l’entrée utilisée par les camions, autorisez la localisation puis vérifiez le point sur la carte.",
      current: "Position actuellement enregistrée",
      missing: "Aucune position exacte enregistrée",
      capture: "Mesurer ma position",
      measuring: "Mesure en cours…",
      accuracy: "Précision estimée",
      confirm: "Confirmer cette entrée camion",
      saving: "Enregistrement…",
      saved: "Entrée camion enregistrée.",
      inaccurate: "La précision est insuffisante. Approchez-vous d’une fenêtre ou utilisez un téléphone sur place, puis recommencez.",
      denied: "La localisation est indisponible ou refusée. Autorisez-la dans le navigateur puis recommencez.",
      warning: "Confirmez uniquement si le repère correspond réellement à l’entrée camion.",
      logout: "Déconnexion",
      back: "Retour aux opérations",
    },
    en: {
      eyebrow: "AGENCY ACCESS",
      title: "Truck entrance location",
      intro: "Place the device near the truck entrance, allow location access, then verify the point on the map.",
      current: "Currently saved position",
      missing: "No exact position saved",
      capture: "Measure my position",
      measuring: "Measuring…",
      accuracy: "Estimated accuracy",
      confirm: "Confirm this truck entrance",
      saving: "Saving…",
      saved: "Truck entrance saved.",
      inaccurate: "Accuracy is insufficient. Move near a window or use an on-site phone, then try again.",
      denied: "Location is unavailable or denied. Allow it in the browser and try again.",
      warning: "Confirm only if the marker really matches the truck entrance.",
      logout: "Sign out",
      back: "Back to operations",
    },
    nl: {
      eyebrow: "AGENTSCHAPSTOEGANG",
      title: "Locatie van de vrachtwageningang",
      intro: "Plaats het toestel bij de vrachtwageningang, sta locatie toe en controleer daarna het punt op de kaart.",
      current: "Momenteel opgeslagen positie",
      missing: "Geen exacte positie opgeslagen",
      capture: "Mijn positie meten",
      measuring: "Meten…",
      accuracy: "Geschatte nauwkeurigheid",
      confirm: "Deze vrachtwageningang bevestigen",
      saving: "Opslaan…",
      saved: "Vrachtwageningang opgeslagen.",
      inaccurate: "De nauwkeurigheid is onvoldoende. Ga dichter bij een raam staan of gebruik ter plaatse een telefoon en probeer opnieuw.",
      denied: "Locatie is niet beschikbaar of geweigerd. Sta deze toe in de browser en probeer opnieuw.",
      warning: "Bevestig alleen als de markering echt overeenkomt met de vrachtwageningang.",
      logout: "Afmelden",
      back: "Terug naar operaties",
    },
  }[locale];

  async function capture() {
    setBusy(true);
    setCandidate(null);
    setMessage("");
    try {
      const position = await bestBrowserPosition();
      if (position.accuracy > maximumAgencyLocationAccuracyMeters) {
        setMessage(copy.inaccurate);
        return;
      }
      setCandidate(position);
    } catch {
      setMessage(copy.denied);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!site || !candidate) return;
    if (!window.confirm(copy.warning)) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/sites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: site.id,
          latitude: candidate.latitude,
          longitude: candidate.longitude,
          coordinateAccuracyMeters: candidate.accuracy,
          coordinateSource: "browser",
        }),
      });
      if (!response.ok) throw new Error("site_update_failed");
      setSavedPosition(candidate);
      setCandidate(null);
      setMessage(copy.saved);
    } catch {
      setMessage(copy.denied);
    } finally {
      setBusy(false);
    }
  }

  const currentLatitude = savedPosition?.latitude ?? site?.latitude ?? null;
  const currentLongitude = savedPosition?.longitude ?? site?.longitude ?? null;

  return <main className="agency-location-page">
    <header className="agency-location-header">
      <div className="brand brand-dark"><span className="brand-mark"><span>↗</span></span><span>TrackFleet</span></div>
      <div className="agency-location-actions">
        {onBack && <button type="button" onClick={onBack}>{copy.back}</button>}
        <select value={locale} onChange={(event) => onLocale(event.target.value as Locale)} aria-label="Language">
          <option value="fr">FR</option><option value="en">EN</option><option value="nl">NL</option>
        </select>
        <button type="button" onClick={onLogout}>{copy.logout}</button>
      </div>
    </header>
    <section className="agency-location-card">
      <p className="eyebrow">{copy.eyebrow}</p>
      <h1>{copy.title}</h1>
      <p>{copy.intro}</p>
      <div className="agency-location-site">
        <strong>{site?.label ?? "TrackFleet"}</strong>
        <span>{site?.address ?? "…"}</span>
      </div>
      <div className="agency-location-current">
        <span>{copy.current}</span>
        <strong>{currentLatitude == null || currentLongitude == null ? copy.missing : `${currentLatitude.toFixed(6)}, ${currentLongitude.toFixed(6)}`}</strong>
      </div>
      <button className="primary-button agency-location-capture" type="button" disabled={busy || !site} onClick={() => void capture()}>
        {busy ? copy.measuring : copy.capture}
      </button>
      {candidate && <div className="agency-location-candidate">
        <iframe title={copy.title} src={mapUrl(candidate)} loading="lazy" referrerPolicy="no-referrer" />
        <p><strong>{candidate.latitude.toFixed(6)}, {candidate.longitude.toFixed(6)}</strong><span>{copy.accuracy} : ±{Math.round(candidate.accuracy)} m</span></p>
        <button className="primary-button" type="button" disabled={busy} onClick={() => void save()}>{busy ? copy.saving : copy.confirm}</button>
      </div>}
      {message && <p className="agency-location-message" role="status">{message}</p>}
    </section>
  </main>;
}
