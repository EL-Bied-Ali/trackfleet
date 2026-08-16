"use client";

import { useEffect, useMemo, useState } from "react";
import { localeOptions, translations, type Locale } from "./i18n";
import InteractiveFleetMap from "./InteractiveFleetMap";

type DeliveryStatus = "In transit" | "Delayed" | "Loading" | "Delivered";
type DeliveryEventType = "DEPARTED" | "PROGRESS_25" | "PROGRESS_50" | "PROGRESS_75" | "NEAR_DESTINATION" | "DELAY_DETECTED" | "ARRIVED" | "GPS_STALE";

type Delivery = {
  id: string;
  customer: string;
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
  routeDistanceKm?: number | null;
  remainingDistanceKm?: number | null;
  distanceToDestinationKm?: number | null;
  positionAgeMinutes?: number | null;
  gpsFresh?: boolean;
  plannedArrivalAt?: string | null;
  estimatedArrivalAt?: string | null;
  etaDelayMinutes?: number | null;
  etaConfidence?: "none" | "low" | "medium";
  etaSource?: "unavailable" | "baseline-model" | "observed-pace";
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

type MessageEvent = {
  id: string;
  deliveryId: string;
  kind: "tracking" | "arrival";
  time: string;
};

type CompanyIdentity = { account: string; user: string };
type KnownSite = { id: string; label: string; address: string; country: "BE" | "MA"; latitude: number | null; longitude: number | null; arrivalRadiusKm: number; geofenceReady: boolean };

const initialDeliveries: Delivery[] = [
  { id: "TF-2841", customer: "Atlas Home", destination: "Casablanca, MA", truck: "TRK-014", driver: "Youssef B.", status: "In transit", eta: "19 Aug · 14:00–18:00", progress: 68, color: "#16a272" },
  { id: "TF-2839", customer: "Medina Import", destination: "Tangier, MA", truck: "TRK-007", driver: "Sophie L.", status: "Delayed", eta: "20 Aug · 09:00–13:00", progress: 55, color: "#f1a43c" },
  { id: "TF-2837", customer: "Brussels Parts", destination: "Brussels, BE", truck: "TRK-019", driver: "Amine R.", status: "In transit", eta: "18 Aug · 16:00–20:00", progress: 82, color: "#4776e6" },
  { id: "TF-2835", customer: "Rif Logistics", destination: "Antwerp, BE", truck: "TRK-003", driver: "Nora V.", status: "Loading", eta: "21 Aug · 10:00–14:00", progress: 8, color: "#916ed7" },
  { id: "TF-2832", customer: "EuroMaghreb", destination: "Liège, BE", truck: "TRK-011", driver: "Marc D.", status: "Delivered", eta: "17 Aug · 17:32", progress: 100, color: "#6b7280" },
];

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

function LoginScreen({ locale, busy, error, onLocale, onSubmit }: { locale: Locale; busy: boolean; error: string; onLocale: (locale: Locale) => void; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void }) {
  const copy = {
    fr: { eyebrow: "ESPACE ENTREPRISE", title: "Connectez votre flotte SENDATRACK", body: "Utilisez les mêmes identifiants que dans l’application SENDATRACK. Votre espace TrackFleet sera reconnu automatiquement.", account: "Compte", user: "Utilisateur", password: "Mot de passe", submit: "Accéder à TrackFleet", loading: "Connexion…", error: "Identifiants incorrects ou service SENDATRACK indisponible.", privacy: "Connexion chiffrée côté TrackFleet · aucune donnée visible par vos clients" },
    en: { eyebrow: "COMPANY PORTAL", title: "Connect your SENDATRACK fleet", body: "Use the same credentials as in the SENDATRACK app. Your TrackFleet workspace will be recognized automatically.", account: "Account", user: "User", password: "Password", submit: "Open TrackFleet", loading: "Connecting…", error: "Incorrect credentials or SENDATRACK is unavailable.", privacy: "Encrypted by TrackFleet · credentials are never visible to customers" },
    nl: { eyebrow: "BEDRIJFSPORTAAL", title: "Koppel uw SENDATRACK-wagenpark", body: "Gebruik dezelfde gegevens als in de SENDATRACK-app. Uw TrackFleet-ruimte wordt automatisch herkend.", account: "Account", user: "Gebruiker", password: "Wachtwoord", submit: "TrackFleet openen", loading: "Verbinden…", error: "Onjuiste gegevens of SENDATRACK is niet beschikbaar.", privacy: "Versleuteld door TrackFleet · nooit zichtbaar voor klanten" },
  }[locale];
  return <main className="login-page">
    <header className="login-header"><a className="brand brand-dark" href="/"><span className="brand-mark"><span>↗</span></span><span>TrackFleet</span></a><LanguageSwitcher locale={locale} label="Language" onChange={onLocale} /></header>
    <section className="login-layout">
      <div className="login-story"><p className="eyebrow">{copy.eyebrow}</p><h1>{copy.title}</h1><p>{copy.body}</p><div className="login-route"><span>BE</span><i /><b>↗</b><i /><span>MA</span></div><small>Belgique · France · Espagne · Maroc</small></div>
      <form className="login-card" onSubmit={onSubmit}>
        <div className="login-provider"><span>⌖</span><div><strong>SENDATRACK</strong><small>GPS fleet connection</small></div></div>
        <label>{copy.account}<input name="accountID" autoComplete="organization" required placeholder="Compte SENDATRACK" /></label>
        <label>{copy.user}<input name="user" autoComplete="username" required placeholder="Utilisateur" /></label>
        <label>{copy.password}<input name="password" type="password" autoComplete="current-password" required placeholder="••••••••" /></label>
        {error && <p className="login-error" role="alert">{copy.error}</p>}
        <button className="login-submit" disabled={busy}>{busy ? copy.loading : copy.submit}<span>→</span></button>
        <p className="login-privacy">⌁ {copy.privacy}</p>
      </form>
    </section>
  </main>;
}

export default function Home() {
  const [deliveries, setDeliveries] = useState(initialDeliveries);
  const [selectedId, setSelectedId] = useState("TF-2841");
  const [view, setView] = useState<"dispatch" | "customer">("dispatch");
  const [modalOpen, setModalOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [filter, setFilter] = useState("All deliveries");
  const [showPopover, setShowPopover] = useState(true);
  const [creating, setCreating] = useState(false);
  const [whatsAppBusy, setWhatsAppBusy] = useState<"tracking" | "arrival" | null>(null);
  const [locale, setLocale] = useState<Locale>("en");
  const [authState, setAuthState] = useState<"loading" | "anonymous" | "authenticated">("loading");
  const [company, setCompany] = useState<CompanyIdentity | null>(null);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [publicTrackingState, setPublicTrackingState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [integration, setIntegration] = useState<IntegrationState>({ configured: false, connected: false, vehicleCount: 0, error: null, vehicles: [] });
  const [deliveryEvents, setDeliveryEvents] = useState<DeliveryEventRow[]>([]);
  const [knownSites, setKnownSites] = useState<KnownSite[]>([]);
  const [messageEvents, setMessageEvents] = useState<MessageEvent[]>([
    { id: "demo-tracking", deliveryId: "TF-2841", kind: "tracking", time: "13:06" },
  ]);
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
      setAuthState("authenticated");
    }).catch(() => { if (active) setAuthState("anonymous"); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (authState !== "authenticated") return;
    let active = true;
    void fetch("/api/sites", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() as Promise<{ sites: KnownSite[] }> : { sites: [] })
      .then((data) => { if (active) setKnownSites(data.sites ?? []); })
      .catch(() => { if (active) setKnownSites([]); });
    return () => { active = false; };
  }, [authState]);

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
        const data = await response.json() as { deliveries: Delivery[]; integration?: IntegrationState; events?: DeliveryEventRow[] };
        if (!active) return;
        if (tracking && data.deliveries.length) {
          setDeliveries(data.deliveries);
          setDeliveryEvents(data.events ?? []);
          setSelectedId(data.deliveries[0].id);
          setPublicTrackingState("ready");
        } else if (!tracking) {
          setDeliveries(data.deliveries);
          if (data.deliveries.length && !data.deliveries.some((delivery) => delivery.id === selectedId)) setSelectedId(data.deliveries[0].id);
        }
        if (data.integration) setIntegration(data.integration);
      } catch {
        if (new URLSearchParams(window.location.search).get("tracking")) setPublicTrackingState("error");
        if (active && !silent) setToast(t.cloudReconnecting);
      }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(true), 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [authState]);

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
  const selected = deliveries.find((item) => item.id === selectedId) ?? deliveries[0] ?? initialDeliveries[0];
  const customerCopy = t.customerStatus[selected.status];
  const headingToMorocco = selected.destination.endsWith(", MA");
  const routeDirection = headingToMorocco ? t.belgiumToMorocco : t.moroccoToBelgium;
  const visibleDeliveries = useMemo(() => {
    if (filter === "All deliveries") return deliveries;
    return deliveries.filter((delivery) => delivery.status === filter);
  }, [deliveries, filter]);
  const mapDeliveries = integration.connected
    ? deliveries.filter((delivery) => delivery.gpsSource === "sendatrack")
    : deliveries;
  const completedWithPlan = deliveries.filter((delivery) => delivery.status === "Delivered" && delivery.etaDelayMinutes != null);
  const onTimeRate = completedWithPlan.length
    ? Math.round((completedWithPlan.filter((delivery) => (delivery.etaDelayMinutes ?? 0) <= 0).length / completedWithPlan.length) * 1000) / 10
    : null;
  const delayedCount = deliveries.filter((delivery) => delivery.status !== "Delivered" && (delivery.status === "Delayed" || (delivery.etaDelayMinutes ?? 0) >= 60)).length;
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
      if (!response.ok) throw new Error("login_failed");
      const data = await response.json() as { company: CompanyIdentity };
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
    setAuthState("anonymous");
  }

  async function createDelivery(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const selectedVehicleId = String(form.get("sendatrackVehicleId") ?? "");
    const liveVehicle = integration.vehicles.find((vehicle) => vehicle.id === selectedVehicleId);
    const truck = liveVehicle?.name ?? selectedVehicleId;
    const destination = String(form.get("destination") ?? "").trim();
    const selectedSite = knownSites.find((site) => site.address === destination || site.label === destination);
    const plannedArrivalInput = String(form.get("plannedArrivalAt") ?? "").trim();
    const plannedArrivalAt = plannedArrivalInput ? new Date(plannedArrivalInput).toISOString() : "";
    const draftDelivery = {
      customer: String(form.get("customer")),
      destination,
      destinationSiteId: selectedSite?.id ?? "",
      destinationLatitude: selectedSite?.latitude ?? null,
      destinationLongitude: selectedSite?.longitude ?? null,
      arrivalRadiusKm: selectedSite?.arrivalRadiusKm ?? 0.5,
      truck,
      sendatrackVehicleId: liveVehicle?.id ?? "",
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
    const etaNote = selected.etaDelayMinutes != null && selected.etaDelayMinutes >= 60
      ? `+${Math.round(selected.etaDelayMinutes / 60)} h`
      : selected.etaConfidence === "medium"
        ? (locale === "fr" ? "Estimation basée sur le trajet réel" : locale === "nl" ? "Schatting op basis van werkelijk traject" : "Estimate based on observed trip pace")
        : (locale === "fr" ? "Estimation indicative" : locale === "nl" ? "Indicatieve schatting" : "Indicative estimate");

    return (
      <main className="customer-page">
        <header className="customer-header">
          <a className="brand brand-dark" href="/" onClick={(event) => { event.preventDefault(); openDispatchView(); }}>
            <span className="brand-mark"><span>↗</span></span>
            <span>TrackFleet</span>
          </a>
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
        <a className="brand" href="#"><span className="brand-mark"><span>↗</span></span><span>TrackFleet</span></a>
        <nav aria-label="Main navigation">
          <button className="nav-item active"><Icon>▦</Icon>{t.overview}</button>
          <button className="nav-item" disabled><Icon>▰</Icon>{t.fleet} <span className="nav-count">{integration.connected ? integration.vehicleCount : 20}</span></button>
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
          <div className="top-actions"><LanguageSwitcher locale={locale} label={t.language} onChange={changeLocale} /><button className="primary-button" onClick={() => setModalOpen(true)}><span>＋</span>{t.newDelivery}</button></div>
        </header>

        <div className="stats-grid">
          <article className="stat-card"><div className="stat-head"><span>{t.activeDeliveries}</span><Icon>◇</Icon></div><div><strong>{deliveries.filter((delivery) => delivery.status !== "Delivered").length}</strong><em className="up">GPS</em></div><p>{t.acrossVehicles}</p></article>
          <article className="stat-card"><div className="stat-head"><span>{t.onTimeRate}</span><Icon>◷</Icon></div><div><strong>{onTimeRate == null ? "—" : `${onTimeRate}%`}</strong><em className="neutral">{completedWithPlan.length ? `${completedWithPlan.length} ${liveKpiCopy.completed}` : liveKpiCopy.noHistory}</em></div><p>{completedWithPlan.length ? liveKpiCopy.onTimeBody : liveKpiCopy.onTimeEmpty}</p></article>
          <article className="stat-card"><div className="stat-head"><span>{t.delayed}</span><Icon>△</Icon></div><div><strong>{delayedCount}</strong>{delayedCount > 0 && <em className="warning">{t.needsAttention}</em>}</div><p>{delayedCount > 0 ? t.delayReasons : liveKpiCopy.noDelay}</p></article>
          <article className="stat-card"><div className="stat-head"><span>{t.fleetStatus}</span><Icon>▰</Icon></div><div><strong>{integration.connected ? `${integration.vehicleCount} GPS` : "17 / 20"}</strong><em className="neutral">{integration.connected ? t.sendatrack : t.atDepot}</em></div><p>{integration.connected ? t.positionsAutomatic : t.allReporting}</p></article>
        </div>

        <div className="map-panel">
          <div className="panel-header"><div><h2>{t.liveFleet}</h2><p>{integration.connected ? t.sendatrackRefreshing : t.updatesEvery30}</p></div><div className="panel-actions"><select aria-label={t.findVehicle} value={selectedId} onChange={(event) => { setSelectedId(event.target.value); setShowPopover(true); }}>{deliveries.map((delivery) => <option key={delivery.id} value={delivery.id}>{delivery.truck}</option>)}</select></div></div>
          <div className="map fleet-map">
            <InteractiveFleetMap deliveries={mapDeliveries} liveVehicles={integration.vehicles} selectedId={selectedId} label={t.liveFleet} onSelect={(deliveryId) => { setSelectedId(deliveryId); setShowPopover(true); }} />
            <div className="map-status"><i className={integration.connected ? "" : "fallback"} /> {integration.connected ? t.sendatrackLive(integration.vehicleCount) : t.vehiclesReporting}</div>
            {showPopover && deliveries.length > 0 && <div className="truck-popover">
              <div><span className="truck-badge">▰</span><p><strong>{selected.truck}</strong><small>{selected.driver}</small></p><button aria-label={t.closeDetails} onClick={() => setShowPopover(false)}>×</button></div>
              <dl><div><dt>{t.status}</dt><dd><i />{t.statuses[selected.status]}</dd></div><div><dt>{t.delivery}</dt><dd>{selected.id}</dd></div><div><dt>{t.eta}</dt><dd>{selected.estimatedArrivalAt ? new Date(selected.estimatedArrivalAt).toLocaleString(locale === "fr" ? "fr-BE" : locale === "nl" ? "nl-BE" : "en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : selected.eta}</dd></div></dl>
              <div className="popover-actions"><button onClick={openCustomerView}>{t.openTracking} <span>↗</span></button><button className="copy-link" onClick={copyTrackingLink}>{t.copyLink}</button></div>
            </div>}
          </div>
          {deliveries.length > 0 && <section className="whatsapp-demo" aria-labelledby="whatsapp-demo-title">
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

        <div className="deliveries-panel">
          <div className="panel-header delivery-head"><div><h2>{t.todaysDeliveries}</h2><p>{t.shownCompleted(visibleDeliveries.length, deliveries.filter((delivery) => delivery.status === "Delivered").length)}</p></div><div className="panel-actions"><select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label={t.filterDeliveries}><option value="All deliveries">{t.allDeliveries}</option><option value="In transit">{t.statuses["In transit"]}</option><option value="Delayed">{t.statuses.Delayed}</option><option value="Loading">{t.statuses.Loading}</option><option value="Delivered">{t.statuses.Delivered}</option></select></div></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>{t.tableDelivery}</th><th>{t.tableCustomer}</th><th>{t.tableVehicle}</th><th>{t.tableStatus}</th><th>{t.tableEta}</th><th>{t.tableProgress}</th><th><span className="sr-only">{t.tableActions}</span></th></tr></thead>
              <tbody>{visibleDeliveries.map((delivery) => <tr key={delivery.id} tabIndex={0} onClick={() => { setSelectedId(delivery.id); setShowPopover(true); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedId(delivery.id); setShowPopover(true); } }} className={selectedId === delivery.id ? "row-selected" : ""}><td><strong>{delivery.id}</strong><span>{delivery.destination}</span></td><td><div className="customer-cell"><i style={{ background: delivery.color }}>{delivery.customer.split(" ").map((word) => word[0]).slice(0,2).join("")}</i><span>{delivery.customer}</span></div></td><td><strong>{delivery.truck}</strong><span>{delivery.driver}</span></td><td><span className={statusClass[delivery.status]}><i />{t.statuses[delivery.status]}</span></td><td><strong>{delivery.estimatedArrivalAt ? new Date(delivery.estimatedArrivalAt).toLocaleString(locale === "fr" ? "fr-BE" : locale === "nl" ? "nl-BE" : "en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : delivery.eta}</strong><span>{(delivery.etaDelayMinutes ?? 0) >= 60 ? `+${Math.round((delivery.etaDelayMinutes ?? 0) / 60)}h` : delivery.status === "Delivered" ? t.arrived : t.today}</span></td><td><div className="progress"><div><i style={{ width: `${delivery.progress}%` }} /></div><span>{delivery.progress}%</span></div></td><td><button className="more-button" aria-label={t.copyTrackingFor(delivery.id)} onClick={(event) => { event.stopPropagation(); void copyDeliveryLink(delivery.id); }}>↗</button></td></tr>)}</tbody>
            </table>
          </div>
        </div>
      </section>

      {modalOpen && <div className="modal-backdrop" role="presentation" onMouseDown={() => setModalOpen(false)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="new-delivery-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-header"><div><p className="eyebrow">{t.createEyebrow}</p><h2 id="new-delivery-title">{t.createTitle}</h2><span>{integration.connected ? t.createHelpAutomatic : t.createHelp}</span></div><button onClick={() => setModalOpen(false)} aria-label={t.close}>×</button></div><form onSubmit={createDelivery}><label>{t.customerCompany}<input name="customer" required autoFocus placeholder={t.customerPlaceholder} /></label><label>{t.destination}<input name="destination" required list="trackfleet-known-sites" placeholder={t.destinationPlaceholder} /><datalist id="trackfleet-known-sites">{knownSites.map((site) => <option key={site.id} value={site.address}>{site.label}</option>)}</datalist></label><div className="form-row"><label>{t.assignTruck}<select name="sendatrackVehicleId" defaultValue={integration.vehicles[0]?.id ?? "TRK-005"}>{integration.vehicles.length ? integration.vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.name}</option>) : <><option>TRK-005</option><option>TRK-008</option><option>TRK-012</option><option>TRK-017</option></>}</select></label><label>{t.expectedArrival}<input name="plannedArrivalAt" required type="datetime-local" /></label></div><label>{t.customerContact} <span>({t.optional})</span><input name="contact" placeholder={t.contactPlaceholder} /></label><div className="modal-footer"><button type="button" onClick={() => setModalOpen(false)}>{t.cancel}</button><button className="primary-button" type="submit" disabled={creating}>{creating ? t.creating : t.createDelivery}<span>→</span></button></div></form></section></div>}
      {toast && <div className="toast" role="status" aria-live="polite"><span>✓</span>{toast}</div>}
    </main>
  );
}
