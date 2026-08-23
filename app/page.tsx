"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { localeOptions, translations, type Locale } from "./i18n";
import InteractiveFleetMap from "./InteractiveFleetMap";
import AgencyLocationSetup from "./AgencyLocationSetup";
import SiteManager from "./SiteManager";
import { classifyLoginError, type LoginErrorKind } from "./lib/login-error";
import { originPreferenceKey, resolvePreferredOriginSite } from "./lib/origin-preference";
import { truckDeparturePreferenceKey } from "./lib/truck-departure-preference";
import { rankVehicleSuggestions } from "./lib/vehicle-linking";
import { customerEtaNote, etaExplanation } from "./lib/eta-display";
import { computeDeliveryPrice } from "./lib/delivery-pricing";
import { knownSite as staticKnownSite } from "./lib/known-sites";
import { clearRememberedLogin, readRememberedLogin, saveRememberedLogin } from "./lib/remembered-login";
import { isUnassignedVehicle, resolveCreationVehicle, UNASSIGNED_VEHICLE_ID } from "./lib/delivery-vehicle-choice";
import { suggestPlannedTrip } from "./lib/trip-suggestion";

type DeliveryStatus = "In transit" | "Delayed" | "Loading" | "Delivered";
type DeliveryEventType = "REGISTERED" | "DEPARTED" | "PROGRESS_25" | "PROGRESS_50" | "PROGRESS_75" | "NEAR_DESTINATION" | "ARRIVED_AT_SITE" | "DELAY_DETECTED" | "ARRIVED" | "GPS_STALE";

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
  recipientName?: string;
  recipientContact?: string;
  weightKg?: number | null;
  priceAmount?: number | null;
  priceCurrency?: "EUR" | "MAD" | null;
  whatsappOptIn?: boolean;
  whatsappOptInAt?: string | null;
  recipientWhatsappOptIn?: boolean;
  recipientWhatsappOptInAt?: string | null;
  sendatrackVehicleId?: string;
  latitude?: number | null;
  longitude?: number | null;
  speed?: number | null;
  lastPositionAt?: string | null;
  gpsSource?: "sendatrack" | "simulation";
  trackingToken?: string | null;
  tripId?: string | null;
  shipmentId?: string | null;
  routeDistanceKm?: number | null;
  remainingDistanceKm?: number | null;
  distanceToDestinationKm?: number | null;
  positionAgeMinutes?: number | null;
  gpsFresh?: boolean;
  plannedArrivalAt?: string | null;
  nextTruckDepartureAt?: string | null;
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
  manualArrivalEstimateHours?: number | null;
  manualArrivalEstimateSampleCount?: number;
  createdAt?: string;
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
type TripHistoryItem = { id: string; routeTemplateId: string; vehicleKey: string; truck: string; sendatrackVehicleId: string; originSiteId: string | null; stops: Array<{ siteId: string; destination: string; sequence: number; plannedArrivalAt: string | null }>; status: "planned" | "active" | "completed"; createdAt: string; updatedAt: string };

type MessageEvent = {
  id: string;
  deliveryId: string;
  kind: "tracking" | "arrival";
  time: string;
};

type CompanyIdentity = { account: string; user: string; role: "dispatcher" | "agency"; siteId: string | null };
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

