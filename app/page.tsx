"use client";

import { useEffect, useMemo, useState } from "react";
import { localeOptions, translations, type Locale } from "./i18n";
import InteractiveFleetMap from "./InteractiveFleetMap";
import SiteManager from "./SiteManager";
import { classifyLoginError, type LoginErrorKind } from "./lib/login-error";
import { originPreferenceKey, resolvePreferredOriginSite } from "./lib/origin-preference";
import { rankVehicleSuggestions } from "./lib/vehicle-linking";
import { activeTourDisplayId, activeTourKey, stopSequence, tourCustomerCount, tourDeliveryCount } from "./lib/tour-view";
import { customerEtaNote, etaExplanation } from "./lib/eta-display";
import { isUnassignedVehicle, resolveCreationVehicle, UNASSIGNED_VEHICLE_ID } from "./lib/delivery-vehicle-choice";
import { suggestPlannedTrip } from "./lib/trip-suggestion";

type DeliveryStatus = "In transit" | "Delayed" | "Loading" | "Delivered";
type DeliveryEventType = "DEPARTED" | "PROGRESS_25" | "PROGRESS_50" | "PROGRESS_75" | "NEAR_DESTINATION" | "DELAY_DETECTED" | "ARRIVED" | "GPS_STALE";

type Delivery = {
  id: string;
  customer: string;
  originSiteId?: string | null;
  destinationSiteId?: string | null;
  destination: string;
  truck: string;
  driver: string;
  status: DeliveryStatus;
  eta: string;
  progress: number;
  color: string;
  contact?: string;
  sendatrackVehicleId?: string;
  latitude?: number | null;
  longitude?: number | null;
  speed?: number | null;
  lastPositionAt?: string | null;
  gpsSource?: "sendatrack" | "simulation";
  trackingToken?: string | null;
  tripId?: string | null;
  routeDistanceKm?: number | null;
  remainingDistanceKm?: number | null;
  distanceToDestinationKm?: number | null;
  positionAgeMinutes?: number | null;
  gpsFresh?: boolean;
  plannedArrivalAt?: string | null;
  estimatedArrivalAt?: string | null;
  etaDelayMinutes?: number | null;
  etaConfidence?: "none" | "low" | "medium";
  etaSource?: "unavailable" | "baseline-model" | "route-history" | "observed-pace";
  etaHistoryTrips?: number;
  etaHistoricalSpeedKmh?: number | null;
  effectiveSpeedKmh?: number | null;
  destinationLatitude?: number | null;
  destinationLongitude?: number | null;
  arrivalRadiusKm?: number;
};

type DeliveryEventRow = {
  deliveryId: string;
  type: DeliveryEventType;
  progress: number;
  createdAt: string;
};

type VehicleOption = { id: string; name: string; speed: number; updatedAt: number; latitude: number; longitude: number };
type IntegrationState = { configured: boolean; connected: boolean; vehicleCount: number; error: string | null; vehicles: VehicleOption[] };
type FeatureState = { whatsappDemoEnabled: boolean };
type TourStop = { siteId: string; destination: string; plannedArrivalAt: string | null; deliveryIds: string[]; customers: string[] };
type TourPlan = { vehicleKey: string; truck: string; sendatrackVehicleId: string; routeTemplateId: string; tripId?: string | null; tripInstanceId?: string | null; originSiteId: string | null; source: "planned-arrival"; stops: TourStop[]; learning?: { historicalTrips: number; requiredTrips: number; learnedStops: number; futureStops: number; unconfiguredStops: number; etaHistoryReady: boolean; dwellHistoryReady: boolean; medianEffectiveSpeedKmh: number | null; medianDelayMinutes: number | null; stage: "collecting" | "partial" | "ready" } };
type TripHistoryItem = { id: string; routeTemplateId: string; vehicleKey: string; truck: string; sendatrackVehicleId: string; originSiteId: string | null; stops: Array<{ siteId: string; destination: string; sequence: number; plannedArrivalAt: string | null }>; status: "planned" | "active" | "completed"; createdAt: string; updatedAt: string };

type MessageEvent = {
  id: string;
  deliveryId: string;
  kind: "tracking" | "arrival";
  time: string;
};

type CompanyIdentity = { account: string; user: string };
type KnownSite = { id: string; label: string; city: string; address: string; country: "BE" | "MA"; roles: Array<"origin" | "dropoff" | "replenishment" | "destination">; latitude: number | null; longitude: number | null; arrivalRadiusKm: number; geofenceReady: boolean };

const emptyDelivery: Delivery = {
  id: "",
  customer: "",
  destination: "",
  truck: "",
  driver: "",
  status: "Loading",
  eta: "",
  progress: 0,
  color: "#6b7280",
};

const statusClass: Record<DeliveryStatus, string> = {
  "In transit": "status transit",
  Delayed: "status delayed",
  Loading: "status loading",
  Delivered: "status delivered",
};

function Icon({ children }: { children: React.ReactNode }) {
  return <span className="icon" aria-hidden="true">{children}</span>;
}