const truckBadgeColors = ["#916ed7", "#16a272", "#4776e6", "#f1a43c", "#e0575b", "#0891b2", "#c2410c", "#65a30d", "#be185d", "#4f46e5"];
function truckBadgeColor(number: number | null) {
  return truckBadgeColors[((number ?? 1) - 1) % truckBadgeColors.length];
}

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
    fr: { eyebrow: "ESPACE ENTREPRISE", title: "Connectez votre flotte SENDATRACK", body: "Utilisez les mêmes identifiants que dans l’application SENDATRACK. Votre espace TrackFleet sera reconnu automatiquement.", account: "Compte", accountPlaceholder: "Compte SENDATRACK", user: "Utilisateur", userPlaceholder: "Utilisateur", password: "Mot de passe", remember: "Se souvenir de mon compte et utilisateur sur cet appareil", submit: "Accéder à TrackFleet", loading: "Connexion…", invalidCredentials: "Identifiants SENDATRACK incorrects.", serviceUnavailable: "SENDATRACK est temporairement indisponible. Réessayez dans quelques instants.", loginFailed: "Connexion impossible. Réessayez.", privacy: "Connexion chiffrée côté TrackFleet · aucune donnée visible par vos clients" },
    en: { eyebrow: "COMPANY PORTAL", title: "Connect your SENDATRACK fleet", body: "Use the same credentials as in the SENDATRACK app. Your TrackFleet workspace will be recognized automatically.", account: "Account", accountPlaceholder: "SENDATRACK account", user: "User", userPlaceholder: "User", password: "Password", remember: "Remember my account and username on this device", submit: "Open TrackFleet", loading: "Connecting…", invalidCredentials: "Incorrect SENDATRACK credentials.", serviceUnavailable: "SENDATRACK is temporarily unavailable. Please try again shortly.", loginFailed: "Unable to sign in. Please try again.", privacy: "Encrypted by TrackFleet · credentials are never visible to customers" },
    nl: { eyebrow: "BEDRIJFSPORTAAL", title: "Koppel uw SENDATRACK-wagenpark", body: "Gebruik dezelfde gegevens als in de SENDATRACK-app. Uw TrackFleet-ruimte wordt automatisch herkend.", account: "Account", accountPlaceholder: "SENDATRACK-account", user: "Gebruiker", userPlaceholder: "Gebruiker", password: "Wachtwoord", remember: "Mijn account en gebruiker op dit toestel onthouden", submit: "TrackFleet openen", loading: "Verbinden…", invalidCredentials: "Onjuiste SENDATRACK-gegevens.", serviceUnavailable: "SENDATRACK is tijdelijk niet beschikbaar. Probeer het zo opnieuw.", loginFailed: "Aanmelden mislukt. Probeer opnieuw.", privacy: "Versleuteld door TrackFleet · nooit zichtbaar voor klanten" },
  }[locale];
  // LoginScreen only ever renders once the client-side session check has
  // resolved to "anonymous" (see authState), so it's never part of the
  // server-rendered HTML -- safe to read localStorage directly here.
  const remembered = readRememberedLogin();
  return <main className="login-page">
    <header className="login-header"><span className="brand brand-dark"><span className="brand-mark"><span>↗</span></span><span>TrackFleet</span></span><LanguageSwitcher locale={locale} label="Language" onChange={onLocale} /></header>
    <section className="login-layout">
      <div className="login-story"><p className="eyebrow">{copy.eyebrow}</p><h1>{copy.title}</h1><p>{copy.body}</p><div className="login-route"><span>BE</span><i /><b>↗</b><i /><span>MA</span></div><small>Belgique · France · Espagne · Maroc</small></div>
      <form className="login-card" onSubmit={onSubmit}>
        <div className="login-provider"><span>⌖</span><div><strong>SENDATRACK</strong><small>GPS fleet connection</small></div></div>
        <label>{copy.account}<input name="accountID" autoComplete="organization" required placeholder={copy.accountPlaceholder} defaultValue={remembered?.accountID ?? ""} /></label>
        <label>{copy.user}<input name="user" autoComplete="username" required placeholder={copy.userPlaceholder} defaultValue={remembered?.user ?? ""} /></label>
        <label>{copy.password}<input name="password" type="password" autoComplete="current-password" required placeholder="••••••••" /></label>
        <label className="consent-choice"><input type="checkbox" name="rememberLogin" defaultChecked /><span>{copy.remember}</span></label>
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
  const [searchQuery, setSearchQuery] = useState("");
  const [openContactPopover, setOpenContactPopover] = useState<string | null>(null);
  const [showPopover, setShowPopover] = useState(true);
  const [creating, setCreating] = useState(false);
  const [whatsAppBusy, setWhatsAppBusy] = useState<"tracking" | "arrival" | null>(null);
  const [locale, setLocale] = useState<Locale>("fr");
  const [authState, setAuthState] = useState<"loading" | "anonymous" | "authenticated">("loading");
  const [dispatchDataState, setDispatchDataState] = useState<"loading" | "ready" | "error">("loading");
  const [company, setCompany] = useState<CompanyIdentity | null>(null);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState<LoginErrorKind | "">("");
  const [publicTrackingState, setPublicTrackingState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [integration, setIntegration] = useState<IntegrationState>({ configured: false, connected: false, vehicleCount: 0, error: null, vehicles: [] });
  const [features, setFeatures] = useState<FeatureState>({ whatsappDemoEnabled: false });
  const [trips, setTrips] = useState<TripHistoryItem[]>([]);
  const [deliveryEvents, setDeliveryEvents] = useState<DeliveryEventRow[]>([]);
  const [knownSites, setKnownSites] = useState<KnownSite[]>([]);
  const [defaultOriginSiteId, setDefaultOriginSiteId] = useState("");
  const [defaultTruckDepartureAt, setDefaultTruckDepartureAt] = useState("");
  const [truckDepartureIsStale, setTruckDepartureIsStale] = useState(false);
  // A client can hand over several parcels at once -- each row becomes its
  // own delivery (own TF-id, own tracking, own weight/price) so per-parcel
  // tracking/pricing/WhatsApp notifications keep working exactly as before;
  // the rows are just submitted together and linked by one shipmentId.
  const [parcelDrafts, setParcelDrafts] = useState<Array<{ key: string; weightKg: string; manualPriceAmount: string }>>([{ key: "0", weightKg: "", manualPriceAmount: "" }]);
  const [renamingVehicleId, setRenamingVehicleId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
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
  const [agencyLocationOpen, setAgencyLocationOpen] = useState(false);
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
    // A continuously open tab never re-hits /api/auth/session after the
    // initial load otherwise, so it would never benefit from sliding session
    // renewal (company-auth.ts) and could still log out mid-use after 7
    // days. Renewal itself only writes once the session is getting close to
    // expiry, so polling this hourly is cheap in the common case.
    if (authState !== "authenticated") return;
    const timer = window.setInterval(() => {
      void fetch("/api/auth/session", { cache: "no-store" }).catch(() => undefined);
    }, 60 * 60_000);
    return () => window.clearInterval(timer);
  }, [authState]);

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
    if (!openContactPopover) return;
    const close = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".contact-popover, .contact-trigger")) return;
      setOpenContactPopover(null);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [openContactPopover]);

  useEffect(() => {
    if (!company || !knownSites.length) {
      setDefaultOriginSiteId("");
      return;
    }
    if (company.role === "agency") {
      setDefaultOriginSiteId(company.siteId ?? "");
      return;
    }
    const originIds = knownSites.filter((site) => site.roles.includes("origin")).map((site) => site.id);
    const saved = window.localStorage.getItem(originPreferenceKey(company));
    setDefaultOriginSiteId((current) => resolvePreferredOriginSite(saved, originIds, current));
  }, [company, knownSites]);

  useEffect(() => {
    if (!company) {
      setDefaultTruckDepartureAt("");
      setTruckDepartureIsStale(false);
      return;
    }
    const saved = window.localStorage.getItem(truckDeparturePreferenceKey(company)) ?? "";
    setDefaultTruckDepartureAt(saved);
    // The pre-filled departure date carries over from the last parcel
    // entered, since most parcels entered close together wait on the same
    // next relay truck. Once that date has arrived (or passed), it's stale
    // by definition -- flag it so the dispatcher notices and updates it for
    // the next truck, instead of silently reusing an outdated departure on
    // new parcels.
    setTruckDepartureIsStale(Boolean(saved) && new Date(saved).getTime() <= Date.now());
  }, [company]);

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
        const data = await response.json() as { deliveries: Delivery[]; integration?: IntegrationState; features?: FeatureState; events?: DeliveryEventRow[]; trips?: TripHistoryItem[] };
        if (!active) return;
        if (tracking && data.deliveries.length) {
          setDeliveries(data.deliveries);
          setDeliveryEvents(data.events ?? []);
          setSelectedId(data.deliveries[0].id);
          setPublicTrackingState("ready");
        } else if (!tracking) {
          setDeliveries(data.deliveries);
          setDispatchDataState("ready");
          const requestedUrl = new URL(window.location.href);
          const requestedDeliveryId = requestedUrl.searchParams.get("delivery");
          if (requestedDeliveryId) {
            if (data.deliveries.some((delivery) => delivery.id === requestedDeliveryId)) {
              setSelectedId(requestedDeliveryId);
              setShowPopover(true);
            }
            // Consume the one-time deep link so later polls don't keep
            // overriding whatever delivery the dispatcher selects next.
            requestedUrl.searchParams.delete("delivery");
            window.history.replaceState({}, "", requestedUrl);
          } else {
            setSelectedId((current) => data.deliveries.length && !data.deliveries.some((delivery) => delivery.id === current) ? data.deliveries[0].id : current);
          }
        }
        if (data.integration) setIntegration(data.integration);
        if (data.features) setFeatures(data.features);
        if (!tracking) setTrips(data.trips ?? []);
      } catch {
        const tracking = new URLSearchParams(window.location.search).get("tracking");
        if (tracking) setPublicTrackingState("error");
        // A silent (background, every-30s) poll failure must never blank out
        // an already-loaded dashboard over one transient blip -- the next
        // poll retries automatically. Only the initial, non-silent load
        // (nothing displayed yet) falls back to the full error screen.
        // Reproduced live: a single missed background poll wiped the whole
        // dispatcher view to "Data temporarily unavailable" with no warning,
        // even though the backend was healthy again within seconds.
        if (active && !tracking) {
          if (!silent) {
            setDeliveries([]);
            setTrips([]);
            setDispatchDataState("error");
          } else {
            setToast(translations[locale].cloudReconnecting);
          }
        }
      }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(true), 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [authState, company?.role, locale]);

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
  // A short, stable "Truck N" tag alongside the real plate (the plate stays
  // the actual identifier everywhere -- this is purely a friendlier way to
  // refer to a vehicle out loud or at a glance). Numbered by sorting the
  // SENDATRACK vehicle ids, which are stable per physical vehicle, so the
  // same truck keeps the same number across reloads as long as the fleet's
  // vehicle set doesn't change.
  const vehicleTruckNumbers = useMemo(() => {
    const sorted = [...integration.vehicles].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
    return new Map(sorted.map((vehicle, index) => [vehicle.id, index + 1]));
  }, [integration.vehicles]);
  // Returns just the "Camion N" badge text (or null when the vehicle has no
  // stable number yet) -- callers render this in a colored truck-number-badge
  // pill next to the plate/name, instead of folding it into one plain string,
  // so every place a truck number is shown looks and behaves the same way.
  const truckNumberLabel = useCallback((vehicleId?: string | null) => {
    const number = vehicleId ? vehicleTruckNumbers.get(vehicleId) : undefined;
    if (!number) return null;
    return locale === "fr" ? `Camion ${number}` : locale === "nl" ? `Vrachtwagen ${number}` : `Truck ${number}`;
  }, [locale, vehicleTruckNumbers]);
  const driverLabel = (driver: string) => driver === "To be assigned"
    ? (locale === "fr" ? "Chauffeur à affecter" : locale === "nl" ? "Chauffeur toe te wijzen" : driver)
    : driver;
  const registeredAtLabel = (delivery: Delivery) => delivery.createdAt
    ? new Date(delivery.createdAt).toLocaleString(locale === "fr" ? "fr-BE" : locale === "nl" ? "nl-BE" : "en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
    : "—";
  const destinationSite = knownSites.find((site) => site.id === selected.destinationSiteId);
  const selectedEtaExplanation = etaExplanation({ source: selected.etaSource, confidence: selected.etaConfidence, historyTrips: selected.etaHistoryTrips, finalLegTrackingUnavailable: staticKnownSite(selected.destinationSiteId)?.finalLegTrackingUnavailable === true, manualArrivalEstimateHours: selected.manualArrivalEstimateHours, manualArrivalEstimateSampleCount: selected.manualArrivalEstimateSampleCount }, locale);
  const customerCopy = t.customerStatus[selected.status];
  const headingToMorocco = destinationSite?.country === "MA" || selected.destination.toUpperCase().includes("MAROC") || selected.destination.endsWith(", MA");
  const routeDirection = headingToMorocco ? t.belgiumToMorocco : t.moroccoToBelgium;
  const creationOriginSiteId = company?.role === "agency" ? company.siteId : defaultOriginSiteId;
  const creationOriginCountry = knownSites.find((site) => site.id === creationOriginSiteId)?.country ?? null;
  const creationPricePreviewFor = (weightDraft: string) => {
    const weightValue = Number(weightDraft);
    return computeDeliveryPrice(Number.isFinite(weightValue) && weightValue > 0 ? weightValue : null, creationOriginCountry);
  };
  // An agency at a relay-only destination (see KnownSite.finalLegTrackingUnavailable)
  // has no live truck to show -- GPS coverage doesn't reach them, so the live
  // fleet map would show nothing relevant or, worse, an unrelated truck. Show
  // their expected parcels with the duration estimate instead of pretending
  // a trackable vehicle exists for that leg.
  const agencyMapUnavailable = company?.role === "agency" && staticKnownSite(company.siteId)?.finalLegTrackingUnavailable === true;
  const agencyIncomingDeliveries = agencyMapUnavailable
    ? deliveries.filter((delivery) => delivery.destinationSiteId === company?.siteId && delivery.status !== "Delivered")
    : [];
  const visibleDeliveries = useMemo(() => {
    const statusFiltered = filter === "All deliveries" ? deliveries : deliveries.filter((delivery) => delivery.status === filter);
    // Normalize both sides (strip everything but letters/digits) so a phone
    // search matches regardless of +/space/dash formatting, and still works
    // as a plain case-insensitive substring match for names and ids.
    const query = searchQuery.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!query) return statusFiltered;
    return statusFiltered.filter((delivery) => [delivery.id, delivery.customer, delivery.recipientName, delivery.contact, delivery.recipientContact, delivery.destination]
      .some((field) => field && field.toLowerCase().replace(/[^a-z0-9]/g, "").includes(query)));
  }, [deliveries, filter, searchQuery]);
  // A delivery and its truck go together, so the table groups by truck
  // instead of repeating the vehicle on every single row. Grouped by
  // sendatrackVehicleId when the truck is a tracked SENDATRACK vehicle
  // (falls back to the manually-entered truck name otherwise), with
  // unassigned parcels collected into their own trailing group.
  const groupedDeliveries = useMemo(() => {
    const unassignedLabel = locale === "fr" ? "À affecter" : locale === "nl" ? "Toe te wijzen" : "To assign";
    const groups = new Map<string, { label: string; truckNumber: number | null; numberLabel: string | null; sortKey: number; deliveries: Delivery[] }>();
    for (const delivery of visibleDeliveries) {
      const unassigned = isUnassignedVehicle(delivery);
      const key = unassigned ? "__unassigned__" : (delivery.sendatrackVehicleId || delivery.truck);
      let group = groups.get(key);
      if (!group) {
        const truckNumber = delivery.sendatrackVehicleId ? vehicleTruckNumbers.get(delivery.sendatrackVehicleId) ?? null : null;
        group = {
          label: unassigned ? unassignedLabel : delivery.truck,
          truckNumber,
          numberLabel: truckNumberLabel(delivery.sendatrackVehicleId),
          sortKey: unassigned ? Number.MAX_SAFE_INTEGER : (truckNumber ?? Number.MAX_SAFE_INTEGER - 1),
          deliveries: [],
        };
        groups.set(key, group);
      }
      group.deliveries.push(delivery);
    }
    return Array.from(groups.values())
      .map((group) => {
        // Destination/ETA/progress are derived from the same truck GPS
        // position + destination, so when a group has more than one parcel
        // and they all share one destination, those values are identical
        // too -- repeating them on every row was the same redundancy the
        // departure-date label had. Hoisted into the group header instead,
        // using any one delivery as the representative (they're all equal
        // by definition here). A lone parcel has nothing to deduplicate, so
        // it stays on its own row instead of gaining a header for no
        // reason. A truck relaying parcels to several different
        // destinations keeps this per row, same as before -- that's a real
        // difference between rows, not duplication.
        const firstDestination = group.deliveries[0]?.destination || null;
        const uniformDestination = group.deliveries.length > 1 && firstDestination && group.deliveries.every((delivery) => delivery.destination === firstDestination)
          ? group.deliveries[0]
          : null;
        return { ...group, uniformDestination };
      })
      .sort((a, b) => a.sortKey - b.sortKey || a.label.localeCompare(b.label));
  }, [visibleDeliveries, locale, vehicleTruckNumbers, truckNumberLabel]);
  // A shipment's parcels can end up split across different trucks (each is
  // independently trackable/assignable), so this doesn't nest inside the
  // truck grouping above -- it's a lightweight "N linked parcels" hint on
  // each row instead, computed once per render from what's on screen.
  const shipmentSizes = useMemo(() => {
    const sizes = new Map<string, number>();
    for (const delivery of visibleDeliveries) {
      if (!delivery.shipmentId) continue;
      sizes.set(delivery.shipmentId, (sizes.get(delivery.shipmentId) ?? 0) + 1);
    }
    return sizes;
  }, [visibleDeliveries]);
  const mapDeliveries = integration.connected
    ? deliveries.filter((delivery) => delivery.gpsSource === "sendatrack")
    : deliveries;
  // Dispatcher-only: which country the cargo is coming from, shown as a
  // flag badge on the truck marker. Not part of the customer-facing map --
  // originSiteId isn't in the public tracking allowlist (see
  // public-delivery-view.ts), so this can't and shouldn't reach that view.
  const mapDeliveriesWithOrigin = mapDeliveries.map((delivery) => ({
    ...delivery,
    originCountry: knownSites.find((site) => site.id === delivery.originSiteId)?.country ?? null,
    truckNumber: delivery.sendatrackVehicleId ? vehicleTruckNumbers.get(delivery.sendatrackVehicleId) ?? null : null,
  }));
  const liveVehiclesWithNumbers = integration.vehicles.map((vehicle) => ({ ...vehicle, truckNumber: vehicleTruckNumbers.get(vehicle.id) ?? null }));
  const unassignedDeliveries = deliveries.filter((delivery) => delivery.status !== "Delivered" && isUnassignedVehicle(delivery));
  const tripSuggestions = new Map(unassignedDeliveries.map((delivery) => [delivery.id, suggestPlannedTrip(delivery, trips)]));
  // Parcels sitting at the origin site accumulate under "Loading" until the
  // truck they're relayed on actually departs -- this is the count/weight a
  // dispatcher watches to decide when a truck is full enough to send out.
  const loadingDeliveries = deliveries.filter((delivery) => delivery.status === "Loading");
  const loadingWeightKg = loadingDeliveries.reduce((total, delivery) => total + (delivery.weightKg ?? 0), 0);
  const storedTodayCount = deliveries.filter((delivery) => delivery.createdAt && new Date(delivery.createdAt).toDateString() === new Date().toDateString()).length;
  const vehicleLinkSuggestions = rankVehicleSuggestions(vehicleLinkSearch || selected?.truck || "", integration.vehicles);
  const dashboardEmptyCopy = {
    fr: { firstTitle: "Aucune livraison enregistrée", firstBody: "Créez la première livraison pour générer son suivi privé et commencer l’historique opérationnel.", firstAction: "Créer la première livraison", filteredTitle: "Aucune livraison dans ce filtre", filteredBody: "Les livraisons existent, mais aucune ne correspond au statut sélectionné.", reset: "Afficher toutes les livraisons", trackingUnavailable: "Lien de suivi indisponible pour cet ancien enregistrement." },
    en: { firstTitle: "No deliveries yet", firstBody: "Create the first delivery to generate its private tracking link and start operational history.", firstAction: "Create first delivery", filteredTitle: "No deliveries in this filter", filteredBody: "Deliveries exist, but none match the selected status.", reset: "Show all deliveries", trackingUnavailable: "Tracking link unavailable for this legacy record." },
    nl: { firstTitle: "Nog geen leveringen", firstBody: "Maak de eerste levering om de privé-trackinglink te genereren en de operationele historiek te starten.", firstAction: "Eerste levering maken", filteredTitle: "Geen leveringen in deze filter", filteredBody: "Er zijn leveringen, maar geen enkele komt overeen met de gekozen status.", reset: "Alle leveringen tonen", trackingUnavailable: "Trackinglink niet beschikbaar voor dit oudere record." },
  }[locale];

  async function copyDeliveryLink(deliveryId: string) {
    const delivery = deliveries.find((item) => item.id === deliveryId);
    if (!delivery?.trackingToken) {
      setToast(dashboardEmptyCopy.trackingUnavailable);
      return;
    }
    const link = new URL(window.location.origin);
    link.searchParams.set("tracking", delivery.trackingToken);
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
    if (!delivery?.trackingToken) return "";
    const link = new URL(window.location.origin);
    link.searchParams.set("tracking", delivery.trackingToken);
    link.searchParams.set("lang", locale);
    return link.toString();
  }

  async function sendWhatsAppMessage(kind: "tracking" | "arrival") {
    const customerTrackingUrl = trackingUrl(selected.id);
    if (kind === "tracking" && !customerTrackingUrl) {
      setToast(dashboardEmptyCopy.trackingUnavailable);
      return false;
    }
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
          trackingUrl: customerTrackingUrl,
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
    if (!selected.trackingToken) {
      setToast(dashboardEmptyCopy.trackingUnavailable);
      return;
    }
    const link = new URL(window.location.origin);
    link.searchParams.set("tracking", selected.trackingToken);
    link.searchParams.set("lang", locale);
    window.open(link, "_blank", "noopener,noreferrer");
  }

  function openDispatchView() {
    const dashboardUrl = new URL(window.location.origin);
    dashboardUrl.searchParams.set("lang", locale);
    window.history.pushState({}, "", dashboardUrl);
    setView("dispatch");
    window.dispatchEvent(new PopStateEvent("popstate"));
  }

  function changeLocale(nextLocale: Locale) {
    setLocale(nextLocale);
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("lang", nextLocale);
    window.history.replaceState({}, "", nextUrl);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }

  async function login(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginBusy(true);
    setLoginError("");
    const form = new FormData(event.currentTarget);
    const accountID = String(form.get("accountID") ?? "");
    const user = String(form.get("user") ?? "");
    const rememberLogin = form.get("rememberLogin") === "on";
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accountID, user, password: form.get("password") }) });
      const data = await response.json() as { company?: CompanyIdentity; error?: string };
      if (!response.ok) {
        setLoginError(classifyLoginError(response.status, data.error));
        return;
      }
      if (!data.company) {
        setLoginError("login_failed");
        return;
      }
      if (rememberLogin) saveRememberedLogin({ accountID, user });
      else clearRememberedLogin();
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
    setTrips([]);
    setDeliveryEvents([]);
    setKnownSites([]);
    setIntegration({ configured: false, connected: false, vehicleCount: 0, error: null, vehicles: [] });
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

  async function renameVehicle(sendatrackVehicleId: string) {
    const alias = renameDraft.trim();
    if (!alias) { setRenamingVehicleId(null); return; }
    setRenameBusy(true);
    try {
      const response = await fetch("/api/vehicles/alias", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sendatrackVehicleId, alias }),
      });
      if (!response.ok) throw new Error("rename_failed");
      setIntegration((current) => ({
        ...current,
        vehicles: current.vehicles.map((vehicle) => vehicle.id === sendatrackVehicleId ? { ...vehicle, name: alias } : vehicle),
      }));
      setRenamingVehicleId(null);
    } catch {
      setToast(locale === "fr" ? "Impossible de renommer ce véhicule. Réessayez." : locale === "nl" ? "Kan dit voertuig niet hernoemen. Probeer opnieuw." : "Couldn’t rename this vehicle. Please try again.");
    } finally {
      setRenameBusy(false);
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
    const originSiteId = company?.role === "agency" ? company.siteId ?? "" : String(form.get("originSiteId") ?? "").trim();
    if (company && originSiteId) {
      window.localStorage.setItem(originPreferenceKey(company), originSiteId);
      setDefaultOriginSiteId(originSiteId);
    }
    const destinationSiteId = String(form.get("destinationSiteId") ?? "").trim();
    const selectedSite = knownSites.find((site) => site.id === destinationSiteId);
    const destination = selectedSite?.address ?? "";
    const plannedArrivalInput = String(form.get("plannedArrivalAt") ?? "").trim();
    const plannedArrivalAt = plannedArrivalInput ? new Date(plannedArrivalInput).toISOString() : "";
    const nextTruckDepartureInput = String(form.get("nextTruckDepartureAt") ?? "").trim();
    const nextTruckDepartureAt = nextTruckDepartureInput ? new Date(nextTruckDepartureInput).toISOString() : "";
    if (company && nextTruckDepartureInput) {
      window.localStorage.setItem(truckDeparturePreferenceKey(company), nextTruckDepartureInput);
      setDefaultTruckDepartureAt(nextTruckDepartureInput);
      setTruckDepartureIsStale(new Date(nextTruckDepartureInput).getTime() <= Date.now());
    }
    const whatsappOptIn = form.get("whatsappOptIn") === "on";
    const contactRaw = String(form.get("contact") ?? "").trim();
    const recipientContactRaw = String(form.get("recipientContact") ?? "").trim();
    if (!whatsappOptIn && (contactRaw || recipientContactRaw)) {
      // Easy to forget since the checkbox only appears once a number is
      // typed -- confirm instead of silently registering a parcel whose
      // brand-new number will never receive automatic WhatsApp updates.
      // Numbers that already consented before are unaffected either way
      // (TrackFleet recognizes them automatically regardless of this box).
      const confirmMessage = locale === "fr"
        ? "La case de consentement WhatsApp n'est pas cochée. Si ce numéro n'a jamais consenti auparavant, il ne recevra aucun message automatique. Continuer sans cocher ?"
        : locale === "nl"
        ? "Het WhatsApp-toestemmingsvakje is niet aangevinkt. Als dit nummer nog nooit toestemming gaf, ontvangt het geen automatische berichten. Doorgaan zonder aan te vinken?"
        : "The WhatsApp consent checkbox isn't checked. If this number has never consented before, it won't receive any automatic messages. Continue without checking it?";
      if (!window.confirm(confirmMessage)) return;
    }
    const sharedFields = {
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
      nextTruckDepartureAt,
      contact: contactRaw,
      recipientName: String(form.get("recipientName")),
      recipientContact: recipientContactRaw,
      whatsappOptIn,
    };
    // One id shared by every parcel in this submission -- costs nothing for
    // the common single-parcel case, and lets the table show "N colis"
    // together later without inferring it from timestamps/customer name.
    const shipmentId = crypto.randomUUID();
    setCreating(true);
    const created: Delivery[] = [];
    let failure: string | null = null;
    for (const parcel of parcelDrafts) {
      const weightRaw = parcel.weightKg.trim();
      const manualPriceRaw = parcel.manualPriceAmount.trim();
      const draftDelivery = {
        ...sharedFields,
        shipmentId,
        weightKg: weightRaw ? Number(weightRaw) : null,
        manualPriceAmount: !weightRaw && manualPriceRaw ? Number(manualPriceRaw) : null,
      };
      try {
        const response = await fetch("/api/deliveries", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(draftDelivery) });
        const data = (await response.json()) as { delivery?: Delivery; error?: string };
        if (!response.ok || !data.delivery) {
          failure = data.error || t.createFailed;
          break;
        }
        created.push(data.delivery);
      } catch {
        failure = t.createFailed;
        break;
      }
    }
    if (created.length) {
      const createdIds = new Set(created.map((delivery) => delivery.id));
      setDeliveries((items) => [...created, ...items.filter((item) => !createdIds.has(item.id))]);
      setSelectedId(created[0].id);
      setShowPopover(true);
    }
    if (failure) {
      setToast(created.length
        ? (locale === "fr" ? `${created.length}/${parcelDrafts.length} colis créés, échec du reste : ${failure}` : locale === "nl" ? `${created.length}/${parcelDrafts.length} pakketten aangemaakt, de rest is mislukt: ${failure}` : `${created.length}/${parcelDrafts.length} parcels created, the rest failed: ${failure}`)
        : failure);
    } else {
      setModalOpen(false);
      setParcelDrafts([{ key: "0", weightKg: "", manualPriceAmount: "" }]);
      setToast(created.length > 1
        ? (locale === "fr" ? `${created.length} colis créés` : locale === "nl" ? `${created.length} pakketten aangemaakt` : `${created.length} parcels created`)
        : t.created(created[0].id));
    }
    setCreating(false);
  }

  async function confirmArrivalForDelivery(deliveryId: string, destinationSiteId?: string | null) {
    if (company?.role !== "agency" || destinationSiteId !== company.siteId) return;
    try {
      const response = await fetch("/api/deliveries/manual-completion", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deliveryId, confirmArrival: true }),
      });
      if (!response.ok) throw new Error("arrival_confirmation_failed");
      setToast(locale === "fr" ? "Arrivée confirmée. La clôture suivra après le déchargement." : locale === "nl" ? "Aankomst bevestigd. Afsluiting volgt na het lossen." : "Arrival confirmed. Completion will follow after unloading.");
    } catch {
      setToast(locale === "fr" ? "Impossible de confirmer cette arrivée." : locale === "nl" ? "Aankomst kon niet worden bevestigd." : "Could not confirm this arrival.");
    }
  }

  if (view === "customer" && publicTrackingState === "loading") return <main className="login-page login-loading"><div className="brand brand-dark"><span className="brand-mark"><span>↗</span></span><span>TrackFleet</span></div></main>;
  if (view === "customer" && publicTrackingState === "error") return <main className="login-page login-loading"><section className="tracking-error"><div className="brand brand-dark"><span className="brand-mark"><span>↗</span></span><span>TrackFleet</span></div><h1>Lien de suivi introuvable</h1><p>Vérifiez le lien reçu ou contactez l’entreprise qui vous l’a envoyé.</p></section></main>;
  if (view !== "customer" && authState === "loading") return <main className="login-page login-loading"><div className="brand brand-dark"><span className="brand-mark"><span>↗</span></span><span>TrackFleet</span></div></main>;
  if (view !== "customer" && authState === "anonymous") return <LoginScreen locale={locale} busy={loginBusy} error={loginError} onLocale={changeLocale} onSubmit={login} />;
  if (view !== "customer" && authState === "authenticated" && company?.role === "agency" && agencyLocationOpen) return <AgencyLocationSetup locale={locale} site={knownSites.find((site) => site.id === company.siteId) ?? null} onLocale={changeLocale} onLogout={() => void logout()} onBack={() => setAgencyLocationOpen(false)} />;
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
          REGISTERED: "Colis enregistré",
          DEPARTED: "Camion parti",
          PROGRESS_25: "25% du trajet effectué",
          PROGRESS_50: "Mi-parcours atteint",
          PROGRESS_75: "75% du trajet effectué",
          NEAR_DESTINATION: "Le camion approche",
          ARRIVED_AT_SITE: "Camion arrivé à l’agence",
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
          REGISTERED: "Parcel registered",
          DEPARTED: "Truck departed",
          PROGRESS_25: "25% of the trip completed",
          PROGRESS_50: "Halfway point reached",
          PROGRESS_75: "75% of the trip completed",
          NEAR_DESTINATION: "Truck is approaching",
          ARRIVED_AT_SITE: "Truck arrived at the agency",
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
          REGISTERED: "Zending geregistreerd",
          DEPARTED: "Vrachtwagen vertrokken",
          PROGRESS_25: "25% van het traject voltooid",
          PROGRESS_50: "Halverwege bereikt",
          PROGRESS_75: "75% van het traject voltooid",
          NEAR_DESTINATION: "Vrachtwagen nadert",
          ARRIVED_AT_SITE: "Vrachtwagen aangekomen bij het agentschap",
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
      finalLegTrackingUnavailable: staticKnownSite(selected.destinationSiteId)?.finalLegTrackingUnavailable === true,
      manualArrivalEstimateHours: selected.manualArrivalEstimateHours,
      manualArrivalEstimateSampleCount: selected.manualArrivalEstimateSampleCount,
    }, locale);
    const customerVehicleLabel = isUnassignedVehicle(selected)
      ? (locale === "fr" ? "Véhicule pas encore affecté" : locale === "nl" ? "Voertuig nog niet toegewezen" : "Vehicle not assigned yet")
      : selected.truck;

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
              {(selected.weightKg != null || selected.priceAmount != null) && <div className="shipment-facts">
                {selected.weightKg != null && <span><strong>{selected.weightKg.toLocaleString(dateLocale, { maximumFractionDigits: 3 })} kg</strong><small>{locale === "fr" ? "Poids du colis" : locale === "nl" ? "Gewicht zending" : "Parcel weight"}</small></span>}
                {selected.priceAmount != null && selected.priceCurrency && <span><strong>{selected.priceAmount.toLocaleString(dateLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {selected.priceCurrency}</strong><small>{locale === "fr" ? "Prix déclaré" : locale === "nl" ? "Aangegeven prijs" : "Declared price"}</small></span>}
              </div>}
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
              <InteractiveFleetMap deliveries={deliveries} selectedId={selectedId} customerMode label={`${routeDirection} · ${customerVehicleLabel}`} />
              <div className="map-live"><i className={selected.gpsFresh ? "" : "fallback"} /> {gpsText}</div>
            </div>

            <aside className="journey-card">
              <div className="journey-title">
                <div className="mini-truck">▰</div>
                <div><strong>{customerVehicleLabel}</strong><span>{t.yourVehicle}</span></div>
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

  const deliveriesPanel = (
    <div className="deliveries-panel">
      <div className="panel-header delivery-head"><div><h2>{t.todaysDeliveries}</h2><p>{t.shownCompleted(visibleDeliveries.length, deliveries.filter((delivery) => delivery.status === "Delivered").length)}</p></div><div className="panel-actions"><input type="search" className="table-search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder={locale === "fr" ? "Client, destinataire, numéro…" : locale === "nl" ? "Klant, ontvanger, nummer…" : "Customer, recipient, number…"} aria-label={locale === "fr" ? "Rechercher une livraison" : locale === "nl" ? "Levering zoeken" : "Search deliveries"} /><select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label={t.filterDeliveries}><option value="All deliveries">{t.allDeliveries}</option><option value="In transit">{t.statuses["In transit"]}</option><option value="Delayed">{t.statuses.Delayed}</option><option value="Loading">{t.statuses.Loading}</option><option value="Delivered">{t.statuses.Delivered}</option></select></div></div>
      <div className="table-wrap">
        {visibleDeliveries.length === 0 ? <div className="deliveries-empty">
          <div className="deliveries-empty-icon" aria-hidden="true">◇</div>
          <div><strong>{deliveries.length === 0 ? dashboardEmptyCopy.firstTitle : searchQuery.trim() ? (locale === "fr" ? "Aucun résultat" : locale === "nl" ? "Geen resultaten" : "No results") : dashboardEmptyCopy.filteredTitle}</strong><p>{deliveries.length === 0 ? dashboardEmptyCopy.firstBody : searchQuery.trim() ? (locale === "fr" ? "Aucune livraison ne correspond à cette recherche." : locale === "nl" ? "Geen levering komt overeen met deze zoekopdracht." : "No delivery matches this search.") : dashboardEmptyCopy.filteredBody}</p></div>
          <button type="button" className="primary-button" onClick={() => { if (deliveries.length === 0) { setModalOpen(true); } else { setFilter("All deliveries"); setSearchQuery(""); } }}>{deliveries.length === 0 ? dashboardEmptyCopy.firstAction : dashboardEmptyCopy.reset}</button>
        </div> : <table>
          <thead><tr><th>{t.tableDelivery}</th><th>{t.tableCustomer}</th><th>{locale === "fr" ? "Destinataire" : locale === "nl" ? "Ontvanger" : "Recipient"}</th>{company?.role === "dispatcher" && <th>{locale === "fr" ? "Agence" : locale === "nl" ? "Agentschap" : "Agency"}</th>}<th>{t.tableStatus}</th><th>{t.tableEta}</th><th>{t.tableProgress}</th><th className="col-actions"><span className="sr-only">{t.tableActions}</span></th></tr></thead>
          {groupedDeliveries.map((group) => <tbody key={group.label}>
            <tr className="group-header-row"><td colSpan={100}>{group.numberLabel && <span className="truck-number-badge" style={{ background: truckBadgeColor(group.truckNumber) }}>{group.numberLabel}</span>}<strong>{group.label}</strong><span>{group.deliveries.length} {locale === "fr" ? "colis" : locale === "nl" ? "pakketten" : group.deliveries.length === 1 ? "parcel" : "parcels"}</span>{group.uniformDestination && <>
              <span className="group-header-destination">{group.uniformDestination.destination}</span>
              <span>{group.uniformDestination.estimatedArrivalAt ? new Date(group.uniformDestination.estimatedArrivalAt).toLocaleString(locale === "fr" ? "fr-BE" : locale === "nl" ? "nl-BE" : "en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : group.uniformDestination.eta}</span>
              <span className="group-header-progress"><div className="progress"><div><i style={{ width: `${group.uniformDestination.progress}%` }} /></div><span>{group.uniformDestination.progress}%</span></div></span>
            </>}</td></tr>
            {group.deliveries.map((delivery) => <tr key={delivery.id} role="button" tabIndex={0} onClick={() => { setSelectedId(delivery.id); setShowPopover(true); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedId(delivery.id); setShowPopover(true); } }} className={selectedId === delivery.id ? "row-selected" : ""}><td><strong>{registeredAtLabel(delivery)}</strong><span>{delivery.id}</span>{delivery.shipmentId && (shipmentSizes.get(delivery.shipmentId) ?? 0) > 1 && <span className="shipment-badge">{locale === "fr" ? `${shipmentSizes.get(delivery.shipmentId)} colis liés` : locale === "nl" ? `${shipmentSizes.get(delivery.shipmentId)} gekoppelde pakketten` : `${shipmentSizes.get(delivery.shipmentId)} linked parcels`}</span>}</td><td className="contact-cell-wrap"><button type="button" className="customer-cell contact-trigger" onClick={(event) => { event.stopPropagation(); setOpenContactPopover((current) => current === `${delivery.id}:customer` ? null : `${delivery.id}:customer`); }}><span>{delivery.customer}</span></button>{openContactPopover === `${delivery.id}:customer` && <div className="contact-popover"><strong>{locale === "fr" ? "Téléphone client" : locale === "nl" ? "Telefoon klant" : "Customer phone"}</strong>{delivery.contact ? <a href={`tel:${delivery.contact}`}>{delivery.contact}</a> : <span>—</span>}</div>}</td><td className="contact-cell-wrap"><button type="button" className="contact-trigger" onClick={(event) => { event.stopPropagation(); setOpenContactPopover((current) => current === `${delivery.id}:recipient` ? null : `${delivery.id}:recipient`); }}><strong>{delivery.recipientName || "—"}</strong></button>{openContactPopover === `${delivery.id}:recipient` && <div className="contact-popover"><strong>{locale === "fr" ? "Téléphone destinataire" : locale === "nl" ? "Telefoon ontvanger" : "Recipient phone"}</strong>{[delivery.contact, delivery.recipientContact].filter(Boolean).length > 0 ? [delivery.contact, delivery.recipientContact].filter(Boolean).map((number) => <a key={number} href={`tel:${number}`}>{number}</a>) : <span>—</span>}</div>}</td>{company?.role === "dispatcher" && <td>{knownSites.find((site) => site.id === delivery.originSiteId)?.label ?? "—"}</td>}<td><span className={statusClass[delivery.status]}><i />{t.statuses[delivery.status]}</span></td><td>{group.uniformDestination ? <span className="cell-hoisted">—</span> : <><strong>{delivery.estimatedArrivalAt ? new Date(delivery.estimatedArrivalAt).toLocaleString(locale === "fr" ? "fr-BE" : locale === "nl" ? "nl-BE" : "en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : delivery.eta}</strong><span>{(delivery.etaDelayMinutes ?? 0) >= 60 ? `+${Math.round((delivery.etaDelayMinutes ?? 0) / 60)}h` : delivery.status === "Delivered" ? t.arrived : t.today}</span></>}</td><td>{group.uniformDestination ? <span className="cell-hoisted">—</span> : <div className="progress"><div><i style={{ width: `${delivery.progress}%` }} /></div><span>{delivery.progress}%</span></div>}</td><td className="col-actions"><button className="more-button" aria-label={t.copyTrackingFor(delivery.id)} onClick={(event) => { event.stopPropagation(); void copyDeliveryLink(delivery.id); }}>↗</button></td></tr>)}
          </tbody>)}
        </table>}
      </div>
    </div>
  );

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
        <nav aria-label={locale === "fr" ? "Outils TrackFleet" : locale === "nl" ? "TrackFleet-tools" : "TrackFleet tools"}>
          <a className="nav-item" href={`/operations?lang=${locale}`}><Icon>△</Icon>{t.operationsTool}</a>
          <a className="nav-item" href={`/operations/history?lang=${locale}`}><Icon>≡</Icon>{t.historyTool}</a>
          <a className="nav-item" href={`/operations/revenue?lang=${locale}`}><Icon>€</Icon>{t.revenueTool}</a>
          {company?.role === "dispatcher" && <a className="nav-item" href={`/operations/storage?lang=${locale}`}><Icon>▥</Icon>{t.storageTool}</a>}
          {company?.role === "dispatcher" && <a className="nav-item" href="/api/operations/export"><Icon>⇩</Icon>{t.exportTool}</a>}
          <a className="nav-item" href={`/import?lang=${locale}`}><Icon>＋</Icon>{t.importTool}</a>
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
          <div className="top-actions"><LanguageSwitcher locale={locale} label={t.language} onChange={changeLocale} />{company?.role === "dispatcher" ? <SiteManager locale={locale} /> : <><button type="button" onClick={() => setAgencyLocationOpen(true)}>{locale === "fr" ? "Localiser l’agence" : locale === "nl" ? "Agentschap lokaliseren" : "Locate agency"}</button><button type="button" onClick={() => window.location.assign("/import")}>{locale === "fr" ? "Importer des colis" : locale === "nl" ? "Zendingen importeren" : "Import parcels"}</button></>}<button className="primary-button" onClick={() => setModalOpen(true)}><span>＋</span>{t.newDelivery}</button></div>
        </header>

        <div className="stats-grid">
          <article className="stat-card"><div className="stat-head"><span>{t.loadingParcels}</span><Icon>▤</Icon></div><div><strong>{loadingDeliveries.length}</strong></div><p>{t.loadingParcelsBody}</p></article>
          <article className="stat-card"><div className="stat-head"><span>{t.loadingWeight}</span><Icon>⚖</Icon></div><div><strong>{loadingWeightKg.toLocaleString(locale === "fr" ? "fr-BE" : locale === "nl" ? "nl-BE" : "en-GB", { maximumFractionDigits: 1 })} kg</strong></div><p>{t.loadingWeightBody}</p></article>
          <article className="stat-card"><div className="stat-head"><span>{t.storedToday}</span><Icon>▥</Icon></div><div><strong>{storedTodayCount}</strong></div><p>{t.storedTodayBody}</p></article>
          <article className="stat-card"><div className="stat-head"><span>{t.fleetStatus}</span><Icon>▰</Icon></div><div><strong>{integration.connected ? `${integration.vehicleCount} ${locale === "fr" ? "véhicules" : locale === "nl" ? "voertuigen" : "vehicles"}` : "—"}</strong><em className="neutral">{integration.connected ? t.sendatrack : (locale === "fr" ? "GPS indisponible" : locale === "nl" ? "GPS niet beschikbaar" : "GPS unavailable")}</em></div><p>{integration.connected ? t.positionsAutomatic : integration.configured ? t.gpsIssueBody : t.gpsPendingBody}</p></article>
        </div>

        {company?.role === "agency" && deliveriesPanel}

        <div className="map-panel">
          {agencyMapUnavailable ? (
            <div className="panel-header"><div><h2>{locale === "fr" ? "Colis attendus" : locale === "nl" ? "Verwachte pakketten" : "Parcels expected"}</h2><p>{locale === "fr" ? "Suivi GPS non disponible pour cette dernière étape · confirmez l’arrivée dès que le colis est sur place" : locale === "nl" ? "Geen GPS-tracking voor dit laatste traject · bevestig de aankomst zodra het pakket er is" : "No GPS tracking for this final leg · confirm arrival as soon as the parcel is physically present"}</p></div></div>
          ) : (
            <div className="panel-header"><div><h2>{t.liveFleet}</h2><p>{integration.connected ? t.sendatrackRefreshing : t.updatesEvery30}</p></div><div className="panel-actions"><select aria-label={t.findVehicle} value={selectedId} onChange={(event) => { setSelectedId(event.target.value); setShowPopover(true); }}>{deliveries.map((delivery) => <option key={delivery.id} value={delivery.id}>{vehicleLabel(delivery)}</option>)}</select></div></div>
          )}
          <div className="map fleet-map">
            {agencyMapUnavailable ? (
              agencyIncomingDeliveries.length === 0 ? (
                <p className="expected-parcels-empty">{locale === "fr" ? "Aucun colis attendu pour le moment." : locale === "nl" ? "Momenteel geen verwachte pakketten." : "No parcels expected right now."}</p>
              ) : (
                <div className="expected-parcels-list">
                  {agencyIncomingDeliveries.map((delivery) => {
                    const note = customerEtaNote({ finalLegTrackingUnavailable: true, manualArrivalEstimateHours: delivery.manualArrivalEstimateHours, manualArrivalEstimateSampleCount: delivery.manualArrivalEstimateSampleCount }, locale);
                    return (
                      <article className="expected-parcel-card" key={delivery.id}>
                        <div><strong>{delivery.customer}</strong><span>{delivery.id}</span></div>
                        <div className="expected-parcel-meta">
                          {delivery.weightKg != null && <span>{delivery.weightKg.toLocaleString(locale === "fr" ? "fr-BE" : locale === "nl" ? "nl-BE" : "en-GB", { maximumFractionDigits: 3 })} kg</span>}
                          {delivery.priceAmount != null && delivery.priceCurrency && <span>{delivery.priceAmount.toLocaleString(locale === "fr" ? "fr-BE" : locale === "nl" ? "nl-BE" : "en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {delivery.priceCurrency}</span>}
                          <span>{note}</span>
                        </div>
                        <button type="button" onClick={() => void confirmArrivalForDelivery(delivery.id, delivery.destinationSiteId)}>{locale === "fr" ? "Confirmer l’arrivée" : locale === "nl" ? "Aankomst bevestigen" : "Confirm arrival"}</button>
                      </article>
                    );
                  })}
                </div>
              )
            ) : <>
              <InteractiveFleetMap deliveries={mapDeliveriesWithOrigin} liveVehicles={liveVehiclesWithNumbers} selectedId={selectedId} label={t.liveFleet} onSelect={(deliveryId) => { setSelectedId(deliveryId); setShowPopover(true); }} onBackgroundClick={() => setShowPopover(false)} />
              <div className="map-status"><i className={integration.connected ? "" : "fallback"} /> {integration.connected ? t.sendatrackLive(integration.vehicleCount) : t.vehiclesReporting}</div>
              {integration.connected && <div className="fleet-roster" aria-label={locale === "fr" ? "Tous les camions connectés" : locale === "nl" ? "Alle verbonden voertuigen" : "All connected vehicles"}>{integration.vehicles.map((vehicle) => <span key={vehicle.id}><i />{truckNumberLabel(vehicle.id) && <b className="truck-number-badge" style={{ background: truckBadgeColor(vehicleTruckNumbers.get(vehicle.id) ?? null) }}>{truckNumberLabel(vehicle.id)}</b>}{vehicle.name}<small>{vehicle.speed} km/h</small></span>)}</div>}
            </>}
            {!agencyMapUnavailable && showPopover && deliveries.length > 0 && <div className="truck-popover">
              <div><span className="truck-badge">▰</span><p>
                {renamingVehicleId && renamingVehicleId === selected.sendatrackVehicleId
                  ? <span className="rename-truck"><input value={renameDraft} maxLength={60} disabled={renameBusy} onChange={(event) => setRenameDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void renameVehicle(renamingVehicleId); if (event.key === "Escape") setRenamingVehicleId(null); }} /><button type="button" disabled={renameBusy} aria-label={locale === "fr" ? "Confirmer le nom" : locale === "nl" ? "Naam bevestigen" : "Confirm name"} onClick={() => void renameVehicle(renamingVehicleId)}>✓</button><button type="button" disabled={renameBusy} aria-label={t.cancel} onClick={() => setRenamingVehicleId(null)}>×</button></span>
                  : <><strong>{truckNumberLabel(selected.sendatrackVehicleId) && <b className="truck-number-badge" style={{ background: truckBadgeColor((selected.sendatrackVehicleId ? vehicleTruckNumbers.get(selected.sendatrackVehicleId) : undefined) ?? null) }}>{truckNumberLabel(selected.sendatrackVehicleId)}</b>}{vehicleLabel(selected)}</strong>{company?.role === "dispatcher" && !isUnassignedVehicle(selected) && integration.vehicles.some((vehicle) => vehicle.id === selected.sendatrackVehicleId) && <button type="button" className="rename-trigger" aria-label={locale === "fr" ? "Renommer ce véhicule" : locale === "nl" ? "Dit voertuig hernoemen" : "Rename this vehicle"} onClick={() => { setRenamingVehicleId(selected.sendatrackVehicleId ?? null); setRenameDraft(selected.truck); }}>✎</button>}</>}
                <small>{isUnassignedVehicle(selected) ? (locale === "fr" ? "Aucun camion confirmé" : locale === "nl" ? "Nog geen voertuig bevestigd" : "No truck confirmed yet") : driverLabel(selected.driver)}</small>
              </p><button aria-label={t.closeDetails} onClick={() => setShowPopover(false)}>×</button></div>
              <dl><div><dt>{t.status}</dt><dd><i />{t.statuses[selected.status]}</dd></div><div><dt>{t.delivery}</dt><dd>{selected.id}</dd></div><div><dt>{t.eta}</dt><dd>{selected.estimatedArrivalAt ? new Date(selected.estimatedArrivalAt).toLocaleString(locale === "fr" ? "fr-BE" : locale === "nl" ? "nl-BE" : "en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : selected.eta}</dd></div>{selected.weightKg != null && <div><dt>{locale === "fr" ? "Poids" : locale === "nl" ? "Gewicht" : "Weight"}</dt><dd>{selected.weightKg.toLocaleString(locale === "fr" ? "fr-BE" : locale === "nl" ? "nl-BE" : "en-GB", { maximumFractionDigits: 3 })} kg</dd></div>}{selected.priceAmount != null && selected.priceCurrency && <div><dt>{locale === "fr" ? "Prix" : locale === "nl" ? "Prijs" : "Price"}</dt><dd>{selected.priceAmount.toLocaleString(locale === "fr" ? "fr-BE" : locale === "nl" ? "nl-BE" : "en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {selected.priceCurrency}</dd></div>}</dl>{selected.estimatedArrivalAt && <div className="eta-explanation"><strong>{selectedEtaExplanation.sourceLabel}</strong><span>{selectedEtaExplanation.confidenceLabel}{selected.etaSource === "route-history" && selected.etaHistoricalSpeedKmh ? ` · ${selected.etaHistoricalSpeedKmh} km/h` : ""}</span></div>}
              {company?.role === "dispatcher" && selected.gpsSource !== "sendatrack" && <div style={{ marginTop: 10 }}>
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
              {company?.role === "agency" && selected.destinationSiteId === company.siteId && selected.status !== "Delivered" && <div className="popover-actions"><button type="button" onClick={() => void confirmArrivalForDelivery(selected.id, selected.destinationSiteId)}>{locale === "fr" ? "Confirmer l’arrivée du camion" : locale === "nl" ? "Aankomst vrachtwagen bevestigen" : "Confirm truck arrival"}</button></div>}
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

        {company?.role === "dispatcher" && unassignedDeliveries.length > 0 && <section className="tours-panel" aria-label={locale === "fr" ? "Colis à affecter" : locale === "nl" ? "Toe te wijzen zendingen" : "Parcels to assign"}>
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

        {company?.role !== "agency" && deliveriesPanel}
      </section>

      {modalOpen && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="new-delivery-title"><div className="modal-header"><div><p className="eyebrow">{t.createEyebrow}</p><h2 id="new-delivery-title">{t.createTitle}</h2><span>{integration.connected ? t.createHelpAutomatic : t.createHelp}</span></div><button onClick={() => { setModalOpen(false); setParcelDrafts([{ key: "0", weightKg: "", manualPriceAmount: "" }]); }} aria-label={t.close}>×</button></div><form onSubmit={createDelivery}><div className="form-section"><strong>{locale === "fr" ? "Expéditeur / client" : locale === "nl" ? "Afzender / klant" : "Sender / customer"}</strong><div className="form-row"><label>{t.customerCompany}<input name="customer" required placeholder={t.customerPlaceholder} /></label><label>{t.customerContact} <span>({t.optional})</span><input name="contact" inputMode="tel" autoComplete="tel" placeholder="+32… / +212…" /></label></div></div><div className="form-section"><strong>{locale === "fr" ? "Personne qui reçoit le colis" : locale === "nl" ? "Ontvanger van het pakket" : "Parcel recipient"}</strong><div className="form-row"><label>{locale === "fr" ? "Nom du destinataire" : locale === "nl" ? "Naam ontvanger" : "Recipient name"} <span>({t.optional})</span><input name="recipientName" autoComplete="name" placeholder={locale === "fr" ? "Nom et prénom" : locale === "nl" ? "Voor- en achternaam" : "Full name"} /></label><label>{locale === "fr" ? "Téléphone du destinataire" : locale === "nl" ? "Telefoon ontvanger" : "Recipient phone"} <span>({t.optional})</span><input name="recipientContact" inputMode="tel" autoComplete="tel" placeholder="+32… / +212…" /></label></div><small>{locale === "fr" ? "Renseignez le nom et le téléphone ensemble. Le destinataire recevra les mêmes mises à jour utiles." : locale === "nl" ? "Vul naam en telefoon samen in. De ontvanger krijgt dezelfde nuttige updates." : "Enter name and phone together. The recipient receives the same useful updates."}</small></div><div className="parcel-list">{parcelDrafts.map((parcel, index) => { const preview = creationPricePreviewFor(parcel.weightKg); return <div className="form-row parcel-row" key={parcel.key}>{parcelDrafts.length > 1 && <div className="parcel-row-head">{locale === "fr" ? `Colis ${index + 1}` : locale === "nl" ? `Pakket ${index + 1}` : `Parcel ${index + 1}`}</div>}<label>{locale === "fr" ? "Poids du colis" : locale === "nl" ? "Gewicht zending" : "Parcel weight"} <span>({t.optional})</span><input type="number" min="0.001" max="100000" step="0.001" inputMode="decimal" placeholder="kg" value={parcel.weightKg} onChange={(event) => { const value = event.target.value; setParcelDrafts((rows) => rows.map((row) => row.key === parcel.key ? { ...row, weightKg: value } : row)); }} /><small>{locale === "fr" ? "Laissez vide pour un objet volumineux (machine à laver, télé…)" : locale === "nl" ? "Laat leeg voor een groot voorwerp (wasmachine, tv…)" : "Leave blank for a bulky item (washing machine, TV…)"}</small></label><label>{parcel.weightKg ? (locale === "fr" ? "Prix calculé" : locale === "nl" ? "Berekende prijs" : "Calculated price") : (locale === "fr" ? "Prix manuel" : locale === "nl" ? "Handmatige prijs" : "Manual price")}{parcel.weightKg ? <div className="price-preview">{preview.priceAmount != null ? <strong>{preview.priceAmount.toLocaleString(locale === "fr" ? "fr-BE" : locale === "nl" ? "nl-BE" : "en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {preview.priceCurrency}</strong> : <span>{locale === "fr" ? "Renseignez le poids" : locale === "nl" ? "Vul het gewicht in" : "Enter the weight"}</span>}</div> : <input type="number" min="0.01" max="1000000" step="0.01" inputMode="decimal" placeholder={creationOriginCountry === "MA" ? "MAD" : "EUR"} value={parcel.manualPriceAmount} onChange={(event) => { const value = event.target.value; setParcelDrafts((rows) => rows.map((row) => row.key === parcel.key ? { ...row, manualPriceAmount: value } : row)); }} />}<small>{parcel.weightKg ? (creationOriginCountry === "MA" ? (locale === "fr" ? "15 DH/kg au départ du Maroc" : locale === "nl" ? "15 DH/kg vanuit Marokko" : "15 MAD/kg from Morocco") : (locale === "fr" ? "1,50 €/kg" : locale === "nl" ? "1,50 €/kg" : "1.50 EUR/kg")) : (locale === "fr" ? "Objet volumineux : indiquez le prix directement" : locale === "nl" ? "Groot voorwerp: geef de prijs rechtstreeks op" : "Bulky item: enter the price directly")}</small></label>{parcelDrafts.length > 1 && <button type="button" className="remove-parcel-row" aria-label={locale === "fr" ? "Retirer ce colis" : locale === "nl" ? "Dit pakket verwijderen" : "Remove this parcel"} onClick={() => setParcelDrafts((rows) => rows.filter((row) => row.key !== parcel.key))}>×</button>}</div>; })}<button type="button" className="add-parcel-row" onClick={() => setParcelDrafts((rows) => [...rows, { key: crypto.randomUUID(), weightKg: "", manualPriceAmount: "" }])}>{locale === "fr" ? "+ Ajouter un colis pour ce client" : locale === "nl" ? "+ Pakket toevoegen voor deze klant" : "+ Add another parcel for this customer"}</button></div><div className="form-row"><label>{locale === "fr" ? "Site de départ" : locale === "nl" ? "Vertreklocatie" : "Origin site"}<select name="originSiteId" required value={defaultOriginSiteId} disabled={company?.role === "agency"} onChange={(event) => { const siteId = event.target.value; setDefaultOriginSiteId(siteId); if (company) window.localStorage.setItem(originPreferenceKey(company), siteId); }}><option value="" disabled>{locale === "fr" ? "Choisir le site" : locale === "nl" ? "Kies locatie" : "Choose site"}</option>{knownSites.filter((site) => site.roles.includes("origin") && (company?.role !== "agency" || site.id === company.siteId)).map((site) => <option key={site.id} value={site.id}>{site.label}</option>)}</select><small>{company?.role === "agency" ? (locale === "fr" ? "Les colis enregistrés sont automatiquement rattachés à votre agence." : locale === "nl" ? "Geregistreerde zendingen worden automatisch aan uw agentschap gekoppeld." : "Registered parcels are automatically assigned to your agency.") : (locale === "fr" ? "Ce choix sera mémorisé pour cet utilisateur sur ce navigateur." : locale === "nl" ? "Deze keuze wordt voor deze gebruiker in deze browser onthouden." : "This choice will be remembered for this user on this browser.")}</small></label><label>{t.destination}<select name="destinationSiteId" required defaultValue=""><option value="" disabled>{locale === "fr" ? "Choisir l'agence" : locale === "nl" ? "Kies agentschap" : "Choose agency"}</option>{knownSites.filter((site) => site.roles.includes("destination")).map((site) => <option key={site.id} value={site.id}>{site.label}</option>)}</select></label></div><div className="form-row">{integration.connected && integration.vehicles.length ? <label>{t.assignTruck}<select name="sendatrackVehicleId" defaultValue={UNASSIGNED_VEHICLE_ID}><option value={UNASSIGNED_VEHICLE_ID}>{locale === "fr" ? "À affecter plus tard (recommandé)" : locale === "nl" ? "Later toewijzen (aanbevolen)" : "Assign later (recommended)"}</option>{integration.vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.name}</option>)}</select><input name="manualTruck" placeholder={locale === "fr" ? "Camion absent ? Nom / plaque (optionnel)" : locale === "nl" ? "Voertuig ontbreekt? Naam / nummerplaat (optioneel)" : "Truck missing? Name / plate (optional)"} /><small>{locale === "fr" ? "Si vous saisissez un camion ici, il sera créé en attente GPS puis associé quand il apparaîtra dans SENDATRACK." : locale === "nl" ? "Als u hier een voertuig invoert, wordt het in afwachting van GPS aangemaakt en gekoppeld zodra het in SENDATRACK verschijnt." : "If you enter a truck here, it will be created waiting for GPS and linked when it appears in SENDATRACK."}</small></label> : <label>{t.assignTruck}<input name="manualTruck" placeholder={locale === "fr" ? "Optionnel · Ex. TRK-005 / plaque" : locale === "nl" ? "Optioneel · Bijv. TRK-005 / nummerplaat" : "Optional · E.g. TRK-005 / plate"} /><small>{locale === "fr" ? "Laissez vide si le camion n’est pas encore connu. Vous pourrez l’affecter plus tard." : locale === "nl" ? "Laat leeg als het voertuig nog niet bekend is. U kunt het later toewijzen." : "Leave blank if the truck is not known yet. You can assign it later."}</small></label>}<label>{t.expectedArrival}<input name="plannedArrivalAt" required type="datetime-local" /></label></div><div className="form-row"><label>{locale === "fr" ? "Date de départ du prochain camion" : locale === "nl" ? "Vertrekdatum volgende vrachtwagen" : "Next truck departure date"}<input name="nextTruckDepartureAt" required type="datetime-local" defaultValue={defaultTruckDepartureAt} /><small>{truckDepartureIsStale ? (locale === "fr" ? "⚠ Cette date est peut-être dépassée. Vérifiez qu'elle correspond bien au prochain camion avant de valider." : locale === "nl" ? "⚠ Deze datum is mogelijk verouderd. Controleer of ze overeenkomt met de volgende vrachtwagen voordat u bevestigt." : "⚠ This date may be outdated. Confirm it matches the next truck before submitting.") : (locale === "fr" ? "Pré-rempli avec la dernière valeur saisie pour ce camion relais." : locale === "nl" ? "Vooraf ingevuld met de laatst ingevoerde waarde voor deze relaisvrachtwagen." : "Pre-filled with the last value entered for this relay truck.")}</small></label></div><label className="consent-choice"><input type="checkbox" name="whatsappOptIn" /><span>{locale === "fr" ? "Nouveau consentement WhatsApp confirmé pour les numéros renseignés" : locale === "nl" ? "Nieuwe WhatsApp-toestemming bevestigd voor de ingevulde nummers" : "New WhatsApp consent confirmed for the entered numbers"}<small>{locale === "fr" ? "Inutile de cocher si ce numéro a déjà consenti auparavant : TrackFleet le reconnaît automatiquement. Le consentement peut toujours être retiré." : locale === "nl" ? "Niet nodig als dit nummer eerder toestemming gaf: TrackFleet herkent dit automatisch. Toestemming kan altijd worden ingetrokken." : "Do not check this when the number already consented: TrackFleet remembers it automatically. Consent can always be withdrawn."}</small></span></label><div className="modal-footer"><button type="button" onClick={() => { setModalOpen(false); setParcelDrafts([{ key: "0", weightKg: "", manualPriceAmount: "" }]); }}>{t.cancel}</button><button className="primary-button" type="submit" disabled={creating}>{creating ? t.creating : t.createDelivery}<span>→</span></button></div></form></section></div>}
      {toast && <div className="toast" role="status" aria-live="polite"><span>✓</span>{toast}</div>}
    </main>
  );
}