function LanguageSwitcher({ locale, label, onChange }: { locale: Locale; label: string; onChange: (locale: Locale) => void }) {
  return (
    <label className="language-switcher">
      <span className="language-symbol" aria-hidden="true">◎</span>
      <span className="sr-only">{label}</span>
      <select value={locale} onChange={(event) => onChange(event.target.value as Locale)} aria-label={label}>
        {localeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function LoginScreen({ locale, busy, error, onLocale, onSubmit }: { locale: Locale; busy: boolean; error: LoginErrorKind | ""; onLocale: (locale: Locale) => void; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void }) {
  const copy = {
    fr: { eyebrow: "ESPACE ENTREPRISE", title: "Connectez votre flotte SENDATRACK", body: "Utilisez les mêmes identifiants que dans l’application SENDATRACK. Votre espace TrackFleet sera reconnu automatiquement.", account: "Compte", user: "Utilisateur", password: "Mot de passe", submit: "Accéder à TrackFleet", loading: "Connexion…", invalidCredentials: "Identifiants SENDATRACK incorrects.", serviceUnavailable: "SENDATRACK est temporairement indisponible. Réessayez dans quelques instants.", loginFailed: "Connexion impossible. Réessayez.", privacy: "Connexion chiffrée côté TrackFleet · aucune donnée visible par vos clients" },
    en: { eyebrow: "COMPANY PORTAL", title: "Connect your SENDATRACK fleet", body: "Use the same credentials as in the SENDATRACK app. Your TrackFleet workspace will be recognized automatically.", account: "Account", user: "User", password: "Password", submit: "Open TrackFleet", loading: "Connecting…", invalidCredentials: "Incorrect SENDATRACK credentials.", serviceUnavailable: "SENDATRACK is temporarily unavailable. Please try again shortly.", loginFailed: "Unable to sign in. Please try again.", privacy: "Encrypted by TrackFleet · credentials are never visible to customers" },
    nl: { eyebrow: "BEDRIJFSPORTAAL", title: "Koppel uw SENDATRACK-wagenpark", body: "Gebruik dezelfde gegevens als in de SENDATRACK-app. Uw TrackFleet-ruimte wordt automatisch herkend.", account: "Account", user: "Gebruiker", password: "Wachtwoord", submit: "TrackFleet openen", loading: "Verbinden…", invalidCredentials: "Onjuiste SENDATRACK-gegevens.", serviceUnavailable: "SENDATRACK is tijdelijk niet beschikbaar. Probeer het zo opnieuw.", loginFailed: "Aanmelden mislukt. Probeer opnieuw.", privacy: "Versleuteld door TrackFleet · nooit zichtbaar voor klanten" },
  }[locale];
  return <main className="login-page">
    <header className="login-header"><span className="brand brand-dark"><span className="brand-mark"><span>↗</span></span><span>TrackFleet</span></span><LanguageSwitcher locale={locale} label="Language" onChange={onLocale} /></header>
    <section className="login-layout">
      <div className="login-story"><p className="eyebrow">{copy.eyebrow}</p><h1>{copy.title}</h1><p>{copy.body}</p><div className="login-route"><span>BE</span><i /><b>↗</b><i /><span>MA</span></div><small>Belgique · France · Espagne · Maroc</small></div>
      <form className="login-card" onSubmit={onSubmit}>
        <div className="login-provider"><span>⌖</span><div><strong>SENDATRACK</strong><small>GPS fleet connection</small></div></div>
        <label>{copy.account}<input name="accountID" autoComplete="organization" required placeholder="Compte SENDATRACK" /></label>
        <label>{copy.user}<input name="user" autoComplete="username" required placeholder="Utilisateur" /></label>
        <label>{copy.password}<input name="password" type="password" autoComplete="current-password" required placeholder="••••••••" /></label>
        {error && <p className="login-error" role="alert">{error === "invalid_credentials" ? copy.invalidCredentials : error === "service_unavailable" ? copy.serviceUnavailable : copy.loginFailed}</p>}
        <button className="login-submit" disabled={busy}>{busy ? copy.loading : copy.submit}<span>→</span></button>
        <p className="login-privacy">⌁ {copy.privacy}</p>
      </form>
    </section>
  </main>;
}

export default function Home() {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [view, setView] = useState<"dispatch" | "customer">("dispatch");
  const [modalOpen, setModalOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [filter, setFilter] = useState("All deliveries");
  const [showPopover, setShowPopover] = useState(true);
  const [creating, setCreating] = useState(false);
  const [whatsAppBusy, setWhatsAppBusy] = useState<"tracking" | "arrival" | null>(null);
  const [locale, setLocale] = useState<Locale>("en");
  const [authState, setAuthState] = useState<"loading" | "anonymous" | "authenticated">("loading");
  const [dispatchDataState, setDispatchDataState] = useState<"loading" | "ready" | "error">("loading");
  const [company, setCompany] = useState<CompanyIdentity | null>(null);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState<LoginErrorKind | "">("");
  const [publicTrackingState, setPublicTrackingState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [integration, setIntegration] = useState<IntegrationState>({ configured: false, connected: false, vehicleCount: 0, error: null, vehicles: [] });
  const [features, setFeatures] = useState<FeatureState>({ whatsappDemoEnabled: false });
  const [stopPlans, setStopPlans] = useState<TourPlan[]>([]);
  const [trips, setTrips] = useState<TripHistoryItem[]>([]);
  const [deliveryEvents, setDeliveryEvents] = useState<DeliveryEventRow[]>([]);
  const [knownSites, setKnownSites] = useState<KnownSite[]>([]);
  const [defaultOriginSiteId, setDefaultOriginSiteId] = useState("");
  const [vehicleLinkOpen, setVehicleLinkOpen] = useState(false);
  const [vehicleLinkSearch, setVehicleLinkSearch] = useState("");
  const [vehicleLinkChoice, setVehicleLinkChoice] = useState("");
  const [vehicleLinkBusy, setVehicleLinkBusy] = useState(false);
  const [tripAssignBusy, setTripAssignBusy] = useState<string | null>(null);
  const [tripCreateDeliveryId, setTripCreateDeliveryId] = useState<string | null>(null);
  const [tripCreateVehicleId, setTripCreateVehicleId] = useState("");
  const [tripCreateManualTruck, setTripCreateManualTruck] = useState("");
  const [tripCreateBusy, setTripCreateBusy] = useState(false);
  const [messageEvents, setMessageEvents] = useState<MessageEvent[]>([]);
  const t = translations[locale];

  useEffect(() => {
    function syncViewFromUrl() {
      const searchParams = new URLSearchParams(window.location.search);
      const trackingId = searchParams.get("tracking");
      const requestedLocale = searchParams.get("lang");
      if (requestedLocale === "en" || requestedLocale === "fr" || requestedLocale === "nl") setLocale(requestedLocale);
      const matchingDelivery = deliveries.find((delivery) => delivery.id === trackingId || delivery.trackingToken === trackingId);
      if (trackingId) {
        if (matchingDelivery) setSelectedId(matchingDelivery.id);
        setView("customer");
      } else {
        setView("dispatch");
      }
    }

    syncViewFromUrl();
    window.addEventListener("popstate", syncViewFromUrl);
    return () => window.removeEventListener("popstate", syncViewFromUrl);
  }, [deliveries]);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("tracking")) {
      setPublicTrackingState("loading");
      setAuthState("anonymous");
      return;
    }
    let active = true;
    void fetch("/api/auth/session", { cache: "no-store" }).then(async (response) => {
      if (!active) return;
      if (!response.ok) { setAuthState("anonymous"); return; }
      const data = await response.json() as { company: CompanyIdentity };
      setCompany(data.company);
      setDispatchDataState("loading");
      setAuthState("authenticated");
    }).catch(() => { if (active) setAuthState("anonymous"); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (authState !== "authenticated") return;
    let active = true;
    async function refreshSites() {
      try {
        const response = await fetch("/api/sites", { cache: "no-store" });
        const data = response.ok ? await response.json() as { sites: KnownSite[] } : { sites: [] };
        if (active) setKnownSites(data.sites ?? []);
      } catch {
        if (active) setKnownSites([]);
      }
    }
    void refreshSites();
    const handleSitesChanged = () => void refreshSites();
    window.addEventListener("trackfleet-sites-changed", handleSitesChanged);
    return () => { active = false; window.removeEventListener("trackfleet-sites-changed", handleSitesChanged); };
  }, [authState]);

  useEffect(() => {
    if (!company || !knownSites.length) {
      setDefaultOriginSiteId("");
      return;
    }
    const originIds = knownSites.filter((site) => site.roles.includes("origin")).map((site) => site.id);
    const saved = window.localStorage.getItem(originPreferenceKey(company));
    setDefaultOriginSiteId((current) => resolvePreferredOriginSite(saved, originIds, current));
  }, [company, knownSites]);

  useEffect(() => {
    const requestedLocale = new URLSearchParams(window.location.search).get("lang");
    const savedLocale = window.localStorage.getItem("trackfleet-locale");
    if (!requestedLocale && (savedLocale === "en" || savedLocale === "fr" || savedLocale === "nl")) setLocale(savedLocale);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("trackfleet-locale", locale);
    document.documentElement.lang = locale === "nl" ? "nl-BE" : locale;
  }, [locale]);

  useEffect(() => {
    let active = true;
    async function refresh(silent = false) {
      try {
        const tracking = new URLSearchParams(window.location.search).get("tracking");
        if (!tracking && authState !== "authenticated") return;
        const endpoint = tracking ? `/api/deliveries?tracking=${encodeURIComponent(tracking)}` : "/api/deliveries";
        const response = await fetch(endpoint, { cache: "no-store" });
        if (!response.ok) throw new Error("Delivery service unavailable");
        const data = await response.json() as { deliveries: Delivery[]; integration?: IntegrationState; features?: FeatureState; events?: DeliveryEventRow[]; stopPlans?: TourPlan[]; trips?: TripHistoryItem[] };
        if (!active) return;
        if (tracking && data.deliveries.length) {
          setDeliveries(data.deliveries);
          setDeliveryEvents(data.events ?? []);
          setSelectedId(data.deliveries[0].id);
          setPublicTrackingState("ready");
        } else if (!tracking) {
          setDeliveries(data.deliveries);
          setDispatchDataState("ready");
          setSelectedId((current) => data.deliveries.length && !data.deliveries.some((delivery) => delivery.id === current) ? data.deliveries[0].id : current);
        }
        if (data.integration) setIntegration(data.integration);
        if (data.features) setFeatures(data.features);
        if (!tracking) setStopPlans(data.stopPlans ?? []);
        if (!tracking) setTrips(data.trips ?? []);
      } catch {
        const tracking = new URLSearchParams(window.location.search).get("tracking");
        if (tracking) setPublicTrackingState("error");
        if (active && !tracking) {
          setDeliveries([]);
          setStopPlans([]);
          setTrips([]);
          setDispatchDataState("error");
        }
        if (active && !silent) setToast(translations[locale].cloudReconnecting);
      }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(true), 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [authState, locale]);

  useEffect(() => {
    function closeModalWithEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setModalOpen(false);
    }
    window.addEventListener("keydown", closeModalWithEscape);
    return () => window.removeEventListener("keydown", closeModalWithEscape);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // A newly connected company can have live GPS vehicles before its first
  // paper delivery has been entered in TrackFleet. Keep the dashboard usable
  // while that delivery list is empty instead of dereferencing `undefined`.
  const selected = deliveries.find((item) => item.id === selectedId) ?? deliveries[0] ?? emptyDelivery;
  const vehicleLabel = (delivery: Pick<Delivery, "truck" | "sendatrackVehicleId">) => isUnassignedVehicle(delivery)
    ? (locale === "fr" ? "À affecter" : locale === "nl" ? "Toe te wijzen" : "To assign")
    : delivery.truck;
  const selectedEtaExplanation = etaExplanation({ source: selected.etaSource, confidence: selected.etaConfidence, historyTrips: selected.etaHistoryTrips }, locale);
  const customerCopy = t.customerStatus[selected.status];
  const destinationSite = knownSites.find((site) => site.id === selected.destinationSiteId);
  const headingToMorocco = destinationSite?.country === "MA" || selected.destination.toUpperCase().includes("MAROC") || selected.destination.endsWith(", MA");
  const routeDirection = headingToMorocco ? t.belgiumToMorocco : t.moroccoToBelgium;
  const visibleDeliveries = useMemo(() => {
    if (filter === "All deliveries") return deliveries;
    return deliveries.filter((delivery) => delivery.status === filter);
  }, [deliveries, filter]);
  const mapDeliveries = integration.connected
    ? deliveries.filter((delivery) => delivery.gpsSource === "sendatrack")
    : deliveries;
  const unassignedDeliveries = deliveries.filter((delivery) => delivery.status !== "Delivered" && isUnassignedVehicle(delivery));
  const tripSuggestions = new Map(unassignedDeliveries.map((delivery) => [delivery.id, suggestPlannedTrip(delivery, trips)]));
  const completedWithPlan = deliveries.filter((delivery) => delivery.status === "Delivered" && delivery.etaDelayMinutes != null);
  const onTimeRate = completedWithPlan.length
    ? Math.round((completedWithPlan.filter((delivery) => (delivery.etaDelayMinutes ?? 0) <= 0).length / completedWithPlan.length) * 1000) / 10
    : null;
  const delayedCount = deliveries.filter((delivery) => delivery.status !== "Delivered" && (delivery.status === "Delayed" || (delivery.etaDelayMinutes ?? 0) >= 60)).length;
  const vehicleLinkSuggestions = rankVehicleSuggestions(vehicleLinkSearch || selected?.truck || "", integration.vehicles);
  const liveKpiCopy = {
    fr: { completed: "terminées", noHistory: "Pas encore d'historique", onTimeBody: "Basé sur les livraisons suivies et terminées", onTimeEmpty: "Disponible après les premières livraisons terminées", noDelay: "Aucun retard ETA important détecté" },
    en: { completed: "completed", noHistory: "No history yet", onTimeBody: "Based on completed tracked deliveries", onTimeEmpty: "Available after the first completed deliveries", noDelay: "No material ETA delay detected" },
    nl: { completed: "voltooid", noHistory: "Nog geen historiek", onTimeBody: "Gebaseerd op voltooide gevolgde leveringen", onTimeEmpty: "Beschikbaar na de eerste voltooide leveringen", noDelay: "Geen belangrijke ETA-vertraging gedetecteerd" },
  }[locale];

  async function copyDeliveryLink(deliveryId: string) {
    const delivery = deliveries.find((item) => item.id === deliveryId);
    const link = new URL(window.location.origin);
    link.searchParams.set("tracking", delivery?.trackingToken || deliveryId);
    link.searchParams.set("lang", locale);
    const helper = document.createElement("textarea");
    helper.value = link.toString();
    helper.style.position = "fixed";
    helper.style.opacity = "0";
    document.body.appendChild(helper);
    helper.select();
    let copied = document.execCommand("copy");
    helper.remove();
    if (!copied) {
      try {
        await navigator.clipboard.writeText(link.toString());
        copied = true;
      } catch {
        copied = false;
      }
    }
    setToast(copied ? t.linkCopied : t.copyFailed);
  }

  async function copyTrackingLink() {
    await copyDeliveryLink(selected.id);
  }

  function trackingUrl(deliveryId: string) {
    const delivery = deliveries.find((item) => item.id === deliveryId);
    const link = new URL(window.location.origin);
    link.searchParams.set("tracking", delivery?.trackingToken || deliveryId);
    link.searchParams.set("lang", locale);
    return link.toString();
  }

  async function sendWhatsAppMessage(kind: "tracking" | "arrival") {
    setWhatsAppBusy(kind);
    try {
      const response = await fetch("/api/whatsapp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind,
          deliveryId: selected.id,
          customer: selected.customer,
          destination: selected.destination,
          trackingUrl: trackingUrl(selected.id),
        }),
      });
      if (!response.ok) throw new Error("WhatsApp demo send failed");
      setMessageEvents((events) => [
        { id: `${selected.id}-${kind}-${Date.now()}`, deliveryId: selected.id, kind, time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) },
        ...events,
      ].slice(0, 4));
      setToast(kind === "tracking" ? t.whatsAppSent : t.arrivalSent(selected.id));
      return true;
    } catch {
      setToast(t.whatsAppFailed);
      return false;
    } finally {
      setWhatsAppBusy(null);
    }
  }

  async function simulateArrival() {
    if (selected.status === "Delivered") return;
    const sent = await sendWhatsAppMessage("arrival");
    if (!sent) return;
    setDeliveries((items) => items.map((delivery) => delivery.id === selected.id
      ? { ...delivery, status: "Delivered", progress: 100, eta: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }
      : delivery));
  }

  function openCustomerView() {
    const link = new URL(window.location.origin);
    link.searchParams.set("tracking", selected.trackingToken || selected.id);
    link.searchParams.set("lang", locale);
    window.history.pushState({}, "", link);
    setView("customer");
  }

  function openDispatchView() {
    const dashboardUrl = new URL(window.location.origin);
    dashboardUrl.searchParams.set("lang", locale);
    window.history.pushState({}, "", dashboardUrl);
    setView("dispatch");
  }

  function changeLocale(nextLocale: Locale) {
    setLocale(nextLocale);
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("lang", nextLocale);
    window.history.replaceState({}, "", nextUrl);
  }

  async function login(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginBusy(true);
    setLoginError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accountID: form.get("accountID"), user: form.get("user"), password: form.get("password") }) });
      const data = await response.json() as { company?: CompanyIdentity; error?: string };
      if (!response.ok) {
        setLoginError(classifyLoginError(response.status, data.error));
        return;
      }
      if (!data.company) {
        setLoginError("login_failed");
        return;
      }
      setCompany(data.company);
      setAuthState("authenticated");
    } catch {
      setLoginError("login_failed");
    } finally {
      setLoginBusy(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/session", { method: "DELETE" });
    setCompany(null);
    setDeliveries([]);
    setStopPlans([]);
    setDispatchDataState("loading");
    setAuthState("anonymous");
  }

  async function linkSelectedVehicle() {
    if (!vehicleLinkChoice) return;
    setVehicleLinkBusy(true);
    try {
      const response = await fetch("/api/deliveries/link-vehicle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deliveryId: selected.id, vehicleId: vehicleLinkChoice }),
      });
      if (!response.ok) throw new Error("vehicle_link_failed");
      const data = await response.json() as { delivery: Delivery };
      setDeliveries((items) => items.map((delivery) => delivery.id === data.delivery.id ? { ...delivery, ...data.delivery } : delivery));
      setVehicleLinkOpen(false);
      setVehicleLinkSearch("");
      setVehicleLinkChoice("");
      setToast(locale === "fr" ? "Véhicule SENDATRACK associé." : locale === "nl" ? "SENDATRACK-voertuig gekoppeld." : "SENDATRACK vehicle linked.");
    } catch {
      setToast(locale === "fr" ? "Impossible d’associer ce véhicule." : locale === "nl" ? "Voertuig koppelen mislukt." : "Could not link this vehicle.");
    } finally {
      setVehicleLinkBusy(false);
    }
  }

  async function assignSuggestedTrip(deliveryId: string, tripId: string) {
    setTripAssignBusy(deliveryId);
    try {
      const response = await fetch("/api/deliveries/assign-trip", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deliveryId, tripId }),
      });
      if (!response.ok) throw new Error("trip_assignment_failed");
      const data = await response.json() as { delivery: Delivery };
      setDeliveries((items) => items.map((delivery) => delivery.id === data.delivery.id ? { ...delivery, ...data.delivery } : delivery));
      setToast(locale === "fr" ? "Colis affecté au voyage planifié." : locale === "nl" ? "Zending aan de geplande rit toegewezen." : "Parcel assigned to the planned trip.");
    } catch {
      setToast(locale === "fr" ? "L’affectation n’est plus disponible. Actualisez la tournée." : locale === "nl" ? "Deze toewijzing is niet meer beschikbaar. Vernieuw de rit." : "This assignment is no longer available. Refresh the trip.");
    } finally {
      setTripAssignBusy(null);
    }
  }

  async function createPlannedTrip(deliveryId: string) {
    const manualTruck = tripCreateManualTruck.trim();
    if (!tripCreateVehicleId && !manualTruck) {
      setToast(locale === "fr" ? "Choisissez un camion ou saisissez son nom / sa plaque." : locale === "nl" ? "Kies een voertuig of voer naam / nummerplaat in." : "Choose a vehicle or enter its name / plate.");
      return;
    }
    setTripCreateBusy(true);
    try {
      const response = await fetch("/api/deliveries/create-trip", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ deliveryId, vehicleId: tripCreateVehicleId, manualTruck }) });
      if (!response.ok) throw new Error("trip_creation_failed");
      const data = await response.json() as { delivery: Delivery; trip: TripHistoryItem };
      setDeliveries((items) => items.map((delivery) => delivery.id === data.delivery.id ? { ...delivery, ...data.delivery } : delivery));
      setTrips((items) => [data.trip, ...items.filter((trip) => trip.id !== data.trip.id)]);
      setTripCreateDeliveryId(null);
      setTripCreateVehicleId("");
      setTripCreateManualTruck("");
      setToast(locale === "fr" ? "Voyage planifié créé et colis affecté." : locale === "nl" ? "Geplande rit aangemaakt en zending toegewezen." : "Planned trip created and parcel assigned.");
    } catch {
      setToast(locale === "fr" ? "Impossible de créer ce voyage planifié." : locale === "nl" ? "Geplande rit kon niet worden aangemaakt." : "Could not create this planned trip.");
    } finally {
      setTripCreateBusy(false);
    }
  }

  async function createDelivery(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const selectedVehicleId = String(form.get("sendatrackVehicleId") ?? "").trim();
    const manualTruck = String(form.get("manualTruck") ?? "").trim();
    const vehicleChoice = resolveCreationVehicle({ manualTruck, selectedVehicleId, vehicles: integration.vehicles });
    const truck = vehicleChoice.truck;
    const originSiteId = String(form.get("originSiteId") ?? "").trim();
    if (company && originSiteId) {
      window.localStorage.setItem(originPreferenceKey(company), originSiteId);
      setDefaultOriginSiteId(originSiteId);
    }
    const destinationSiteId = String(form.get("destinationSiteId") ?? "").trim();
    const selectedSite = knownSites.find((site) => site.id === destinationSiteId);
    const destination = selectedSite?.address ?? "";
    const plannedArrivalInput = String(form.get("plannedArrivalAt") ?? "").trim();
    const plannedArrivalAt = plannedArrivalInput ? new Date(plannedArrivalInput).toISOString() : "";
    const draftDelivery = {
      customer: String(form.get("customer")),
      originSiteId,
      destination,
      destinationSiteId: selectedSite?.id ?? "",
      destinationLatitude: selectedSite?.latitude ?? null,
      destinationLongitude: selectedSite?.longitude ?? null,
      arrivalRadiusKm: selectedSite?.arrivalRadiusKm ?? 0.5,
      truck,
      sendatrackVehicleId: vehicleChoice.sendatrackVehicleId,
      plannedArrivalAt,
      contact: String(form.get("contact")),
    };
    setCreating(true);
    try {
      const response = await fetch("/api/deliveries", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(draftDelivery) });
      if (!response.ok) throw new Error("Could not save delivery");
      const data = (await response.json()) as { delivery: Delivery };
      setDeliveries((items) => [data.delivery, ...items.filter((item) => item.id !== data.delivery.id)]);
      setSelectedId(data.delivery.id);
      setShowPopover(true);
      setModalOpen(false);
      setToast(t.created(data.delivery.id));
    } catch {
      setToast(t.createFailed);
    } finally {
      setCreating(false);
    }
  }

  if (view === "customer" && publicTrackingState === "loading") return <main className="login-page login-loading"><div className="brand brand-dark"><span className="brand-mark"><span>↗</span></span><span>TrackFleet</span></div></main>;
  if (view === "customer" && publicTrackingState === "error") return <main className="login-page login-loading"><section className="tracking-error"><div className="brand brand-dark"><span className="brand-mark"><span>↗</span></span><span>TrackFleet</span></div><h1>Lien de suivi introuvable</h1><p>Vérifiez le lien reçu ou contactez l’entreprise qui vous l’a envoyé.</p></section></main>;
  if (view !== "customer" && authState === "loading") return <main className="login-page login-loading"><div className="brand brand-dark"><span className="brand-mark"><span>↗</span></span><span>TrackFleet</span></div></main>;
  if (view !== "customer" && authState === "anonymous") return <LoginScreen locale={locale} busy={loginBusy} error={loginError} onLocale={changeLocale} onSubmit={login} />;
  if (view !== "customer" && authState === "authenticated" && dispatchDataState === "loading") return <main className="login-page login-loading"><div className="brand brand-dark"><span className="brand-mark"><span>↗</span></span><span>TrackFleet</span></div></main>;
  if (view !== "customer" && authState === "authenticated" && dispatchDataState === "error") return <main className="login-page login-loading"><section className="tracking-error"><div className="brand brand-dark"><span className="brand-mark"><span>↗</span></span><span>TrackFleet</span></div><h1>{locale === "fr" ? "Données temporairement indisponibles" : locale === "nl" ? "Gegevens tijdelijk niet beschikbaar" : "Data temporarily unavailable"}</h1><p>{locale === "fr" ? "TrackFleet n’affiche aucune donnée de démonstration à la place de vos données réelles." : locale === "nl" ? "TrackFleet toont geen demogegevens in plaats van uw echte gegevens." : "TrackFleet will not show demo data in place of your real data."}</p><button className="primary-button" onClick={() => window.location.reload()}>{locale === "fr" ? "Réessayer" : locale === "nl" ? "Opnieuw proberen" : "Retry"}</button></section></main>;

  if (view === "customer") {
    const copy = {
      fr: {
        progress: "Trajet effectué",
        remaining: "Distance restante",
        speed: "Vitesse GPS",
        gps: "Dernière position",
        fresh: "GPS à jour",
        noGps: "Position indisponible",
        current: "Position actuelle",
        currentDetail: (progress: number) => `${progress}% du trajet effectué`,
        destination: "Destination",
        events: {
          DEPARTED: "Camion parti",
          PROGRESS_25: "25% du trajet effectué",
          PROGRESS_50: "Mi-parcours atteint",
          PROGRESS_75: "75% du trajet effectué",
          NEAR_DESTINATION: "Le camion approche",
          DELAY_DETECTED: "Retard détecté",
          ARRIVED: "Livraison arrivée",
          GPS_STALE: "Position GPS ancienne",
        } as Record<DeliveryEventType, string>,
      },
      en: {
        progress: "Trip completed",
        remaining: "Distance remaining",
        speed: "GPS speed",
        gps: "Last position",
        fresh: "GPS up to date",
        noGps: "Position unavailable",
        current: "Current position",
        currentDetail: (progress: number) => `${progress}% of the trip completed`,
        destination: "Destination",
        events: {
          DEPARTED: "Truck departed",
          PROGRESS_25: "25% of the trip completed",
          PROGRESS_50: "Halfway point reached",
          PROGRESS_75: "75% of the trip completed",
          NEAR_DESTINATION: "Truck is approaching",
          DELAY_DETECTED: "Delay detected",
          ARRIVED: "Delivery arrived",
          GPS_STALE: "GPS position is old",
        } as Record<DeliveryEventType, string>,
      },
      nl: {
        progress: "Traject voltooid",
        remaining: "Resterende afstand",
        speed: "GPS-snelheid",
        gps: "Laatste positie",
        fresh: "GPS is actueel",
        noGps: "Positie niet beschikbaar",
        current: "Huidige positie",
        currentDetail: (progress: number) => `${progress}% van het traject voltooid`,
        destination: "Bestemming",
        events: {
          DEPARTED: "Vrachtwagen vertrokken",
          PROGRESS_25: "25% van het traject voltooid",
          PROGRESS_50: "Halverwege bereikt",
          PROGRESS_75: "75% van het traject voltooid",
          NEAR_DESTINATION: "Vrachtwagen nadert",
          DELAY_DETECTED: "Vertraging gedetecteerd",
          ARRIVED: "Levering aangekomen",
          GPS_STALE: "GPS-positie is verouderd",
        } as Record<DeliveryEventType, string>,
      },
    }[locale];
    const dateLocale = locale === "fr" ? "fr-BE" : locale === "nl" ? "nl-BE" : "en-GB";
    const formatEventTime = (value: string) => new Date(value).toLocaleString(dateLocale, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
    const gpsText = selected.positionAgeMinutes == null
      ? copy.noGps
      : selected.gpsFresh
        ? `${copy.fresh} · ${selected.positionAgeMinutes} min`
        : `${selected.positionAgeMinutes} min`;
    const displayedEta = selected.estimatedArrivalAt
      ? new Date(selected.estimatedArrivalAt).toLocaleString(dateLocale, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
      : selected.plannedArrivalAt
        ? new Date(selected.plannedArrivalAt).toLocaleString(dateLocale, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
        : selected.eta;
    const etaNote = customerEtaNote({
      source: selected.etaSource,
      delayMinutes: selected.etaDelayMinutes,
      historyTrips: selected.etaHistoryTrips,
    }, locale);

    return (
      <main className="customer-page">
        <header className="customer-header">
          <button type="button" className="brand brand-dark" onClick={openDispatchView}>
            <span className="brand-mark"><span>↗</span></span>
            <span>TrackFleet</span>
          </button>
          <div className="customer-header-actions"><LanguageSwitcher locale={locale} label={t.language} onChange={changeLocale} /><div className="secure-pill"><span>●</span> {t.secureLink}</div></div>
        </header>

        <section className="customer-content">
          <div className="customer-intro">
            <div>
              <p className="eyebrow">{t.deliveryLabel} {selected.id}</p>
              <h1>{customerCopy.headline}</h1>
              <p className="customer-subtitle">{customerCopy.subtitle(selected.destination)}</p>
              <div className="route-summary"><span>↗</span><strong>{routeDirection}</strong><small>{t.internationalCorridor}</small></div>
            </div>
            <div className="eta-card">
              <span>{t.estimatedArrival}</span>
              <strong>{displayedEta}</strong>
              <small className={`eta-${selected.etaDelayMinutes != null && selected.etaDelayMinutes >= 60 ? "delayed" : selected.status.toLowerCase().replace(" ", "-")}`}>{etaNote}</small>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 18 }}>
            <article className="stat-card"><div className="stat-head"><span>{copy.progress}</span><Icon>↗</Icon></div><div><strong>{selected.progress}%</strong></div><div className="progress"><div><i style={{ width: `${selected.progress}%` }} /></div></div></article>
            <article className="stat-card"><div className="stat-head"><span>{copy.remaining}</span><Icon>◇</Icon></div><div><strong>{selected.remainingDistanceKm == null ? "—" : `${selected.remainingDistanceKm.toLocaleString(dateLocale)} km`}</strong></div><p>{selected.routeDistanceKm == null ? "" : `${Math.round(selected.routeDistanceKm).toLocaleString(dateLocale)} km total`}</p></article>
            <article className="stat-card"><div className="stat-head"><span>{copy.speed}</span><Icon>▰</Icon></div><div><strong>{selected.speed == null ? "—" : `${Math.round(selected.speed)} km/h`}</strong></div><p>{selected.status === "Delivered" ? t.statuses.Delivered : t.statuses[selected.status]}</p></article>
            <article className="stat-card"><div className="stat-head"><span>{copy.gps}</span><Icon>⌖</Icon></div><div><strong>{selected.gpsFresh ? "●" : selected.positionAgeMinutes == null ? "—" : "△"}</strong></div><p>{gpsText}</p></article>
          </div>

          <div className="customer-grid">
            <div className="map customer-map">
              <InteractiveFleetMap deliveries={deliveries} selectedId={selectedId} customerMode label={`${routeDirection} · ${selected.truck}`} />
              <div className="map-live"><i className={selected.gpsFresh ? "" : "fallback"} /> {gpsText}</div>
            </div>

            <aside className="journey-card">
              <div className="journey-title">
                <div className="mini-truck">▰</div>
                <div><strong>{selected.truck}</strong><span>{t.yourVehicle}</span></div>
              </div>
              <div className="timeline">
                {deliveryEvents.length > 0 ? deliveryEvents.map((event) => (
                  <div className={`timeline-step ${event.type === "GPS_STALE" || event.type === "DELAY_DETECTED" ? "is-delayed" : "done"}`} key={`${event.deliveryId}-${event.type}`}>
                    <i>{event.type === "GPS_STALE" || event.type === "DELAY_DETECTED" ? "!" : "✓"}</i>
                    <div><strong>{copy.events[event.type]}</strong><span>{formatEventTime(event.createdAt)} · {event.progress}%</span></div>
                  </div>
                )) : <div className="timeline-step done"><i>✓</i><div><strong>{t.orderPrepared}</strong><span>{t.deliveryLabel} {selected.id}</span></div></div>}
                {selected.status !== "Delivered" && <div className="timeline-step active"><i>●</i><div><strong>{copy.current}</strong><span>{copy.currentDetail(selected.progress)}</span></div></div>}
                <div className={selected.status === "Delivered" ? "timeline-step done" : "timeline-step"}><i>{selected.status === "Delivered" ? "✓" : "◆"}</i><div><strong>{copy.destination}</strong><span>{selected.destination}{selected.distanceToDestinationKm == null ? "" : ` · ${Math.round(selected.distanceToDestinationKm)} km`}</span></div></div>
              </div>
              <div className="privacy-note"><Icon>⌁</Icon><p><strong>{t.privacyTitle}</strong><span>{t.privacyBody}</span></p></div>
            </aside>
          </div>

          <div className="customer-footer"><span>{t.needHelp}</span><strong>{t.contactSender}</strong></div>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark"><span>↗</span></span><span>TrackFleet</span></div>
        <nav aria-label="Main navigation">
          <button className="nav-item active"><Icon>▦</Icon>{t.overview}</button>
          <button className="nav-item" disabled><Icon>▰</Icon>{t.fleet} <span className="nav-count">{integration.connected ? integration.vehicleCount : "—"}</span></button>
          <button className="nav-item" disabled><Icon>◇</Icon>{t.deliveries} <span className="nav-count">{deliveries.length}</span></button>
          <button className="nav-item" disabled><Icon>◉</Icon>{t.customers}</button>
        </nav>
        <div className="sidebar-divider" />
        <nav>
          <button className="nav-item" disabled><Icon>⚙</Icon>{t.settings}</button>
          <button className="nav-item" disabled><Icon>?</Icon>{t.helpCentre}</button>
        </nav>
        <div className="sidebar-spacer" />
        <div className="gps-card">
          <div className="gps-icon">⌖</div>
          <strong>{integration.connected ? t.gpsConnected : integration.configured ? t.gpsIssue : t.gpsPending}</strong>
          <p>{integration.connected ? t.gpsConnectedBody(integration.vehicleCount) : integration.configured ? t.gpsIssueBody : t.gpsPendingBody}</p>
          <span className={`gps-coming ${integration.connected ? "is-live" : ""}`}>{integration.connected ? t.gpsAutomatic : t.gpsFallback}</span>
        </div>
        <div className="profile"><div className="avatar">{(company?.user || "TF").slice(0, 2).toUpperCase()}</div><div><strong>{company?.user || "TrackFleet"}</strong><span>{company?.account || t.dispatcher}</span></div><button aria-label="Déconnexion" onClick={() => void logout()}>↪</button></div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div><h1>{t.greeting}</h1><p>{t.greetingSub}</p></div>
          <div className="top-actions"><LanguageSwitcher locale={locale} label={t.language} onChange={changeLocale} /><SiteManager locale={locale} /><button className="primary-button" onClick={() => setModalOpen(true)}><span>＋</span>{t.newDelivery}</button></div>
        </header>

        <div className="stats-grid">
          <article className="stat-card"><div className="stat-head"><span>{t.activeDeliveries}</span><Icon>◇</Icon></div><div><strong>{deliveries.filter((delivery) => delivery.status !== "Delivered").length}</strong><em className="up">GPS</em></div><p>{t.acrossVehicles}</p></article>
          <article className="stat-card"><div className="stat-head"><span>{t.onTimeRate}</span><Icon>◷</Icon></div><div><strong>{onTimeRate == null ? "—" : `${onTimeRate}%`}</strong><em className="neutral">{completedWithPlan.length ? `${completedWithPlan.length} ${liveKpiCopy.completed}` : liveKpiCopy.noHistory}</em></div><p>{completedWithPlan.length ? liveKpiCopy.onTimeBody : liveKpiCopy.onTimeEmpty}</p></article>
          <article className="stat-card"><div className="stat-head"><span>{t.delayed}</span><Icon>△</Icon></div><div><strong>{delayedCount}</strong>{delayedCount > 0 && <em className="warning">{t.needsAttention}</em>}</div><p>{delayedCount > 0 ? t.delayReasons : liveKpiCopy.noDelay}</p></article>
          <article className="stat-card"><div className="stat-head"><span>{t.fleetStatus}</span><Icon>▰</Icon></div><div><strong>{integration.connected ? `${integration.vehicleCount} GPS` : "—"}</strong><em className="neutral">{integration.connected ? t.sendatrack : (locale === "fr" ? "GPS indisponible" : locale === "nl" ? "GPS niet beschikbaar" : "GPS unavailable")}</em></div><p>{integration.connected ? t.positionsAutomatic : integration.configured ? t.gpsIssueBody : t.gpsPendingBody}</p></article>
        </div>

        <div className="map-panel">
          <div className="panel-header"><div><h2>{t.liveFleet}</h2><p>{integration.connected ? t.sendatrackRefreshing : t.updatesEvery30}</p></div><div className="panel-actions"><select aria-label={t.findVehicle} value={selectedId} onChange={(event) => { setSelectedId(event.target.value); setShowPopover(true); }}>{deliveries.map((delivery) => <option key={delivery.id} value={delivery.id}>{vehicleLabel(delivery)}</option>)}</select></div></div>
          <div className="map fleet-map">
            <InteractiveFleetMap deliveries={mapDeliveries} liveVehicles={integration.vehicles} selectedId={selectedId} label={t.liveFleet} onSelect={(deliveryId) => { setSelectedId(deliveryId); setShowPopover(true); }} />
            <div className="map-status"><i className={integration.connected ? "" : "fallback"} /> {integration.connected ? t.sendatrackLive(integration.vehicleCount) : t.vehiclesReporting}</div>
            {showPopover && deliveries.length > 0 && <div className="truck-popover">
              <div><span className="truck-badge">▰</span><p><strong>{vehicleLabel(selected)}</strong><small>{isUnassignedVehicle(selected) ? (locale === "fr" ? "Aucun camion confirmé" : locale === "nl" ? "Nog geen voertuig bevestigd" : "No truck confirmed yet") : selected.driver}</small></p><button aria-label={t.closeDetails} onClick={() => setShowPopover(false)}>×</button></div>
              <dl><div><dt>{t.status}</dt><dd><i />{t.statuses[selected.status]}</dd></div><div><dt>{t.delivery}</dt><dd>{selected.id}</dd></div><div><dt>{t.eta}</dt><dd>{selected.estimatedArrivalAt ? new Date(selected.estimatedArrivalAt).toLocaleString(locale === "fr" ? "fr-BE" : locale === "nl" ? "nl-BE" : "en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : selected.eta}</dd></div></dl>{selected.estimatedArrivalAt && <div className="eta-explanation"><strong>{selectedEtaExplanation.sourceLabel}</strong><span>{selectedEtaExplanation.confidenceLabel}{selected.etaSource === "route-history" && selected.etaHistoricalSpeedKmh ? ` · ${selected.etaHistoricalSpeedKmh} km/h` : ""}</span></div>}
              {selected.gpsSource !== "sendatrack" && <div style={{ marginTop: 10 }}>
                {isUnassignedVehicle(selected) ? <small>{locale === "fr" ? "Affectez d’abord ce colis à un voyage planifié ci-dessous." : locale === "nl" ? "Wijs deze zending eerst toe aan een geplande rit hieronder." : "Assign this parcel to a planned trip below first."}</small> : integration.connected && integration.vehicles.length ? <>
                  {!vehicleLinkOpen ? <button className="copy-link" onClick={() => { setVehicleLinkOpen(true); setVehicleLinkSearch(selected.truck); setVehicleLinkChoice(""); }}>
                    {locale === "fr" ? "Associer le GPS du véhicule" : locale === "nl" ? "GPS van voertuig koppelen" : "Link vehicle GPS"}
                  </button> : <div style={{ display: "grid", gap: 8 }}>
                    <input value={vehicleLinkSearch} onChange={(event) => { setVehicleLinkSearch(event.target.value); setVehicleLinkChoice(""); }} placeholder={locale === "fr" ? "Rechercher nom / plaque" : locale === "nl" ? "Zoek naam / nummerplaat" : "Search name / plate"} />
                    <select value={vehicleLinkChoice} onChange={(event) => setVehicleLinkChoice(event.target.value)}>
                      <option value="">{locale === "fr" ? "Choisir le véhicule SENDATRACK" : locale === "nl" ? "Kies SENDATRACK-voertuig" : "Choose SENDATRACK vehicle"}</option>
                      {vehicleLinkSuggestions.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.name}</option>)}
                    </select>
                    <div className="popover-actions"><button disabled={!vehicleLinkChoice || vehicleLinkBusy} onClick={() => void linkSelectedVehicle()}>{vehicleLinkBusy ? (locale === "fr" ? "Association…" : "Linking…") : (locale === "fr" ? "Confirmer" : locale === "nl" ? "Bevestigen" : "Confirm")}</button><button className="copy-link" onClick={() => setVehicleLinkOpen(false)}>{t.cancel}</button></div>
                  </div>}
                </> : <small>{locale === "fr" ? "GPS en attente · SENDATRACK indisponible" : locale === "nl" ? "GPS in afwachting · SENDATRACK niet beschikbaar" : "Waiting for GPS · SENDATRACK unavailable"}</small>}
              </div>}
              <div className="popover-actions"><button onClick={openCustomerView}>{t.openTracking} <span>↗</span></button><button className="copy-link" onClick={copyTrackingLink}>{t.copyLink}</button></div>
            </div>}
          </div>
          {features.whatsappDemoEnabled && deliveries.length > 0 && <section className="whatsapp-demo" aria-labelledby="whatsapp-demo-title">
            <div className="whatsapp-demo-intro">
              <div className="whatsapp-mark" aria-hidden="true">◔</div>
              <div><div className="demo-title-line"><h3 id="whatsapp-demo-title">{t.whatsAppDemoTitle}</h3><span>{t.demoMode}</span></div><p>{t.whatsAppDemoBody}</p></div>
            </div>
            <div className="message-timeline" aria-label={t.notificationTimeline}>
              {messageEvents.filter((event) => event.deliveryId === selected.id).length ? messageEvents.filter((event) => event.deliveryId === selected.id).slice(0, 2).map((event) => (
                <div className="message-event" key={event.id}><i className={event.kind} aria-hidden="true">✓</i><div><strong>{event.kind === "tracking" ? t.trackingMessagePrepared : t.arrivalMessageTriggered}</strong><span>{selected.id} · {event.time}</span></div></div>
              )) : <div className="message-empty"><i>1</i><span>{t.noMessagesYet}</span></div>}
            </div>
            <div className="whatsapp-actions">
              <button className="whatsapp-button" onClick={() => void sendWhatsAppMessage("tracking")} disabled={whatsAppBusy !== null}><span aria-hidden="true">◔</span>{whatsAppBusy === "tracking" ? t.whatsAppSending : t.sendWithWhatsApp}</button>
              <button className="arrival-button" onClick={() => void simulateArrival()} disabled={selected.status === "Delivered" || whatsAppBusy !== null}><span aria-hidden="true">⌖</span>{whatsAppBusy === "arrival" ? t.whatsAppSending : selected.status === "Delivered" ? t.arrivalAlreadySent : t.simulateArrival}</button>
            </div>
          </section>}
        </div>

        {unassignedDeliveries.length > 0 && <section className="tours-panel" aria-label={locale === "fr" ? "Colis à affecter" : locale === "nl" ? "Toe te wijzen zendingen" : "Parcels to assign"}>
          <div className="panel-header"><div><h2>{locale === "fr" ? "Colis à affecter" : locale === "nl" ? "Toe te wijzen zendingen" : "Parcels to assign"}</h2><p>{locale === "fr" ? "Le camion n’est pas figé à l’entrée du colis. Une suggestion apparaît seulement si un voyage planifié compatible existe." : locale === "nl" ? "Het voertuig wordt niet vastgezet bij registratie. Een suggestie verschijnt alleen voor een compatibele geplande rit." : "The truck is not locked when the parcel is registered. A suggestion appears only when a compatible planned trip exists."}</p></div><span className="tour-count">{unassignedDeliveries.length}</span></div>
          <div className="tour-list">
            {unassignedDeliveries.map((delivery) => {
              const suggestion = tripSuggestions.get(delivery.id) ?? null;
              return <article className="tour-card" key={`assign-${delivery.id}`}>
                <div className="tour-card-head"><div><strong>{delivery.customer}</strong><span>{delivery.id} · {delivery.destination}</span></div><small>{locale === "fr" ? "À affecter" : locale === "nl" ? "Toe te wijzen" : "To assign"}</small></div>
                {suggestion ? <div className="eta-explanation"><strong>{locale === "fr" ? "Voyage compatible proposé" : locale === "nl" ? "Voorgestelde compatibele rit" : "Suggested compatible trip"}</strong><span>{suggestion.truck} · {suggestion.tripId} · {locale === "fr" ? `arrêt ${suggestion.stopSequence}` : locale === "nl" ? `stop ${suggestion.stopSequence}` : `stop ${suggestion.stopSequence}`}</span>{suggestion.plannedArrivalAt && <span>{new Date(suggestion.plannedArrivalAt).toLocaleString(locale === "fr" ? "fr-BE" : locale === "nl" ? "nl-BE" : "en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>}</div> : <div className="eta-explanation"><strong>{locale === "fr" ? "Aucune suggestion sûre" : locale === "nl" ? "Geen veilige suggestie" : "No safe suggestion"}</strong><span>{locale === "fr" ? "Le colis reste simplement en attente d’affectation." : locale === "nl" ? "De zending blijft gewoon wachten op toewijzing." : "The parcel simply remains waiting for assignment."}</span></div>}
                {tripCreateDeliveryId === delivery.id ? <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                  {integration.connected && integration.vehicles.length > 0 && <select value={tripCreateVehicleId} onChange={(event) => { setTripCreateVehicleId(event.target.value); if (event.target.value) setTripCreateManualTruck(""); }}>
                    <option value="">{locale === "fr" ? "Choisir un camion SENDATRACK" : locale === "nl" ? "Kies SENDATRACK-voertuig" : "Choose SENDATRACK vehicle"}</option>
                    {integration.vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.name}</option>)}
                  </select>}
                  <input value={tripCreateManualTruck} disabled={Boolean(tripCreateVehicleId)} onChange={(event) => setTripCreateManualTruck(event.target.value)} placeholder={locale === "fr" ? "Ou nom / plaque du camion" : locale === "nl" ? "Of naam / nummerplaat" : "Or truck name / plate"} />
                  <small>{locale === "fr" ? "Ce colis devient le premier arrêt explicite du nouveau voyage." : locale === "nl" ? "Deze zending wordt de eerste expliciete stop van de nieuwe rit." : "This parcel becomes the first explicit stop of the new trip."}</small>
                  <div className="popover-actions"><button type="button" disabled={tripCreateBusy} onClick={() => void createPlannedTrip(delivery.id)}>{tripCreateBusy ? (locale === "fr" ? "Création…" : locale === "nl" ? "Aanmaken…" : "Creating…") : (locale === "fr" ? "Créer et affecter" : locale === "nl" ? "Aanmaken en toewijzen" : "Create and assign")}</button><button type="button" className="copy-link" onClick={() => { setTripCreateDeliveryId(null); setTripCreateVehicleId(""); setTripCreateManualTruck(""); }}>{t.cancel}</button></div>
                </div> : <div className="popover-actions">{suggestion ? <button type="button" disabled={tripAssignBusy === delivery.id} onClick={() => void assignSuggestedTrip(delivery.id, suggestion.tripId)}>{tripAssignBusy === delivery.id ? (locale === "fr" ? "Affectation…" : locale === "nl" ? "Toewijzen…" : "Assigning…") : (locale === "fr" ? "Confirmer ce voyage" : locale === "nl" ? "Deze rit bevestigen" : "Confirm this trip")}</button> : <button type="button" onClick={() => { setTripCreateDeliveryId(delivery.id); setTripCreateVehicleId(""); setTripCreateManualTruck(""); }}>{locale === "fr" ? "Créer un voyage planifié" : locale === "nl" ? "Geplande rit maken" : "Create planned trip"}</button>}<button type="button" className="copy-link" onClick={() => { setSelectedId(delivery.id); setShowPopover(true); }}>{locale === "fr" ? "Voir le colis" : locale === "nl" ? "Zending bekijken" : "View parcel"}</button></div>}
              </article>;
            })}
          </div>
        </section>}

        {stopPlans.length > 0 && <section className="tours-panel" aria-label={locale === "fr" ? "Tournées actives" : locale === "nl" ? "Actieve ritten" : "Active tours"}>
          <div className="panel-header"><div><h2>{locale === "fr" ? "Tournées actives" : locale === "nl" ? "Actieve ritten" : "Active tours"}</h2><p>{locale === "fr" ? "La même séquence d’agences réutilise automatiquement la même route" : locale === "nl" ? "Dezelfde volgorde van locaties hergebruikt automatisch dezelfde route" : "The same stop sequence automatically reuses the same route"}</p></div><span className="tour-count">{stopPlans.length}</span></div>
          <div className="tour-list">
            {stopPlans.map((plan) => <article className="tour-card" key={activeTourKey(plan)}>
              <div className="tour-card-head"><div><strong>{plan.truck}</strong><span>{activeTourDisplayId(plan)} · {plan.routeTemplateId}</span></div><small>{tourDeliveryCount(plan)} {locale === "fr" ? "livraison(s)" : locale === "nl" ? "levering(en)" : "delivery(ies)"} · {tourCustomerCount(plan)} {locale === "fr" ? "client(s)" : locale === "nl" ? "klant(en)" : "customer(s)"}</small></div>{plan.learning && <div className="eta-explanation"><strong>{plan.learning.stage === "ready" ? (locale === "fr" ? "Route apprise" : locale === "nl" ? "Route geleerd" : "Route learned") : (locale === "fr" ? "Apprentissage de la route" : locale === "nl" ? "Route wordt geleerd" : "Learning route")}</strong><span>{plan.learning.historicalTrips}/{plan.learning.requiredTrips} {locale === "fr" ? "voyages" : locale === "nl" ? "ritten" : "trips"}{plan.learning.futureStops > 0 ? ` · ${plan.learning.learnedStops}/${plan.learning.futureStops} ${locale === "fr" ? "arrêts appris" : locale === "nl" ? "stops geleerd" : "stops learned"}` : ""}{plan.learning.unconfiguredStops > 0 ? ` · ${plan.learning.unconfiguredStops} ${locale === "fr" ? "sans coordonnées exactes" : locale === "nl" ? "zonder exacte coördinaten" : "missing exact coordinates"}` : ""}</span>{plan.learning.medianEffectiveSpeedKmh !== null && <span>{locale === "fr" ? "Vitesse médiane" : locale === "nl" ? "Mediane snelheid" : "Median speed"}: {plan.learning.medianEffectiveSpeedKmh} km/h{plan.learning.medianDelayMinutes !== null ? ` · ${locale === "fr" ? "retard médian" : locale === "nl" ? "mediane vertraging" : "median delay"}: ${plan.learning.medianDelayMinutes > 0 ? "+" : ""}${plan.learning.medianDelayMinutes} min` : ""}</span>}</div>}
              <div className="tour-stops">{stopSequence(plan).map((stop) => <button type="button" className="tour-stop" key={stop.siteId} onClick={() => { const firstDelivery = stop.deliveryIds.find((id) => deliveries.some((delivery) => delivery.id === id)); if (firstDelivery) { setSelectedId(firstDelivery); setShowPopover(true); } }}><i>{stop.sequence}</i><span><strong>{stop.destination}</strong><small>{stop.deliveryIds.length} {locale === "fr" ? "colis" : locale === "nl" ? "zending(en)" : "parcel(s)"}{stop.plannedArrivalAt ? ` · ${new Date(stop.plannedArrivalAt).toLocaleString(locale === "fr" ? "fr-BE" : locale === "nl" ? "nl-BE" : "en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}</small></span></button>)}</div>
            </article>)}
          </div>
        </section>}

        {trips.some((trip) => trip.status === "completed") && <section className="tours-panel" aria-label={locale === "fr" ? "Voyages récents" : locale === "nl" ? "Recente ritten" : "Recent trips"}>
          <div className="panel-header"><div><h2>{locale === "fr" ? "Voyages récents" : locale === "nl" ? "Recente ritten" : "Recent trips"}</h2><p>{locale === "fr" ? "Historique conservé après la fin des livraisons" : locale === "nl" ? "Geschiedenis blijft bewaard na de leveringen" : "History remains available after deliveries finish"}</p></div></div>
          <div className="tour-list">
            {trips.filter((trip) => trip.status === "completed").slice(0, 6).map((trip) => <article className="tour-card" key={trip.id}>
              <div className="tour-card-head"><div><strong>{trip.truck}</strong><span>{trip.id} · {trip.routeTemplateId}</span></div><small>{locale === "fr" ? "Terminé" : locale === "nl" ? "Voltooid" : "Completed"} · {new Date(trip.updatedAt).toLocaleString(locale === "fr" ? "fr-BE" : locale === "nl" ? "nl-BE" : "en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</small></div>
              <div className="tour-stops">{trip.stops.map((stop) => <div className="tour-stop" key={`${trip.id}-${stop.siteId}`}><i>{stop.sequence}</i><span><strong>{stop.destination}</strong><small>{stop.plannedArrivalAt ? new Date(stop.plannedArrivalAt).toLocaleString(locale === "fr" ? "fr-BE" : locale === "nl" ? "nl-BE" : "en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}</small></span></div>)}</div>
            </article>)}
          </div>
        </section>}

        <div className="deliveries-panel">
          <div className="panel-header delivery-head"><div><h2>{t.todaysDeliveries}</h2><p>{t.shownCompleted(visibleDeliveries.length, deliveries.filter((delivery) => delivery.status === "Delivered").length)}</p></div><div className="panel-actions"><select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label={t.filterDeliveries}><option value="All deliveries">{t.allDeliveries}</option><option value="In transit">{t.statuses["In transit"]}</option><option value="Delayed">{t.statuses.Delayed}</option><option value="Loading">{t.statuses.Loading}</option><option value="Delivered">{t.statuses.Delivered}</option></select></div></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>{t.tableDelivery}</th><th>{t.tableCustomer}</th><th>{t.tableVehicle}</th><th>{t.tableStatus}</th><th>{t.tableEta}</th><th>{t.tableProgress}</th><th><span className="sr-only">{t.tableActions}</span></th></tr></thead>
              <tbody>{visibleDeliveries.map((delivery) => <tr key={delivery.id} role="button" tabIndex={0} onClick={() => { setSelectedId(delivery.id); setShowPopover(true); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedId(delivery.id); setShowPopover(true); } }} className={selectedId === delivery.id ? "row-selected" : ""}><td><strong>{delivery.id}</strong><span>{delivery.destination}</span></td><td><div className="customer-cell"><i style={{ background: delivery.color }}>{delivery.customer.split(" ").map((word) => word[0]).slice(0,2).join("")}</i><span>{delivery.customer}</span></div></td><td><strong>{vehicleLabel(delivery)}</strong><span>{isUnassignedVehicle(delivery) ? (locale === "fr" ? "En attente d’affectation" : locale === "nl" ? "Wacht op toewijzing" : "Waiting for assignment") : delivery.gpsSource === "sendatrack" ? delivery.driver : (locale === "fr" ? "GPS en attente" : locale === "nl" ? "GPS in afwachting" : "Waiting for GPS")}</span></td><td><span className={statusClass[delivery.status]}><i />{t.statuses[delivery.status]}</span></td><td><strong>{delivery.estimatedArrivalAt ? new Date(delivery.estimatedArrivalAt).toLocaleString(locale === "fr" ? "fr-BE" : locale === "nl" ? "nl-BE" : "en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : delivery.eta}</strong><span>{(delivery.etaDelayMinutes ?? 0) >= 60 ? `+${Math.round((delivery.etaDelayMinutes ?? 0) / 60)}h` : delivery.status === "Delivered" ? t.arrived : t.today}</span></td><td><div className="progress"><div><i style={{ width: `${delivery.progress}%` }} /></div><span>{delivery.progress}%</span></div></td><td><button className="more-button" aria-label={t.copyTrackingFor(delivery.id)} onClick={(event) => { event.stopPropagation(); void copyDeliveryLink(delivery.id); }}>↗</button></td></tr>)}</tbody>
            </table>
          </div>
        </div>
      </section>

      {modalOpen && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="new-delivery-title"><div className="modal-header"><div><p className="eyebrow">{t.createEyebrow}</p><h2 id="new-delivery-title">{t.createTitle}</h2><span>{integration.connected ? t.createHelpAutomatic : t.createHelp}</span></div><button onClick={() => setModalOpen(false)} aria-label={t.close}>×</button></div><form onSubmit={createDelivery}><label>{t.customerCompany}<input name="customer" required placeholder={t.customerPlaceholder} /></label><div className="form-row"><label>{locale === "fr" ? "Site de départ" : locale === "nl" ? "Vertreklocatie" : "Origin site"}<select name="originSiteId" required value={defaultOriginSiteId} onChange={(event) => { const siteId = event.target.value; setDefaultOriginSiteId(siteId); if (company) window.localStorage.setItem(originPreferenceKey(company), siteId); }}><option value="" disabled>{locale === "fr" ? "Choisir le site" : locale === "nl" ? "Kies locatie" : "Choose site"}</option>{knownSites.filter((site) => site.roles.includes("origin")).map((site) => <option key={site.id} value={site.id}>{site.label}</option>)}</select><small>{locale === "fr" ? "Ce choix sera mémorisé pour cet utilisateur sur ce navigateur." : locale === "nl" ? "Deze keuze wordt voor deze gebruiker in deze browser onthouden." : "This choice will be remembered for this user on this browser."}</small></label><label>{t.destination}<select name="destinationSiteId" required defaultValue=""><option value="" disabled>{locale === "fr" ? "Choisir l'agence" : locale === "nl" ? "Kies agentschap" : "Choose agency"}</option>{knownSites.filter((site) => site.roles.includes("destination")).map((site) => <option key={site.id} value={site.id}>{site.label}</option>)}</select></label></div><div className="form-row">{integration.connected && integration.vehicles.length ? <label>{t.assignTruck}<select name="sendatrackVehicleId" defaultValue={UNASSIGNED_VEHICLE_ID}><option value={UNASSIGNED_VEHICLE_ID}>{locale === "fr" ? "À affecter plus tard (recommandé)" : locale === "nl" ? "Later toewijzen (aanbevolen)" : "Assign later (recommended)"}</option>{integration.vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.name}</option>)}</select><input name="manualTruck" placeholder={locale === "fr" ? "Camion absent ? Nom / plaque (optionnel)" : locale === "nl" ? "Voertuig ontbreekt? Naam / nummerplaat (optioneel)" : "Truck missing? Name / plate (optional)"} /><small>{locale === "fr" ? "Si vous saisissez un camion ici, il sera créé en attente GPS puis associé quand il apparaîtra dans SENDATRACK." : locale === "nl" ? "Als u hier een voertuig invoert, wordt het in afwachting van GPS aangemaakt en gekoppeld zodra het in SENDATRACK verschijnt." : "If you enter a truck here, it will be created waiting for GPS and linked when it appears in SENDATRACK."}</small></label> : <label>{t.assignTruck}<input name="manualTruck" placeholder={locale === "fr" ? "Optionnel · Ex. TRK-005 / plaque" : locale === "nl" ? "Optioneel · Bijv. TRK-005 / nummerplaat" : "Optional · E.g. TRK-005 / plate"} /><small>{locale === "fr" ? "Laissez vide si le camion n’est pas encore connu. Vous pourrez l’affecter plus tard." : locale === "nl" ? "Laat leeg als het voertuig nog niet bekend is. U kunt het later toewijzen." : "Leave blank if the truck is not known yet. You can assign it later."}</small></label>}<label>{t.expectedArrival}<input name="plannedArrivalAt" required type="datetime-local" /></label></div><label>{t.customerContact} <span>({t.optional})</span><input name="contact" placeholder={t.contactPlaceholder} /></label><div className="modal-footer"><button type="button" onClick={() => setModalOpen(false)}>{t.cancel}</button><button className="primary-button" type="submit" disabled={creating}>{creating ? t.creating : t.createDelivery}<span>→</span></button></div></form></section></div>}
      {toast && <div className="toast" role="status" aria-live="polite"><span>✓</span>{toast}</div>}
    </main>
  );
}
