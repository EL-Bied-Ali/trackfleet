"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { localeOptions, translations, type Locale } from "./i18n";
import InteractiveFleetMap from "./InteractiveFleetMap";
import AgencyLocationSetup from "./AgencyLocationSetup";
import SiteManager from "./SiteManager";
import { classifyLoginError, type LoginErrorKind } from "./lib/login-error";
import { originPreferenceKey, resolvePreferredOriginSite } from "./lib/origin-preference";
import { truckPreferenceKey, resolvePreferredTruck } from "./lib/truck-preference";
import { rankVehicleSuggestions } from "./lib/vehicle-linking";
import { customerEtaNote, etaExplanation } from "./lib/eta-display";
import { computeDeliveryPrice } from "./lib/delivery-pricing";
import { knownSite as staticKnownSite } from "./lib/known-sites";
import { estimateRelayArrival } from "./lib/relay-eta-estimate";
import { clearRememberedLogin, readRememberedLogin, saveRememberedLogin } from "./lib/remembered-login";
import { isUnassignedVehicle, resolveCreationVehicle } from "./lib/delivery-vehicle-choice";
import { suggestPlannedTrip } from "./lib/trip-suggestion";
import {
  deliveryCreationDraftKey, isMeaningfulDeliveryCreationDraft,
  type DeliveryCreationDraft,
} from "./lib/delivery-creation-draft";

declare global {
  interface Window {
    Paddle?: {
      Environment: { set: (environment: "sandbox") => void };
      Initialize: (options: { token: string; eventCallback?: (event: { name: string }) => void }) => void;
      Checkout: { open: (options: { transactionId: string }) => void };
    };
  }
}

// Module-level (not component state) on purpose: Paddle.js is a third-party
// script + SDK singleton, not per-render UI state, and Paddle.Initialize
// must only ever run once per page -- calling it again on every remount of
// the subscribe screen would re-register (and potentially duplicate) its
// event callback.
let paddleScriptPromise: Promise<void> | null = null;
let paddleInitialized = false;

function loadPaddleScript(): Promise<void> {
  if (window.Paddle) return Promise.resolve();
  if (!paddleScriptPromise) {
    paddleScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.paddle.com/paddle/v2/paddle.js";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("paddle_script_load_failed"));
      document.head.appendChild(script);
    });
  }
  return paddleScriptPromise;
}

// Fetches Paddle's public client-side token (safe to expose -- it's meant
// to be embedded in frontend JS, unlike the server-side PADDLE_API_KEY) and
// initializes the Paddle.js overlay checkout exactly once. Returns whether
// Paddle.js is ready to open a checkout.
async function ensurePaddleReady(handleEvent: (event: { name: string }) => void): Promise<boolean> {
  try {
    await loadPaddleScript();
    if (!window.Paddle) return false;
    if (!paddleInitialized) {
      const response = await fetch("/api/subscription/checkout", { cache: "no-store" });
      if (!response.ok) return false;
      const config = await response.json() as { clientToken?: string; environment?: "live" | "sandbox" };
      if (!config.clientToken) return false;
      if (config.environment === "sandbox") window.Paddle.Environment.set("sandbox");
      window.Paddle.Initialize({ token: config.clientToken, eventCallback: handleEvent });
      paddleInitialized = true;
    }
    return true;
  } catch {
    return false;
  }
}

type DeliveryStatus = "In transit" | "Delayed" | "Loading" | "Delivered";
type DeliveryEventType = "REGISTERED" | "DEPARTED" | "PROGRESS_25" | "PROGRESS_50" | "PROGRESS_75" | "NEAR_DESTINATION" | "ARRIVED_AT_SITE" | "DELAY_DETECTED" | "ARRIVED" | "GPS_STALE" | "SCAN_LOADED" | "SCAN_HUB_ARRIVED";

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
  customerEmail?: string | null;
  recipientName?: string;
  recipientContact?: string;
  weightKg?: number | null;
  priceAmount?: number | null;
  priceCurrency?: "EUR" | "MAD" | null;
  itemDescription?: string | null;
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
  labelPrintRequestedAt?: string | null;
  scanSummary?: {
    loadedAt: string | null;
    loadedTruck: string | null;
    hubArrivedAt: string | null;
    hubLabel: string | null;
  } | null;
};

type DeliveryEventRow = {
  deliveryId: string;
  type: DeliveryEventType;
  progress: number;
  createdAt: string;
};

type VehicleOption = { id: string; name: string; speed: number; updatedAt: number; latitude: number; longitude: number; address?: string };
type IntegrationState = { configured: boolean; connected: boolean; vehicleCount: number; error: string | null; vehicles: VehicleOption[] };
type FeatureState = { whatsappDemoEnabled: boolean; whatsappAvailable: boolean };
type CompanyBranding = { name: string | null; logoDataUrl: string | null; color: string | null };
const emptyCompanyBranding: CompanyBranding = { name: null, logoDataUrl: null, color: null };
type CompanyAutomationSettings = { unloadGraceMinutes: number | null; ctmRelayGraceMinutes: number | null; ctmRelayAutoCompletionEnabled: boolean | null };
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

async function cropLogoDataUrl(dataUrl: string) {
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("logo_decode_failed"));
    image.src = dataUrl;
  });
  const source = document.createElement("canvas");
  source.width = image.naturalWidth || image.width;
  source.height = image.naturalHeight || image.height;
  const sourceContext = source.getContext("2d", { willReadFrequently: true });
  if (!sourceContext || source.width < 1 || source.height < 1) return dataUrl;
  sourceContext.drawImage(image, 0, 0, source.width, source.height);

  const pixels = sourceContext.getImageData(0, 0, source.width, source.height).data;
  let left = source.width;
  let top = source.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const offset = (y * source.width + x) * 4;
      const alpha = pixels[offset + 3];
      const isNearWhite = pixels[offset] > 245 && pixels[offset + 1] > 245 && pixels[offset + 2] > 245;
      if (alpha < 16 || isNearWhite) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left || bottom < top) return dataUrl;

  const padding = Math.max(2, Math.round(Math.max(right - left + 1, bottom - top + 1) * 0.04));
  left = Math.max(0, left - padding);
  top = Math.max(0, top - padding);
  right = Math.min(source.width - 1, right + padding);
  bottom = Math.min(source.height - 1, bottom + padding);
  const cropWidth = right - left + 1;
  const cropHeight = bottom - top + 1;
  const maxDimension = 320;
  const scale = Math.min(1, maxDimension / Math.max(cropWidth, cropHeight));
  const output = document.createElement("canvas");
  output.width = Math.max(1, Math.round(cropWidth * scale));
  output.height = Math.max(1, Math.round(cropHeight * scale));
  const outputContext = output.getContext("2d");
  if (!outputContext) return dataUrl;
  outputContext.imageSmoothingEnabled = true;
  outputContext.imageSmoothingQuality = "high";
  outputContext.drawImage(source, left, top, cropWidth, cropHeight, 0, 0, output.width, output.height);
  return output.toDataURL("image/png");
}

function CompanyLogo({ logoDataUrl, className }: { logoDataUrl: string | null; className: string }) {
  const [displayLogo, setDisplayLogo] = useState(logoDataUrl);
  useEffect(() => {
    let active = true;
    setDisplayLogo(logoDataUrl);
    if (!logoDataUrl) return () => { active = false; };
    void cropLogoDataUrl(logoDataUrl).then((croppedLogo) => {
      if (active) setDisplayLogo(croppedLogo);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [logoDataUrl]);
  return <span className={className}>{displayLogo ? <img src={displayLogo} alt="" /> /* eslint-disable-line @next/next/no-img-element -- a client-generated data: URI, not a static/remote asset Next's image pipeline could optimize */ : <span>↗</span>}</span>;
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

function LoginScreen({ locale, busy, error, onLocale, onSubmit, googleLink, googleLinkBusy, googleLinkError, googleError, onGoogleLinkSubmit, onGoogleLinkCancel }: {
  locale: Locale;
  busy: boolean;
  error: LoginErrorKind | "";
  onLocale: (locale: Locale) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  googleLink: { token: string; email: string } | null;
  googleLinkBusy: boolean;
  googleLinkError: LoginErrorKind | "";
  googleError: boolean;
  onGoogleLinkSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onGoogleLinkCancel: () => void;
}) {
  const copy = {
    fr: { eyebrow: "ESPACE ENTREPRISE", title: "Connectez votre flotte SENDATRACK", body: "Utilisez les mêmes identifiants que dans l’application SENDATRACK. Votre espace TrackFleet sera reconnu automatiquement.", account: "Compte", accountPlaceholder: "Compte SENDATRACK", user: "Utilisateur", userPlaceholder: "Utilisateur", password: "Mot de passe", remember: "Se souvenir de mon compte et utilisateur sur cet appareil", submit: "Accéder à TrackFleet", loading: "Connexion…", invalidCredentials: "Identifiants SENDATRACK incorrects.", serviceUnavailable: "SENDATRACK est temporairement indisponible. Réessayez dans quelques instants.", loginFailed: "Connexion impossible. Réessayez.", privacy: "Connexion chiffrée côté TrackFleet · aucune donnée visible par vos clients", google: "Continuer avec Google", or: "ou", googleError: "Connexion Google impossible. Réessayez.", linkTitle: "Associez votre compte Google", linkBody: (email: string) => `Première connexion avec ${email}. Entrez vos identifiants SENDATRACK une seule fois pour associer ce compte Google -- la prochaine fois, un clic suffira.`, linkSubmit: "Associer et continuer", linkCancel: "Utiliser un autre identifiant" },
    en: { eyebrow: "COMPANY PORTAL", title: "Connect your SENDATRACK fleet", body: "Use the same credentials as in the SENDATRACK app. Your TrackFleet workspace will be recognized automatically.", account: "Account", accountPlaceholder: "SENDATRACK account", user: "User", userPlaceholder: "User", password: "Password", remember: "Remember my account and username on this device", submit: "Open TrackFleet", loading: "Connecting…", invalidCredentials: "Incorrect SENDATRACK credentials.", serviceUnavailable: "SENDATRACK is temporarily unavailable. Please try again shortly.", loginFailed: "Unable to sign in. Please try again.", privacy: "Encrypted by TrackFleet · credentials are never visible to customers", google: "Continue with Google", or: "or", googleError: "Google sign-in failed. Please try again.", linkTitle: "Link your Google account", linkBody: (email: string) => `First time signing in with ${email}. Enter your SENDATRACK credentials once to link this Google account -- next time, one click will be enough.`, linkSubmit: "Link and continue", linkCancel: "Use a different login" },
    nl: { eyebrow: "BEDRIJFSPORTAAL", title: "Koppel uw SENDATRACK-wagenpark", body: "Gebruik dezelfde gegevens als in de SENDATRACK-app. Uw TrackFleet-ruimte wordt automatisch herkend.", account: "Account", accountPlaceholder: "SENDATRACK-account", user: "Gebruiker", userPlaceholder: "Gebruiker", password: "Wachtwoord", remember: "Mijn account en gebruiker op dit toestel onthouden", submit: "TrackFleet openen", loading: "Verbinden…", invalidCredentials: "Onjuiste SENDATRACK-gegevens.", serviceUnavailable: "SENDATRACK is tijdelijk niet beschikbaar. Probeer het zo opnieuw.", loginFailed: "Aanmelden mislukt. Probeer opnieuw.", privacy: "Versleuteld door TrackFleet · nooit zichtbaar voor klanten", google: "Doorgaan met Google", or: "of", googleError: "Aanmelden met Google mislukt. Probeer opnieuw.", linkTitle: "Koppel uw Google-account", linkBody: (email: string) => `Eerste keer aanmelden met ${email}. Voer eenmalig uw SENDATRACK-gegevens in om dit Google-account te koppelen -- de volgende keer volstaat één klik.`, linkSubmit: "Koppelen en doorgaan", linkCancel: "Andere inloggegevens gebruiken" },
  }[locale];
  // LoginScreen only ever renders once the client-side session check has
  // resolved to "anonymous" (see authState), so it's never part of the
  // server-rendered HTML -- safe to read localStorage directly here.
  const remembered = readRememberedLogin();
  return <main className="login-page">
    <header className="login-header"><span className="brand brand-dark"><span className="brand-mark"><span>↗</span></span><span>TrackFleet</span></span><LanguageSwitcher locale={locale} label="Language" onChange={onLocale} /></header>
    <section className="login-layout">
      <div className="login-story"><p className="eyebrow">{copy.eyebrow}</p><h1>{copy.title}</h1><p>{copy.body}</p><div className="login-route"><span>BE</span><i /><b>↗</b><i /><span>MA</span></div><small>Belgique · France · Espagne · Maroc</small></div>
      {googleLink ? <form className="login-card" onSubmit={onGoogleLinkSubmit}>
        <div className="login-provider"><span>⌖</span><div><strong>{copy.linkTitle}</strong><small>{googleLink.email}</small></div></div>
        <p>{copy.linkBody(googleLink.email)}</p>
        <label>{copy.account}<input name="accountID" autoComplete="organization" required placeholder={copy.accountPlaceholder} defaultValue={remembered?.accountID ?? ""} /></label>
        <label>{copy.user}<input name="user" autoComplete="username" required placeholder={copy.userPlaceholder} defaultValue={remembered?.user ?? ""} /></label>
        <label>{copy.password}<input name="password" type="password" autoComplete="current-password" required placeholder="••••••••" /></label>
        {googleLinkError && <p className="login-error" role="alert">{googleLinkError === "invalid_credentials" ? copy.invalidCredentials : googleLinkError === "service_unavailable" ? copy.serviceUnavailable : copy.loginFailed}</p>}
        <button className="login-submit" disabled={googleLinkBusy}>{googleLinkBusy ? copy.loading : copy.linkSubmit}<span>→</span></button>
        <button type="button" className="login-google-cancel" onClick={onGoogleLinkCancel}>{copy.linkCancel}</button>
      </form> : <form className="login-card" onSubmit={onSubmit}>
        <div className="login-provider"><span>⌖</span><div><strong>SENDATRACK</strong><small>GPS fleet connection</small></div></div>
        <a className="login-google" href="/api/auth/google/start">{copy.google}</a>
        <div className="login-divider"><span>{copy.or}</span></div>
        <label>{copy.account}<input name="accountID" autoComplete="organization" required placeholder={copy.accountPlaceholder} defaultValue={remembered?.accountID ?? ""} /></label>
        <label>{copy.user}<input name="user" autoComplete="username" required placeholder={copy.userPlaceholder} defaultValue={remembered?.user ?? ""} /></label>
        <label>{copy.password}<input name="password" type="password" autoComplete="current-password" required placeholder="••••••••" /></label>
        <label className="consent-choice"><input type="checkbox" name="rememberLogin" defaultChecked /><span>{copy.remember}</span></label>
        {googleError && <p className="login-error" role="alert">{copy.googleError}</p>}
        {error && <p className="login-error" role="alert">{error === "invalid_credentials" ? copy.invalidCredentials : error === "service_unavailable" ? copy.serviceUnavailable : copy.loginFailed}</p>}
        <button className="login-submit" disabled={busy}>{busy ? copy.loading : copy.submit}<span>→</span></button>
        <p className="login-privacy">⌁ {copy.privacy}</p>
      </form>}
    </section>
  </main>;
}

function SubscribeScreen({ locale, busy, completing, unavailable, interval, onIntervalChange, onSubscribe, onLogout }: {
  locale: Locale;
  busy: "standard" | "pro" | null;
  completing: boolean;
  unavailable: boolean;
  interval: "monthly" | "yearly";
  onIntervalChange: (interval: "monthly" | "yearly") => void;
  onSubscribe: (plan: "standard" | "pro") => void;
  onLogout: () => void;
}) {
  const copy = {
    fr: {
      title: "Abonnement requis", subtitle: "Votre accès TrackFleet n’est plus actif.",
      monthly: "Mensuel", yearly: "Annuel",
      standardName: "Standard", standardDesc: "Suivi GPS et notifications de livraison en temps réel.",
      proName: "Pro", proDesc: "Standard, plus les notifications WhatsApp automatiques pour vos clients.",
      subscribe: "S’abonner", opening: "Ouverture…",
      unavailable: "Abonnement indisponible pour le moment. Contactez-nous directement.",
      logout: "Se déconnecter", perMonth: "/mois", perYear: "/an",
      completingTitle: "Activation de votre abonnement…",
      completingBody: "Paiement reçu. Cela ne prend généralement que quelques secondes.",
    },
    en: {
      title: "Subscription required", subtitle: "Your TrackFleet access is no longer active.",
      monthly: "Monthly", yearly: "Yearly",
      standardName: "Standard", standardDesc: "Real-time GPS tracking and delivery notifications.",
      proName: "Pro", proDesc: "Everything in Standard, plus automatic WhatsApp notifications for your customers.",
      subscribe: "Subscribe", opening: "Opening…",
      unavailable: "Subscribing isn't available right now. Please contact us directly.",
      logout: "Log out", perMonth: "/mo", perYear: "/yr",
      completingTitle: "Activating your subscription…",
      completingBody: "Payment received. This usually only takes a few seconds.",
    },
    nl: {
      title: "Abonnement vereist", subtitle: "Uw TrackFleet-toegang is niet meer actief.",
      monthly: "Maandelijks", yearly: "Jaarlijks",
      standardName: "Standard", standardDesc: "Live GPS-tracking en leveringsmeldingen.",
      proName: "Pro", proDesc: "Alles van Standard, plus automatische WhatsApp-meldingen voor uw klanten.",
      subscribe: "Abonneren", opening: "Openen…",
      unavailable: "Abonneren is momenteel niet beschikbaar. Neem rechtstreeks contact met ons op.",
      logout: "Afmelden", perMonth: "/mnd", perYear: "/jaar",
      completingTitle: "Uw abonnement wordt geactiveerd…",
      completingBody: "Betaling ontvangen. Dit duurt meestal maar een paar seconden.",
    },
  }[locale];
  const prices = {
    standard: { monthly: "€45", yearly: "€400" },
    pro: { monthly: "€90", yearly: "€800" },
  } as const;
  const suffix = interval === "monthly" ? copy.perMonth : copy.perYear;
  if (completing) {
    return <main className="login-page login-loading">
      <section className="tracking-error">
        <div className="brand brand-dark"><span className="brand-mark"><span>↗</span></span><span>TrackFleet</span></div>
        <h1>{copy.completingTitle}</h1>
        <p>{copy.completingBody}</p>
      </section>
    </main>;
  }
  return <main className="login-page login-loading">
    <section className="tracking-error plan-picker-screen">
      <div className="brand brand-dark"><span className="brand-mark"><span>↗</span></span><span>TrackFleet</span></div>
      <h1>{copy.title}</h1>
      <p>{copy.subtitle}</p>
      {unavailable && <p className="login-error" role="alert">{copy.unavailable}</p>}
      <div className="plan-interval-toggle" role="group">
        <button type="button" className={interval === "monthly" ? "active" : ""} onClick={() => onIntervalChange("monthly")}>{copy.monthly}</button>
        <button type="button" className={interval === "yearly" ? "active" : ""} onClick={() => onIntervalChange("yearly")}>{copy.yearly}</button>
      </div>
      <div className="plan-cards">
        <div className="plan-card">
          <h2>{copy.standardName}</h2>
          <p className="plan-price">{prices.standard[interval]}<span>{suffix}</span></p>
          <p className="plan-desc">{copy.standardDesc}</p>
          <button className="primary-button" disabled={busy !== null} onClick={() => onSubscribe("standard")}>{busy === "standard" ? copy.opening : copy.subscribe}</button>
        </div>
        <div className="plan-card plan-card-highlight">
          <h2>{copy.proName}</h2>
          <p className="plan-price">{prices.pro[interval]}<span>{suffix}</span></p>
          <p className="plan-desc">{copy.proDesc}</p>
          <button className="primary-button" disabled={busy !== null} onClick={() => onSubscribe("pro")}>{busy === "pro" ? copy.opening : copy.subscribe}</button>
        </div>
      </div>
      <button className="login-google-cancel" onClick={onLogout}>{copy.logout}</button>
    </section>
  </main>;
}

export default function Home() {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [selectedId, setSelectedId] = useState("");
  // A live GPS vehicle with no delivery currently riding it -- selected
  // independently of selectedId so every truck on the map stays clickable,
  // not just ones with an active delivery (reported live as a dead end:
  // clicking an idle truck did nothing).
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [view, setView] = useState<"dispatch" | "customer">("dispatch");
  const [modalOpen, setModalOpen] = useState(false);
  const [demoModalOpen, setDemoModalOpen] = useState(false);
  const [demoContact, setDemoContact] = useState("");
  const [demoDestinationSiteId, setDemoDestinationSiteId] = useState("");
  const [demoBusy, setDemoBusy] = useState(false);
  // Tracks the most recently created demo delivery so the walkthrough panel
  // (departure/advance/arrival buttons) stays visible right after creation --
  // requested live to demo the full lifecycle to a prospective client in one
  // sitting, instead of just the static [DEMO] row the modal used to leave
  // behind with no way to move it forward.
  const [demoActiveDeliveryId, setDemoActiveDeliveryId] = useState<string | null>(null);
  const [demoAdvancePending, setDemoAdvancePending] = useState(false);
  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null);
  const [companySettingsOpen, setCompanySettingsOpen] = useState(false);
  const [companySettingsName, setCompanySettingsName] = useState("");
  const [companySettingsColor, setCompanySettingsColor] = useState("#c1272d");
  const [companySettingsLogoDataUrl, setCompanySettingsLogoDataUrl] = useState<string | null>(null);
  // Empty string means "no override, inherit the deploy-wide default" --
  // same convention as the branding fields above (blank name/color/logo
  // keeps the TrackFleet default). Only a non-empty value becomes a stored
  // per-company override on save.
  const [companySettingsUnloadGraceMinutes, setCompanySettingsUnloadGraceMinutes] = useState("");
  const [companySettingsCtmRelayGraceHours, setCompanySettingsCtmRelayGraceHours] = useState("");
  const [companySettingsCtmRelayAutoEnabled, setCompanySettingsCtmRelayAutoEnabled] = useState(true);
  // If the fetch inside openCompanySettings fails, the three fields above
  // stay at their blank/default placeholders without actually reflecting
  // whatever overrides (if any) are stored server-side. Saving in that state
  // must not send the automation-settings request at all -- otherwise a
  // dispatcher who only meant to change the branding color would silently
  // wipe an existing grace-period override they never got to see.
  const [companySettingsAutomationLoadFailed, setCompanySettingsAutomationLoadFailed] = useState(false);
  const [companySettingsSaving, setCompanySettingsSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [filter, setFilter] = useState("All deliveries");
  const [searchQuery, setSearchQuery] = useState("");
  const [openContactPopover, setOpenContactPopover] = useState<string | null>(null);
  const [selectedForLabels, setSelectedForLabels] = useState<Set<string>>(new Set());
  // Arrival/departure times are a property of the truck's run, not of any
  // one parcel on it -- editing them per row was the same redundancy the
  // destination/ETA/progress hoisting above already solved, just left over
  // for the two schedule fields. Only offered at the group level when the
  // group actually has one shared destination (group.uniformDestination) --
  // a truck relaying to several different destinations still needs each
  // leg's schedule edited on its own row, same as ETA/progress there.
  const [groupScheduleEditorLabel, setGroupScheduleEditorLabel] = useState<string | null>(null);
  const [groupScheduleNextDeparture, setGroupScheduleNextDeparture] = useState("");
  const [groupSchedulePending, setGroupSchedulePending] = useState(false);
  const [groupTruckEditorLabel, setGroupTruckEditorLabel] = useState<string | null>(null);
  const [groupTruckEditorSelection, setGroupTruckEditorSelection] = useState("");
  const [groupTruckEditorPending, setGroupTruckEditorPending] = useState(false);
  const [groupDeparturePending, setGroupDeparturePending] = useState<string | null>(null);
  const [groupArrivalPending, setGroupArrivalPending] = useState<string | null>(null);
  const [showPopover, setShowPopover] = useState(true);
  const [creating, setCreating] = useState(false);
  const [whatsAppBusy, setWhatsAppBusy] = useState<"tracking" | "arrival" | null>(null);
  const [locale, setLocale] = useState<Locale>("fr");
  const [authState, setAuthState] = useState<"loading" | "anonymous" | "authenticated">("loading");
  const [dispatchDataState, setDispatchDataState] = useState<"loading" | "ready" | "error" | "subscription_required">("loading");
  const [company, setCompany] = useState<CompanyIdentity | null>(null);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState<LoginErrorKind | "">("");
  // Set once, right after the Google OAuth callback redirects back here with
  // a first-time Google identity that isn't linked to a company yet -- the
  // pending-link token carries that verified identity, so the one-time
  // SENDATRACK-credential form below only has to establish the link, not
  // re-verify the Google side of it.
  const [googleLink, setGoogleLink] = useState<{ token: string; email: string } | null>(null);
  const [googleLinkBusy, setGoogleLinkBusy] = useState(false);
  const [googleLinkError, setGoogleLinkError] = useState<LoginErrorKind | "">("");
  const [googleError, setGoogleError] = useState(false);
  const [checkoutBusy, setCheckoutBusy] = useState<"standard" | "pro" | null>(null);
  const [checkoutUnavailable, setCheckoutUnavailable] = useState(false);
  const [checkoutInterval, setCheckoutInterval] = useState<"monthly" | "yearly">("yearly");
  const [checkoutCompleting, setCheckoutCompleting] = useState(false);
  const [publicTrackingState, setPublicTrackingState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [integration, setIntegration] = useState<IntegrationState>({ configured: false, connected: false, vehicleCount: 0, error: null, vehicles: [] });
  const [features, setFeatures] = useState<FeatureState>({ whatsappDemoEnabled: false, whatsappAvailable: false });
  const [companyBranding, setCompanyBranding] = useState<CompanyBranding>(emptyCompanyBranding);
  const [trips, setTrips] = useState<TripHistoryItem[]>([]);
  // Keyed by destinationSiteId -- the same learned per-agency transit
  // duration estimateRelayArrival uses server-side (see relay-eta-estimate.ts),
  // fetched here so the creation form and schedule editor can preview the
  // real value instead of always showing the fixed 6d/12d fallback.
  const [departureArrivalEstimates, setDepartureArrivalEstimates] = useState<Record<string, { medianHours: number; sampleCount: number }>>({});
  const [deliveryEvents, setDeliveryEvents] = useState<DeliveryEventRow[]>([]);
  const [knownSites, setKnownSites] = useState<KnownSite[]>([]);
  const [defaultOriginSiteId, setDefaultOriginSiteId] = useState("");
  const [creationVehicleId, setCreationVehicleId] = useState("");
  const [creationDestinationSiteId, setCreationDestinationSiteId] = useState("");
  const [creationDepartureAt, setCreationDepartureAt] = useState("");
  // A client can hand over several parcels at once -- each row becomes its
  // own delivery (own TF-id, own tracking, own weight/price) so per-parcel
  // tracking/pricing/WhatsApp notifications keep working exactly as before;
  // the rows are just submitted together and linked by one shipmentId.
  const [parcelDrafts, setParcelDrafts] = useState<Array<{ key: string; weightKg: string; manualPriceAmount: string; itemDescription: string }>>([{ key: "0", weightKg: "", manualPriceAmount: "", itemDescription: "" }]);
  const creationFormRef = useRef<HTMLFormElement>(null);
  // Seeds the uncontrolled text inputs' defaultValue/defaultChecked on the
  // form's next mount (openCreateModal sets this in the same batch as
  // setModalOpen(true), so it's already correct on first render) -- these
  // fields have no per-keystroke state of their own, so restoring a draft
  // into them can only happen at mount time, not via a controlled value.
  const [creationDraftSeed, setCreationDraftSeed] = useState<{
    customer: string; contact: string; customerEmail: string;
    recipientName: string; recipientContact: string; whatsappOptIn: boolean;
  } | null>(null);
  // Non-null when the same modal/form is open to edit an existing delivery
  // instead of creating a new one -- reuses every field of the creation
  // form (see openEditModal), but submits to /api/deliveries/update (plus
  // link-vehicle/update-schedule for truck/departure, only if those
  // actually changed) instead of POST /api/deliveries. truckId/departureAt
  // are the delivery's values as of opening the editor, so the submit
  // handler can tell whether the dispatcher actually touched them.
  const [editingDeliveryId, setEditingDeliveryId] = useState<string | null>(null);
  const [editingOriginal, setEditingOriginal] = useState<{ truckId: string; departureAt: string } | null>(null);
  // Closing without submitting (× or Cancel) used to silently wipe every
  // field the dispatcher had typed -- a multi-parcel form can take a while
  // to fill in, and an accidental close (or a reload before submitting)
  // shouldn't cost that work. Saves the current form state as a draft
  // instead of resetting it; a real submit clears the draft in createDelivery.
  // Defined here (rather than near openCreateModal/createDelivery further
  // down) because the Escape-key effect below needs it and, as a `const`,
  // it isn't hoisted the way a function declaration would be.
  const closeCreateModal = useCallback(() => {
    // Editing an existing delivery isn't a "draft" the way an in-progress
    // new delivery is -- the original data is already safely stored, so
    // abandoning an edit should just discard it, not write it into (or
    // clobber) the separate new-delivery draft slot.
    if (company && !editingDeliveryId) {
      const formData = creationFormRef.current ? new FormData(creationFormRef.current) : null;
      const draft: DeliveryCreationDraft = {
        destinationSiteId: creationDestinationSiteId,
        departureAt: creationDepartureAt,
        vehicleId: creationVehicleId,
        parcels: parcelDrafts,
        customer: String(formData?.get("customer") ?? ""),
        contact: String(formData?.get("contact") ?? ""),
        customerEmail: String(formData?.get("customerEmail") ?? ""),
        recipientName: String(formData?.get("recipientName") ?? ""),
        recipientContact: String(formData?.get("recipientContact") ?? ""),
        whatsappOptIn: formData?.get("whatsappOptIn") === "on",
      };
      const key = deliveryCreationDraftKey(company);
      if (isMeaningfulDeliveryCreationDraft(draft)) window.localStorage.setItem(key, JSON.stringify(draft));
      else window.localStorage.removeItem(key);
    }
    setModalOpen(false);
    setEditingDeliveryId(null);
    setEditingOriginal(null);
    setParcelDrafts([{ key: "0", weightKg: "", manualPriceAmount: "", itemDescription: "" }]);
    setCreationDestinationSiteId("");
    setCreationDepartureAt("");
    setCreationDraftSeed(null);
  }, [company, editingDeliveryId, creationDestinationSiteId, creationDepartureAt, creationVehicleId, parcelDrafts]);

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
    const searchParams = new URLSearchParams(window.location.search);
    const pendingToken = searchParams.get("google_link");
    const pendingEmail = searchParams.get("google_email");
    const hadGoogleError = searchParams.get("google_error");
    if (pendingToken && pendingEmail) setGoogleLink({ token: pendingToken, email: pendingEmail });
    if (hadGoogleError) setGoogleError(true);
    if (pendingToken || pendingEmail || hadGoogleError) {
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete("google_link");
      cleanUrl.searchParams.delete("google_email");
      cleanUrl.searchParams.delete("google_error");
      window.history.replaceState({}, "", cleanUrl);
    }
  }, []);

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
    if (authState !== "authenticated") return;
    let active = true;
    async function refreshBranding() {
      try {
        const response = await fetch("/api/company/branding", { cache: "no-store" });
        const data = response.ok ? await response.json() as { branding?: CompanyBranding } : { branding: emptyCompanyBranding };
        if (active) setCompanyBranding(data.branding ?? emptyCompanyBranding);
      } catch {
        if (active) setCompanyBranding(emptyCompanyBranding);
      }
    }
    void refreshBranding();
    const handleBrandingChanged = () => void refreshBranding();
    window.addEventListener("trackfleet-branding-changed", handleBrandingChanged);
    return () => { active = false; window.removeEventListener("trackfleet-branding-changed", handleBrandingChanged); };
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
    if (!groupScheduleEditorLabel) return;
    const close = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".group-schedule-editor-popover, .group-schedule-editor-trigger")) return;
      setGroupScheduleEditorLabel(null);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [groupScheduleEditorLabel]);

  useEffect(() => {
    if (!groupTruckEditorLabel) return;
    const close = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".group-truck-editor-popover, .group-truck-editor-trigger")) return;
      setGroupTruckEditorLabel(null);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [groupTruckEditorLabel]);

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
        // SENDATRACK payload normalization and the delivery dashboard used to
        // share one Cloudflare invocation. Splitting them gives each request
        // its own CPU budget; a fleet-provider failure also no longer blanks
        // otherwise healthy persisted delivery data.
        const integrationRequest = tracking
          ? null
          : fetch("/api/sendatrack", { cache: "no-store" }).catch(() => null);
        const response = await fetch(endpoint, { cache: "no-store" });
        if (response.status === 402 && !tracking) {
          if (active) setDispatchDataState("subscription_required");
          return;
        }
        if (!response.ok) throw new Error("Delivery service unavailable");
        const data = await response.json() as { deliveries: Delivery[]; integration?: IntegrationState; features?: FeatureState; events?: DeliveryEventRow[]; trips?: TripHistoryItem[]; companyBranding?: CompanyBranding; departureArrivalEstimates?: Record<string, { medianHours: number; sampleCount: number }> };
        if (!active) return;
        if (tracking && data.deliveries.length) {
          setDeliveries(data.deliveries);
          setDeliveryEvents(data.events ?? []);
          setSelectedId(data.deliveries[0].id);
          setPublicTrackingState("ready");
          if (data.companyBranding) setCompanyBranding(data.companyBranding);
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
        if (data.features) setFeatures(data.features);
        if (!tracking) setTrips(data.trips ?? []);
        if (!tracking) setDepartureArrivalEstimates(data.departureArrivalEstimates ?? {});
        const integrationResponse = await integrationRequest;
        if (integrationResponse?.ok) {
          const liveIntegration = await integrationResponse.json() as IntegrationState;
          if (active) setIntegration(liveIntegration);
        }
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
      if (event.key === "Escape" && modalOpen) closeCreateModal();
    }
    window.addEventListener("keydown", closeModalWithEscape);
    return () => window.removeEventListener("keydown", closeModalWithEscape);
  }, [modalOpen, closeCreateModal]);

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
  // refer to a vehicle out loud or at a glance). Assignments accumulate in
  // state and are never reassigned or shifted once given -- reported live:
  // recomputing every vehicle's number fresh from whichever ids happen to
  // be in the CURRENT poll (sorted-index based) meant one vehicle briefly
  // dropping out of SENDATRACK's live feed (a GPS gap) shifted every
  // subsequent vehicle's number down, so a different truck would suddenly
  // show the same "Camion N" badge (and color, since that's derived from
  // the number) that another truck had a moment earlier. Updated from an
  // effect (not computed during render) since mutating/reading accumulated
  // state must happen outside render for React to track it correctly.
  const [vehicleTruckNumbers, setVehicleTruckNumbers] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    setVehicleTruckNumbers((current) => {
      const newIds = integration.vehicles
        .map((vehicle) => vehicle.id)
        .filter((id) => !current.has(id))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      if (newIds.length === 0) return current;
      const next = new Map(current);
      let nextNumber = current.size > 0 ? Math.max(...current.values()) + 1 : 1;
      for (const id of newIds) {
        next.set(id, nextNumber);
        nextNumber += 1;
      }
      return next;
    });
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
  const scanAtLabel = (value?: string | null) => value
    ? new Date(value).toLocaleString(locale === "fr" ? "fr-BE" : locale === "nl" ? "nl-BE" : "en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
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
  const creationDepartureDate = creationDepartureAt ? new Date(creationDepartureAt) : null;
  const creationEstimatedArrival = creationDepartureDate && !Number.isNaN(creationDepartureDate.getTime())
    ? estimateRelayArrival(creationDestinationSiteId, creationDepartureDate, departureArrivalEstimates[creationDestinationSiteId])
    : null;
  const demoDelivery = demoActiveDeliveryId ? deliveries.find((item) => item.id === demoActiveDeliveryId) ?? null : null;
  // A truck already out on another active (non-Delivered) delivery is
  // flagged when reassigning a different delivery to it from the table --
  // doesn't block (the dispatcher may already know it's back), just warns.
  const vehicleAssignmentConflict = (vehicleId: string, excludeDeliveryId: string) =>
    deliveries.find((delivery) => delivery.id !== excludeDeliveryId && delivery.sendatrackVehicleId === vehicleId && delivery.status !== "Delivered");
  // A brand-new delivery captures the assigned truck's live GPS position as its
  // own starting baseline, so picking a truck that's already "In transit" makes
  // the delivery start already-partway instead of at 0%/Chargement. Correct for
  // a genuine mid-route pickup, but surprising for a test delivery -- warn instead
  // of silently changing that behavior.
  const vehicleCurrentlyEnRoute = (vehicleId: string) =>
    deliveries.find((delivery) => delivery.sendatrackVehicleId === vehicleId && delivery.status === "In transit");
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
        // Status/destination/ETA/progress are all derived from the same
        // truck GPS position + destination, so when a group has more than
        // one parcel and they all share one destination and status, those
        // values are identical too -- repeating them on every row was the
        // same redundancy the departure-date label had. Hoisted into the
        // group header instead, using any one delivery as the
        // representative (they're all equal by definition here). Status is
        // included in the uniformity check (not just destination) because a
        // dispatcher can manually complete one parcel of a group ahead of
        // its truck-mates -- if that happens this group must fall back to
        // full per-row display, the same as a truck relaying to several
        // different destinations, since the rows have genuinely diverged
        // and hoisting one shared status would misrepresent the other.
        const firstDestination = group.deliveries[0]?.destination || null;
        const firstStatus = group.deliveries[0]?.status ?? null;
        const uniformDestination = group.deliveries.length > 1
          && firstDestination
          && group.deliveries.every((delivery) => delivery.destination === firstDestination && delivery.status === firstStatus)
          ? group.deliveries[0]
          : null;
        // Same idea as uniformDestination, but for the origin: a truck run
        // departs from exactly one place, so this is essentially always
        // uniform (unlike the destination, which genuinely varies on a
        // multi-agency relay run) -- reported live as a whole Agence column
        // of nothing but "—" once the destination/status split reclaimed
        // its width, so it was dropped as a dedicated column entirely
        // rather than left mostly-empty. Origin now only ever appears
        // hoisted in the group header; still verified rather than assumed,
        // so a theoretical mixed-origin group just shows nothing here
        // instead of a wrong value (still visible per-parcel via the edit
        // form).
        const firstOriginSiteId = group.deliveries[0]?.originSiteId ?? null;
        const uniformOrigin = group.deliveries.length > 1
          && firstOriginSiteId
          && group.deliveries.every((delivery) => delivery.originSiteId === firstOriginSiteId)
          ? firstOriginSiteId
          : null;
        // A truck can relay to several different agencies on the same run,
        // so "the truck arrived" isn't one fact about the whole group -- it
        // arrived AT one of those agencies. Confirming arrival is scoped to
        // whichever agency actually applies instead of marking every parcel
        // on the truck delivered at once, regardless of its destination.
        const destinationSubgroups: { destination: string; deliveries: Delivery[] }[] = Array.from(
          group.deliveries.reduce((map, delivery) => {
            const key = delivery.destination || "";
            if (!map.has(key)) map.set(key, []);
            map.get(key)!.push(delivery);
            return map;
          }, new Map<string, Delivery[]>()),
        ).map(([destination, deliveries]) => ({ destination, deliveries }));
        return { ...group, uniformDestination, uniformOrigin, destinationSubgroups };
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
  // A Delivered delivery's latitude/longitude are frozen forever the moment
  // it completes (applySendatrackSnapshot only updates status <> 'Delivered'
  // rows) -- typically wherever the truck was at that instant, near its
  // destination. Without this exclusion the map kept showing that stale,
  // months-old position forever, AND (via InteractiveFleetMap's
  // linkedVehicleIds) permanently suppressed the same physical truck's real,
  // live position once it moved on to other work -- reported live as trucks
  // rendering hundreds of km from where they actually are.
  const mapDeliveries = (integration.connected
    ? deliveries.filter((delivery) => delivery.gpsSource === "sendatrack")
    : deliveries
  ).filter((delivery) => delivery.status !== "Delivered");
  // Dispatcher-only: which country the cargo is coming from/going to, and
  // this truck's own color (matching its "Camion N" badge everywhere else).
  // Not part of the customer-facing map -- originSiteId/destinationSiteId
  // aren't in the public tracking allowlist (see public-delivery-view.ts),
  // so this can't and shouldn't reach that view.
  const mapDeliveriesWithOrigin = mapDeliveries.map((delivery) => {
    const truckNumber = delivery.sendatrackVehicleId ? vehicleTruckNumbers.get(delivery.sendatrackVehicleId) ?? null : null;
    return {
      ...delivery,
      originCountry: knownSites.find((site) => site.id === delivery.originSiteId)?.country ?? null,
      destinationCountry: knownSites.find((site) => site.id === delivery.destinationSiteId)?.country ?? null,
      truckNumber,
      truckColor: truckNumber != null ? truckBadgeColor(truckNumber) : null,
    };
  });
  const liveVehiclesWithNumbers = integration.vehicles.map((vehicle) => {
    const truckNumber = vehicleTruckNumbers.get(vehicle.id) ?? null;
    return { ...vehicle, truckNumber, truckColor: truckNumber != null ? truckBadgeColor(truckNumber) : null };
  });
  const selectedVehicle = selectedVehicleId ? liveVehiclesWithNumbers.find((vehicle) => vehicle.id === selectedVehicleId) ?? null : null;
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

  // datetime-local inputs need "YYYY-MM-DDTHH:mm" in the browser's local
  // time, not the ISO string's UTC representation.
  function toDatetimeLocalValue(iso: string | null | undefined) {
    if (!iso) return "";
    const date = new Date(iso);
    if (!Number.isFinite(date.getTime())) return "";
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  // Same /api/deliveries/update-schedule endpoint saveDeliveryEdits calls
  // for one delivery at a time, one call per parcel in the truck's group --
  // there's no bulk update-schedule endpoint, and adding one for what's
  // still a handful of parcels per truck isn't worth the extra API surface
  // yet.
  async function updateGroupSchedule(deliveryIds: string[], plannedArrivalAt: string, nextTruckDepartureAt: string) {
    setGroupSchedulePending(true);
    try {
      const results = await Promise.all(deliveryIds.map((deliveryId) => fetch("/api/deliveries/update-schedule", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          deliveryId,
          plannedArrivalAt: plannedArrivalAt ? new Date(plannedArrivalAt).toISOString() : "",
          nextTruckDepartureAt: nextTruckDepartureAt ? new Date(nextTruckDepartureAt).toISOString() : "",
        }),
      }).then((response) => response.json() as Promise<{ delivery?: Delivery; error?: string }>)));
      const updated = results.map((result) => result.delivery).filter((delivery): delivery is Delivery => Boolean(delivery));
      if (!updated.length) {
        setToast(locale === "fr" ? "Impossible de mettre à jour les dates" : locale === "nl" ? "Kon de data niet bijwerken" : "Couldn't update the dates");
        return;
      }
      setDeliveries((items) => items.map((item) => updated.find((delivery) => delivery.id === item.id) ?? item));
      setGroupScheduleEditorLabel(null);
      setToast(locale === "fr" ? "Dates mises à jour" : locale === "nl" ? "Data bijgewerkt" : "Dates updated");
    } catch {
      setToast(locale === "fr" ? "Impossible de mettre à jour les dates" : locale === "nl" ? "Kon de data niet bijwerken" : "Couldn't update the dates");
    } finally {
      setGroupSchedulePending(false);
    }
  }

  // Unlike updateGroupSchedule above, this can't just loop the single-id
  // endpoint once per parcel -- link-vehicle's own "unassign this vehicle
  // from any OTHER delivery that currently holds it" safety guard only
  // excludes the one delivery being linked, so each call in a loop would
  // strip the vehicle right back off the parcel(s) the previous call(s) in
  // the same group just assigned it to. The server does the whole group as
  // one atomic operation instead (see linkVehicleToGroup).
  async function reassignTruckForGroup(deliveryIds: string[], vehicleId: string) {
    setGroupTruckEditorPending(true);
    try {
      const response = await fetch("/api/deliveries/link-vehicle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deliveryIds, vehicleId }),
      });
      const data = (await response.json()) as { deliveries?: Delivery[]; error?: string };
      if (!response.ok || !data.deliveries?.length) {
        setToast(data.error || (locale === "fr" ? "Impossible de changer le camion" : locale === "nl" ? "Kon het voertuig niet wijzigen" : "Couldn't change the truck"));
        return;
      }
      const updated = data.deliveries;
      setDeliveries((items) => items.map((item) => updated.find((delivery) => delivery.id === item.id) ?? item));
      setGroupTruckEditorLabel(null);
      setGroupTruckEditorSelection("");
      setToast(locale === "fr" ? "Camion mis à jour" : locale === "nl" ? "Voertuig bijgewerkt" : "Truck updated");
    } catch {
      setToast(locale === "fr" ? "Impossible de changer le camion" : locale === "nl" ? "Kon het voertuig niet wijzigen" : "Couldn't change the truck");
    } finally {
      setGroupTruckEditorPending(false);
    }
  }

  // Moved here from a per-delivery popover button -- confirming departure
  // for a whole truck's group at once, mirroring how truck reassignment and
  // schedule edits already operate at the group level rather than one
  // parcel at a time. Bundles the status confirmation with an automatic
  // WhatsApp notice for each parcel (the same free, customer-service-window
  // freeform reply "Notifier par WhatsApp" already used elsewhere -- not
  // the paid, still-disabled automatic template push), since the whole
  // point of confirming here is to also tell the customer.
  async function confirmGroupDeparture(label: string, deliveryIds: string[]) {
    if (company?.role !== "dispatcher" || !deliveryIds.length) return;
    const confirmation = locale === "fr"
      ? `Confirmer le départ pour ${deliveryIds.length} colis, et notifier les clients par WhatsApp ?`
      : locale === "nl"
        ? `Vertrek bevestigen voor ${deliveryIds.length} pakketten, en klanten via WhatsApp op de hoogte brengen?`
        : `Confirm departure for ${deliveryIds.length} parcels, and notify customers via WhatsApp?`;
    if (!window.confirm(confirmation)) return;
    setGroupDeparturePending(label);
    try {
      const results = await Promise.all(deliveryIds.map((deliveryId) => fetch("/api/deliveries/manual-completion", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deliveryId, confirmDeparture: true }),
      }).then((response) => response.json() as Promise<{ delivery?: Delivery; error?: string }>)));
      const updated = results.map((result) => result.delivery).filter((delivery): delivery is Delivery => Boolean(delivery));
      if (!updated.length) {
        setToast(locale === "fr" ? "Impossible de confirmer le départ" : locale === "nl" ? "Vertrek kon niet worden bevestigd" : "Couldn't confirm departure");
        return;
      }
      setDeliveries((items) => items.map((item) => updated.find((delivery) => delivery.id === item.id) ?? item));
      const notifyResults = await Promise.all(updated.map((delivery) => fetch("/api/deliveries/notify-departure", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deliveryId: delivery.id }),
      }).then((response) => response.json() as Promise<{ ok?: boolean }>).catch(() => ({ ok: false }))));
      const anyNotified = notifyResults.some((result) => result.ok);
      setToast(anyNotified
        ? (locale === "fr" ? "Départ confirmé, client(s) notifié(s) par WhatsApp" : locale === "nl" ? "Vertrek bevestigd, klant(en) via WhatsApp op de hoogte gebracht" : "Departure confirmed, customer(s) notified via WhatsApp")
        : (locale === "fr" ? "Départ confirmé (WhatsApp non envoyé : fenêtre 24h fermée ou consentement retiré)" : locale === "nl" ? "Vertrek bevestigd (WhatsApp niet verzonden: 24u-venster gesloten of toestemming ingetrokken)" : "Departure confirmed (WhatsApp not sent: 24h window closed or consent withdrawn)"));
    } catch {
      setToast(locale === "fr" ? "Impossible de confirmer le départ" : locale === "nl" ? "Vertrek kon niet worden bevestigd" : "Couldn't confirm departure");
    } finally {
      setGroupDeparturePending(null);
    }
  }

  // Mirrors confirmGroupDeparture above, for the other end of the trip.
  // Available to both roles like the existing confirmArrival action: the
  // dispatcher for any group, an agency only for its own destination site's
  // (the dashboard already scopes an agency's own deliveries list to their
  // site, so no extra filtering is needed here).
  async function confirmGroupArrival(label: string, deliveryIds: string[]) {
    if (!company || !deliveryIds.length) return;
    const confirmation = locale === "fr"
      ? `Confirmer l'arrivée pour ${deliveryIds.length} colis, et notifier les clients par WhatsApp ?`
      : locale === "nl"
        ? `Aankomst bevestigen voor ${deliveryIds.length} pakketten, en klanten via WhatsApp op de hoogte brengen?`
        : `Confirm arrival for ${deliveryIds.length} parcels, and notify customers via WhatsApp?`;
    if (!window.confirm(confirmation)) return;
    setGroupArrivalPending(label);
    try {
      const results = await Promise.all(deliveryIds.map((deliveryId) => fetch("/api/deliveries/manual-completion", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deliveryId, confirmArrival: true }),
      }).then((response) => response.json() as Promise<{ delivery?: Delivery; error?: string }>)));
      const updated = results.map((result) => result.delivery).filter((delivery): delivery is Delivery => Boolean(delivery));
      if (!updated.length) {
        setToast(locale === "fr" ? "Impossible de confirmer l'arrivée" : locale === "nl" ? "Aankomst kon niet worden bevestigd" : "Couldn't confirm arrival");
        return;
      }
      setDeliveries((items) => items.map((item) => updated.find((delivery) => delivery.id === item.id) ?? item));
      const notifyResults = await Promise.all(updated.map((delivery) => fetch("/api/deliveries/notify-arrival", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deliveryId: delivery.id }),
      }).then((response) => response.json() as Promise<{ ok?: boolean }>).catch(() => ({ ok: false }))));
      const anyNotified = notifyResults.some((result) => result.ok);
      setToast(anyNotified
        ? (locale === "fr" ? "Arrivée confirmée, client(s) notifié(s) par WhatsApp" : locale === "nl" ? "Aankomst bevestigd, klant(en) via WhatsApp op de hoogte gebracht" : "Arrival confirmed, customer(s) notified via WhatsApp")
        : (locale === "fr" ? "Arrivée confirmée (WhatsApp non envoyé : fenêtre 24h fermée ou consentement retiré)" : locale === "nl" ? "Aankomst bevestigd (WhatsApp niet verzonden: 24u-venster gesloten of toestemming ingetrokken)" : "Arrival confirmed (WhatsApp not sent: 24h window closed or consent withdrawn)"));
    } catch {
      setToast(locale === "fr" ? "Impossible de confirmer l'arrivée" : locale === "nl" ? "Aankomst kon niet worden bevestigd" : "Couldn't confirm arrival");
    } finally {
      setGroupArrivalPending(null);
    }
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

  async function submitGoogleLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!googleLink) return;
    setGoogleLinkBusy(true);
    setGoogleLinkError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/google/link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pendingToken: googleLink.token,
          accountID: String(form.get("accountID") ?? ""),
          user: String(form.get("user") ?? ""),
          password: form.get("password"),
        }),
      });
      const data = await response.json() as { company?: CompanyIdentity; error?: string };
      if (!response.ok) {
        if (data.error === "google_link_expired") { setGoogleLink(null); setGoogleLinkError("login_failed"); return; }
        setGoogleLinkError(classifyLoginError(response.status, data.error));
        return;
      }
      if (!data.company) { setGoogleLinkError("login_failed"); return; }
      setGoogleLink(null);
      setCompany(data.company);
      setAuthState("authenticated");
    } catch {
      setGoogleLinkError("login_failed");
    } finally {
      setGoogleLinkBusy(false);
    }
  }

  // Paddle's own "checkout.completed" event fires client-side the moment
  // payment succeeds, but the subscription itself only actually activates
  // once the async webhook lands (app/api/webhooks/paddle/route.ts) --
  // polling here bridges that gap instead of reloading immediately into a
  // still-not-yet-updated paywall, which would look like the payment failed.
  async function waitForSubscriptionActivation() {
    setCheckoutCompleting(true);
    for (let attempt = 0; attempt < 15; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 2000));
      try {
        const response = await fetch("/api/deliveries", { cache: "no-store" });
        if (response.status !== 402) { window.location.reload(); return; }
      } catch {
        // Transient -- keep polling rather than giving up on one blip.
      }
    }
    // Paddle confirmed payment but the webhook still hasn't landed after
    // ~30s (rare). Leave the "activating" screen up rather than reloading
    // back into the paywall -- a later manual refresh picks it up once the
    // webhook catches up.
  }

  function handlePaddleEvent(event: { name: string }) {
    if (event.name === "checkout.completed") void waitForSubscriptionActivation();
  }

  async function startSubscriptionCheckout(plan: "standard" | "pro") {
    setCheckoutBusy(plan);
    setCheckoutUnavailable(false);
    try {
      const ready = await ensurePaddleReady(handlePaddleEvent);
      if (!ready || !window.Paddle) { setCheckoutUnavailable(true); return; }
      const response = await fetch("/api/subscription/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan, interval: checkoutInterval }),
      });
      const data = await response.json() as { transactionId?: string; error?: string };
      if (!response.ok || !data.transactionId) { setCheckoutUnavailable(true); return; }
      window.Paddle.Checkout.open({ transactionId: data.transactionId });
    } catch {
      setCheckoutUnavailable(true);
    } finally {
      setCheckoutBusy(null);
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

  // Pre-fills the truck picker with whatever this dispatcher last used to
  // create a delivery (see truck-preference.ts), falling back to unassigned
  // when nothing was saved yet or that truck isn't connected anymore.
  function openCreateModal() {
    setEditingDeliveryId(null);
    setEditingOriginal(null);
    // openEditModal below overrides defaultOriginSiteId to the edited
    // delivery's own origin (disabled in the form, view-only) -- restore
    // the dispatcher's actual remembered origin here so a "Nouvelle
    // livraison" right after closing an edit doesn't inherit it.
    if (company && company.role !== "agency") {
      const originIds = knownSites.filter((site) => site.roles.includes("origin")).map((site) => site.id);
      const saved = window.localStorage.getItem(originPreferenceKey(company));
      setDefaultOriginSiteId((current) => resolvePreferredOriginSite(saved, originIds, current));
    }
    // Don't silently re-default to a truck that's already en route on other
    // active work -- it hasn't returned to base, and nobody has confirmed
    // it's starting this delivery's leg. Falls back to unassigned instead
    // (same as a saved-but-disconnected truck), so picking that truck again
    // is always a conscious choice made by the dispatcher, not a remembered
    // default silently carried forward from the previous delivery. Scoped to
    // "In transit" only (matches vehicleCurrentlyEnRoute below) -- a truck
    // still "Loading" at origin is exactly the normal multi-parcel-per-truck
    // workflow and should keep defaulting to it.
    const busyVehicleIds = new Set(deliveries.filter((delivery) => delivery.status === "In transit" && delivery.sendatrackVehicleId).map((delivery) => delivery.sendatrackVehicleId));
    const preferredVehicleId = company
      ? resolvePreferredTruck(window.localStorage.getItem(truckPreferenceKey(company)), integration.vehicles.map((vehicle) => vehicle.id).filter((id) => !busyVehicleIds.has(id)))
      : "";
    let draft: DeliveryCreationDraft | null = null;
    if (company) {
      try {
        const raw = window.localStorage.getItem(deliveryCreationDraftKey(company));
        draft = raw ? (JSON.parse(raw) as DeliveryCreationDraft) : null;
      } catch {
        draft = null;
      }
    }
    if (draft) {
      setCreationDestinationSiteId(knownSites.some((site) => site.id === draft!.destinationSiteId) ? draft.destinationSiteId : "");
      setCreationDepartureAt(draft.departureAt);
      setParcelDrafts(draft.parcels.length ? draft.parcels : [{ key: "0", weightKg: "", manualPriceAmount: "", itemDescription: "" }]);
      setCreationVehicleId(draft.vehicleId && integration.vehicles.some((vehicle) => vehicle.id === draft!.vehicleId) ? draft.vehicleId : preferredVehicleId);
      setCreationDraftSeed({
        customer: draft.customer, contact: draft.contact, customerEmail: draft.customerEmail,
        recipientName: draft.recipientName, recipientContact: draft.recipientContact, whatsappOptIn: draft.whatsappOptIn,
      });
    } else {
      setCreationVehicleId(preferredVehicleId);
      setCreationDraftSeed(null);
    }
    setModalOpen(true);
  }

  // Reopens the same creation form pre-filled with an existing delivery's
  // values, in place of the old truck/departure-only popover -- editing a
  // parcel now goes through every field the creation form has, not just
  // those two. Origin isn't editable (shown disabled, for context only);
  // truck and departure keep using their own dedicated, already-hardened
  // endpoints (see saveDeliveryEdits) rather than folding into the new
  // /api/deliveries/update route.
  function openEditModal(delivery: Delivery) {
    if (delivery.status === "Delivered") return;
    setEditingDeliveryId(delivery.id);
    setEditingOriginal({ truckId: delivery.sendatrackVehicleId ?? "", departureAt: toDatetimeLocalValue(delivery.nextTruckDepartureAt) });
    setDefaultOriginSiteId(delivery.originSiteId ?? "");
    setCreationDestinationSiteId(delivery.destinationSiteId ?? "");
    setCreationDepartureAt(toDatetimeLocalValue(delivery.nextTruckDepartureAt));
    setCreationVehicleId(delivery.sendatrackVehicleId ?? "");
    setParcelDrafts([{
      key: "0",
      weightKg: delivery.weightKg != null ? String(delivery.weightKg) : "",
      manualPriceAmount: delivery.weightKg == null && delivery.priceAmount != null ? String(delivery.priceAmount) : "",
      itemDescription: delivery.itemDescription ?? "",
    }]);
    setCreationDraftSeed({
      customer: delivery.customer,
      contact: delivery.contact ?? "",
      customerEmail: delivery.customerEmail ?? "",
      recipientName: delivery.recipientName ?? "",
      recipientContact: delivery.recipientContact ?? "",
      whatsappOptIn: false,
    });
    setModalOpen(true);
  }

  async function saveDeliveryEdits(event: React.FormEvent<HTMLFormElement>, deliveryId: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parcel = parcelDrafts[0] ?? { weightKg: "", manualPriceAmount: "", itemDescription: "" };
    setCreating(true);
    try {
      const response = await fetch("/api/deliveries/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          deliveryId,
          customer: String(form.get("customer") ?? "").trim(),
          destinationSiteId: creationDestinationSiteId,
          contact: String(form.get("contact") ?? "").trim(),
          customerEmail: String(form.get("customerEmail") ?? "").trim(),
          recipientName: String(form.get("recipientName") ?? "").trim(),
          recipientContact: String(form.get("recipientContact") ?? "").trim(),
          weightKg: parcel.weightKg,
          manualPriceAmount: parcel.manualPriceAmount,
          itemDescription: parcel.itemDescription,
        }),
      });
      const data = await response.json() as { delivery?: Delivery; error?: string };
      if (!response.ok || !data.delivery) {
        setToast(data.error || (locale === "fr" ? "Impossible d’enregistrer les modifications" : locale === "nl" ? "Kon de wijzigingen niet opslaan" : "Could not save the changes"));
        return;
      }
      let latest = data.delivery;
      // Truck and departure date keep using their own dedicated routes
      // (already hardened against double-booking / trip drift), only
      // called when the dispatcher actually changed that field.
      if (editingOriginal && creationVehicleId && creationVehicleId !== editingOriginal.truckId) {
        const vehicleResponse = await fetch("/api/deliveries/link-vehicle", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ deliveryId, vehicleId: creationVehicleId }),
        });
        const vehicleData = await vehicleResponse.json() as { delivery?: Delivery };
        if (vehicleResponse.ok && vehicleData.delivery) latest = vehicleData.delivery;
      }
      if (editingOriginal && creationDepartureAt !== editingOriginal.departureAt) {
        const scheduleResponse = await fetch("/api/deliveries/update-schedule", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            deliveryId,
            plannedArrivalAt: "",
            nextTruckDepartureAt: creationDepartureAt ? new Date(creationDepartureAt).toISOString() : "",
          }),
        });
        const scheduleData = await scheduleResponse.json() as { delivery?: Delivery };
        if (scheduleResponse.ok && scheduleData.delivery) latest = scheduleData.delivery;
      }
      setDeliveries((items) => items.map((item) => item.id === latest.id ? latest : item));
      setModalOpen(false);
      setEditingDeliveryId(null);
      setEditingOriginal(null);
      setParcelDrafts([{ key: "0", weightKg: "", manualPriceAmount: "", itemDescription: "" }]);
      setCreationDestinationSiteId("");
      setCreationDepartureAt("");
      setCreationDraftSeed(null);
      setToast(locale === "fr" ? "Livraison mise à jour" : locale === "nl" ? "Zending bijgewerkt" : "Delivery updated");
    } catch {
      setToast(locale === "fr" ? "Impossible d’enregistrer les modifications" : locale === "nl" ? "Kon de wijzigingen niet opslaan" : "Could not save the changes");
    } finally {
      setCreating(false);
    }
  }

  async function createDelivery(event: React.FormEvent<HTMLFormElement>) {
    if (editingDeliveryId) return saveDeliveryEdits(event, editingDeliveryId);
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const vehicleChoice = resolveCreationVehicle({ manualTruck: "", selectedVehicleId: creationVehicleId, vehicles: integration.vehicles });
    const truck = vehicleChoice.truck;
    if (company) window.localStorage.setItem(truckPreferenceKey(company), vehicleChoice.sendatrackVehicleId);
    const originSiteId = company?.role === "agency" ? company.siteId ?? "" : String(form.get("originSiteId") ?? "").trim();
    if (company && originSiteId) {
      window.localStorage.setItem(originPreferenceKey(company), originSiteId);
      setDefaultOriginSiteId(originSiteId);
    }
    const destinationSiteId = String(form.get("destinationSiteId") ?? "").trim();
    const selectedSite = knownSites.find((site) => site.id === destinationSiteId);
    const destination = selectedSite?.address ?? "";
    // A departure date is the one manual input here -- shared once per
    // shipment submission, not per parcel, so it doesn't reintroduce the
    // per-parcel re-entry that got these fields removed from creation in
    // the first place. plannedArrivalAt is deliberately NOT sent: the
    // server derives it authoritatively from this date and the destination
    // (see relay-eta-estimate.ts), the same trusted-server-computation
    // pattern already used for price.
    const nextTruckDepartureRaw = String(form.get("nextTruckDepartureAt") ?? "").trim();
    const nextTruckDepartureAt = nextTruckDepartureRaw ? new Date(nextTruckDepartureRaw).toISOString() : "";
    const whatsappOptIn = form.get("whatsappOptIn") === "on";
    const contactRaw = String(form.get("contact") ?? "").trim();
    const recipientContactRaw = String(form.get("recipientContact") ?? "").trim();
    if (features.whatsappAvailable && !whatsappOptIn && (contactRaw || recipientContactRaw)) {
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
      nextTruckDepartureAt,
      truck,
      sendatrackVehicleId: vehicleChoice.sendatrackVehicleId,
      contact: contactRaw,
      customerEmail: String(form.get("customerEmail") ?? "").trim(),
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
        itemDescription: weightRaw ? "" : parcel.itemDescription.trim(),
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
      if (company) window.localStorage.removeItem(deliveryCreationDraftKey(company));
      setModalOpen(false);
      setParcelDrafts([{ key: "0", weightKg: "", manualPriceAmount: "", itemDescription: "" }]);
      setCreationDestinationSiteId("");
      setCreationDepartureAt("");
      setCreationDraftSeed(null);
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

  // Only actually deliverable while the customer's own WhatsApp message
  // opened Meta's free 24h reply window -- this endpoint just attempts it
  // and reports back whatever Meta says, rather than TrackFleet trying to
  // track that window itself. A closed window is the expected, ordinary
  // outcome (not every customer texts in), so its toast is informational,
  // not alarming.
  async function notifyArrivalForDelivery(deliveryId: string, destinationSiteId?: string | null) {
    if (company?.role !== "agency" || destinationSiteId !== company.siteId) return;
    try {
      const response = await fetch("/api/deliveries/notify-arrival", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deliveryId }),
      });
      const data = await response.json().catch(() => null);
      if (response.ok && data?.ok) {
        setToast(locale === "fr" ? "Client notifié par WhatsApp." : locale === "nl" ? "Klant via WhatsApp op de hoogte gebracht." : "Customer notified via WhatsApp.");
      } else if (data?.error === "consent_withdrawn") {
        setToast(locale === "fr" ? "Notification impossible : ce client a retiré son consentement WhatsApp." : locale === "nl" ? "Melding niet mogelijk: deze klant heeft zijn WhatsApp-toestemming ingetrokken." : "Could not notify: this customer withdrew their WhatsApp consent.");
      } else {
        setToast(locale === "fr" ? "Notification impossible : le client doit d’abord vous avoir écrit sur WhatsApp (fenêtre gratuite de 24h)." : locale === "nl" ? "Melding niet mogelijk: de klant moet u eerst op WhatsApp hebben geschreven (gratis venster van 24u)." : "Could not notify: the customer must have messaged you on WhatsApp first (free 24h window).");
      }
    } catch {
      setToast(locale === "fr" ? "Impossible d’envoyer la notification." : locale === "nl" ? "Melding kon niet worden verzonden." : "Could not send the notification.");
    }
  }

  // The status-changing "confirm departure" action lives in SiteManager's
  // dedicated "Arrivées" ops panel instead (mirroring where confirmArrival
  // already lives for the dispatcher role) -- this is just the optional,
  // on-demand WhatsApp notice for one specific delivery, same popover-only
  // placement as notifyArrivalForDelivery above.
  async function notifyDepartureForDelivery(deliveryId: string) {
    if (company?.role !== "dispatcher") return;
    try {
      const response = await fetch("/api/deliveries/notify-departure", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deliveryId }),
      });
      const data = await response.json().catch(() => null);
      if (response.ok && data?.ok) {
        setToast(locale === "fr" ? "Client notifié par WhatsApp." : locale === "nl" ? "Klant via WhatsApp op de hoogte gebracht." : "Customer notified via WhatsApp.");
      } else if (data?.error === "consent_withdrawn") {
        setToast(locale === "fr" ? "Notification impossible : ce client a retiré son consentement WhatsApp." : locale === "nl" ? "Melding niet mogelijk: deze klant heeft zijn WhatsApp-toestemming ingetrokken." : "Could not notify: this customer withdrew their WhatsApp consent.");
      } else {
        setToast(locale === "fr" ? "Notification impossible : le client doit d’abord vous avoir écrit sur WhatsApp (fenêtre gratuite de 24h)." : locale === "nl" ? "Melding niet mogelijk: de klant moet u eerst op WhatsApp hebben geschreven (gratis venster van 24u)." : "Could not notify: the customer must have messaged you on WhatsApp first (free 24h window).");
      }
    } catch {
      setToast(locale === "fr" ? "Impossible d’envoyer la notification." : locale === "nl" ? "Melding kon niet worden verzonden." : "Could not send the notification.");
    }
  }

  // Quick-create for showing off a feature (e.g. the agency WhatsApp arrival
  // notification) to a prospective client without the full "New delivery"
  // form or a real truck -- the delivery is fully real and appears in the
  // destination agency's own dashboard, just marked [DEMO] so it's obvious
  // and can be bulk-removed with deleteDemoDeliveries below.
  async function createDemoDelivery(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!demoDestinationSiteId) return;
    setDemoBusy(true);
    try {
      const response = await fetch("/api/deliveries/demo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contact: demoContact, destinationSiteId: demoDestinationSiteId, originSiteId: defaultOriginSiteId }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) throw new Error("demo_creation_failed");
      setDemoModalOpen(false);
      setDemoContact("");
      setDemoDestinationSiteId("");
      setDemoActiveDeliveryId(data.deliveryId ?? null);
      if (data.delivery) setDeliveries((items) => [...items, data.delivery]);
      setToast(locale === "fr" ? "Livraison démo créée. Elle apparaît dans le tableau de bord de l’agence choisie." : locale === "nl" ? "Demozending aangemaakt. Ze verschijnt in het dashboard van het gekozen agentschap." : "Demo delivery created. It now appears in the chosen agency's dashboard.");
    } catch {
      setToast(locale === "fr" ? "Impossible de créer la livraison démo." : locale === "nl" ? "Demozending kon niet worden aangemaakt." : "Could not create the demo delivery.");
    } finally {
      setDemoBusy(false);
    }
  }

  // Walkthrough step for the demo panel below -- jumps the demo delivery to
  // the next fixed progress milestone and an interpolated position along its
  // real route (see pointAtRouteFraction in route-progress.ts), since a demo
  // delivery has no real truck to observe progress from. Departure and
  // arrival reuse the exact same confirmGroupDeparture/confirmGroupArrival
  // actions a real dispatcher uses (including the real WhatsApp send), just
  // targeted at this one delivery -- only this "advance" step needed new
  // backend support.
  async function advanceDemoDelivery() {
    if (!demoActiveDeliveryId) return;
    setDemoAdvancePending(true);
    try {
      const response = await fetch("/api/deliveries/demo/advance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deliveryId: demoActiveDeliveryId }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) throw new Error("demo_advance_failed");
      if (data.delivery) setDeliveries((items) => items.map((item) => item.id === data.delivery.id ? data.delivery : item));
      setToast(data.unchanged
        ? (locale === "fr" ? "Le camion démo est proche de l’arrivée. Confirmez l’arrivée pour continuer." : locale === "nl" ? "De demovrachtwagen is bijna aangekomen. Bevestig de aankomst om verder te gaan." : "The demo truck is close to arrival. Confirm arrival to continue.")
        : (locale === "fr" ? "Le camion démo a avancé." : locale === "nl" ? "De demovrachtwagen is verder gereden." : "The demo truck moved forward."));
    } catch {
      setToast(locale === "fr" ? "Impossible de faire avancer le camion démo." : locale === "nl" ? "De demovrachtwagen kon niet verder rijden." : "Could not move the demo truck forward.");
    } finally {
      setDemoAdvancePending(false);
    }
  }

  async function deleteDemoDeliveries() {
    const confirmMessage = locale === "fr" ? "Supprimer toutes les livraisons démo ?" : locale === "nl" ? "Alle demozendingen verwijderen?" : "Delete all demo deliveries?";
    if (!window.confirm(confirmMessage)) return;
    setDemoBusy(true);
    try {
      const response = await fetch("/api/deliveries/demo", { method: "DELETE" });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) throw new Error("demo_deletion_failed");
      setDemoActiveDeliveryId(null);
      setToast(locale === "fr" ? `${data.deletedCount} livraison(s) démo supprimée(s).` : locale === "nl" ? `${data.deletedCount} demozending(en) verwijderd.` : `${data.deletedCount} demo deliveries deleted.`);
    } catch {
      setToast(locale === "fr" ? "Impossible de supprimer les livraisons démo." : locale === "nl" ? "Demozendingen konden niet worden verwijderd." : "Could not delete the demo deliveries.");
    } finally {
      setDemoBusy(false);
    }
  }

  async function deleteDelivery(deliveryId: string, customer: string) {
    const confirmMessage = locale === "fr" ? `Supprimer définitivement la livraison de ${customer} (${deliveryId}) ? Cette action est irréversible.` : locale === "nl" ? `Zending van ${customer} (${deliveryId}) definitief verwijderen? Deze actie kan niet ongedaan worden gemaakt.` : `Permanently delete the delivery for ${customer} (${deliveryId})? This cannot be undone.`;
    if (!window.confirm(confirmMessage)) return;
    setDeleteBusyId(deliveryId);
    try {
      const response = await fetch("/api/deliveries", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deliveryId }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) throw new Error("delivery_deletion_failed");
      setDeliveries((items) => items.filter((item) => item.id !== deliveryId));
      if (selectedId === deliveryId) setShowPopover(false);
      setToast(locale === "fr" ? "Livraison supprimée." : locale === "nl" ? "Zending verwijderd." : "Delivery deleted.");
    } catch {
      setToast(locale === "fr" ? "Impossible de supprimer cette livraison." : locale === "nl" ? "Deze zending kon niet worden verwijderd." : "Could not delete this delivery.");
    } finally {
      setDeleteBusyId(null);
    }
  }

  async function openCompanySettings() {
    setCompanySettingsName(companyBranding.name ?? "");
    setCompanySettingsColor(companyBranding.color ?? "#c1272d");
    setCompanySettingsLogoDataUrl(companyBranding.logoDataUrl ?? null);
    setCompanySettingsUnloadGraceMinutes("");
    setCompanySettingsCtmRelayGraceHours("");
    setCompanySettingsCtmRelayAutoEnabled(true);
    setCompanySettingsAutomationLoadFailed(false);
    setCompanySettingsOpen(true);
    try {
      const response = await fetch("/api/company/automation-settings", { cache: "no-store" });
      if (!response.ok) throw new Error("automation_settings_fetch_failed");
      const data = await response.json() as { settings?: CompanyAutomationSettings };
      const settings = data.settings;
      if (!settings) return;
      if (typeof settings.unloadGraceMinutes === "number") setCompanySettingsUnloadGraceMinutes(String(settings.unloadGraceMinutes));
      if (typeof settings.ctmRelayGraceMinutes === "number") setCompanySettingsCtmRelayGraceHours(String(Math.round(settings.ctmRelayGraceMinutes / 60)));
      if (typeof settings.ctmRelayAutoCompletionEnabled === "boolean") setCompanySettingsCtmRelayAutoEnabled(settings.ctmRelayAutoCompletionEnabled);
    } catch {
      setCompanySettingsAutomationLoadFailed(true);
    }
  }

  // Resized/compressed client-side before it ever reaches the server --
  // logos don't need to be huge (this UI only ever shows them at badge
  // size), and keeping the upload small keeps the company row's stored
  // data URL well under the server's own size cap regardless of what the
  // dispatcher's original file looked like.
  async function handleLogoFileChange(file: File) {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("logo_read_failed"));
      reader.readAsDataURL(file);
    });
    try {
      setCompanySettingsLogoDataUrl(await cropLogoDataUrl(dataUrl));
    } catch {
      setToast(locale === "fr" ? "Impossible de traiter cette image." : locale === "nl" ? "Kon deze afbeelding niet verwerken." : "Could not process this image.");
    }
  }

  async function saveCompanySettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCompanySettingsSaving(true);
    try {
      const response = await fetch("/api/company/branding", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: companySettingsName.trim(), color: companySettingsColor, logoDataUrl: companySettingsLogoDataUrl ?? "" }),
      });
      if (!response.ok) throw new Error("branding_save_failed");

      if (!companySettingsAutomationLoadFailed) {
        const trimmedUnloadGrace = companySettingsUnloadGraceMinutes.trim();
        const trimmedCtmRelayHours = companySettingsCtmRelayGraceHours.trim();
        const automationResponse = await fetch("/api/company/automation-settings", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            unloadGraceMinutes: trimmedUnloadGrace === "" ? null : Number(trimmedUnloadGrace),
            ctmRelayGraceMinutes: trimmedCtmRelayHours === "" ? null : Number(trimmedCtmRelayHours) * 60,
            ctmRelayAutoCompletionEnabled: companySettingsCtmRelayAutoEnabled,
          }),
        });
        if (!automationResponse.ok) throw new Error("automation_settings_save_failed");
      }

      window.dispatchEvent(new Event("trackfleet-branding-changed"));
      setCompanySettingsOpen(false);
      setToast(locale === "fr" ? "Identité visuelle mise à jour." : locale === "nl" ? "Huisstijl bijgewerkt." : "Branding updated.");
    } catch {
      setToast(locale === "fr" ? "Impossible d’enregistrer l’identité visuelle." : locale === "nl" ? "Kon de huisstijl niet opslaan." : "Could not save the branding.");
    } finally {
      setCompanySettingsSaving(false);
    }
  }

  if (view === "customer" && publicTrackingState === "loading") return <main className="login-page login-loading"><div className="brand brand-dark"><span className="brand-mark"><span>↗</span></span><span>TrackFleet</span></div></main>;
  if (view === "customer" && publicTrackingState === "error") return <main className="login-page login-loading"><section className="tracking-error"><div className="brand brand-dark"><span className="brand-mark"><span>↗</span></span><span>TrackFleet</span></div><h1>Lien de suivi introuvable</h1><p>Vérifiez le lien reçu ou contactez l’entreprise qui vous l’a envoyé.</p></section></main>;
  if (view !== "customer" && authState === "loading") return <main className="login-page login-loading"><div className="brand brand-dark"><span className="brand-mark"><span>↗</span></span><span>TrackFleet</span></div></main>;
  if (view !== "customer" && authState === "anonymous") return <LoginScreen locale={locale} busy={loginBusy} error={loginError} onLocale={changeLocale} onSubmit={login} googleLink={googleLink} googleLinkBusy={googleLinkBusy} googleLinkError={googleLinkError} googleError={googleError} onGoogleLinkSubmit={submitGoogleLink} onGoogleLinkCancel={() => setGoogleLink(null)} />;
  if (view !== "customer" && authState === "authenticated" && company?.role === "agency" && agencyLocationOpen) return <AgencyLocationSetup locale={locale} site={knownSites.find((site) => site.id === company.siteId) ?? null} onLocale={changeLocale} onLogout={() => void logout()} onBack={() => setAgencyLocationOpen(false)} />;
  if (view !== "customer" && authState === "authenticated" && dispatchDataState === "loading") return <main className="login-page login-loading"><div className="brand brand-dark"><span className="brand-mark"><span>↗</span></span><span>TrackFleet</span></div></main>;
  if (view !== "customer" && authState === "authenticated" && dispatchDataState === "error") return <main className="login-page login-loading"><section className="tracking-error"><div className="brand brand-dark"><span className="brand-mark"><span>↗</span></span><span>TrackFleet</span></div><h1>{locale === "fr" ? "Données temporairement indisponibles" : locale === "nl" ? "Gegevens tijdelijk niet beschikbaar" : "Data temporarily unavailable"}</h1><p>{locale === "fr" ? "TrackFleet n’affiche aucune donnée de démonstration à la place de vos données réelles." : locale === "nl" ? "TrackFleet toont geen demogegevens in plaats van uw echte gegevens." : "TrackFleet will not show demo data in place of your real data."}</p><button className="primary-button" onClick={() => window.location.reload()}>{locale === "fr" ? "Réessayer" : locale === "nl" ? "Opnieuw proberen" : "Retry"}</button></section></main>;
  // A company past its trial with no active subscription (past_due/
  // canceled) is authenticated and can still log in -- it's only actual
  // fleet data access that's gated -- so this screen shows instead of the
  // dashboard rather than instead of the login form. A genuinely new
  // company never actually reaches this screen on first login (see
  // grantTrialIfNewCompany in app/lib/subscription-store.ts); it only shows
  // once a trial or paid period has actually lapsed. The Subscribe button
  // opens a Paddle.js overlay checkout, which itself degrades gracefully
  // (checkoutUnavailable) if Paddle is ever misconfigured.
  if (view !== "customer" && authState === "authenticated" && dispatchDataState === "subscription_required") return <SubscribeScreen locale={locale} busy={checkoutBusy} completing={checkoutCompleting} unavailable={checkoutUnavailable} interval={checkoutInterval} onIntervalChange={setCheckoutInterval} onSubscribe={(plan) => void startSubscriptionCheckout(plan)} onLogout={() => void logout()} />;

  // Wrapped in a nested function (instead of inlining this JSX directly in
  // the branch below) so V8 can lazily defer parsing/compiling its body --
  // authState starts "loading" and view starts "dispatch" on every render,
  // including the very first server-rendered one, so this branch is never
  // taken during SSR. Reproduced live via `wrangler tail`: the Worker was
  // intermittently exceeding its CPU time limit (Cloudflare error 1102) on
  // GET / -- this file is ~1300 lines / ~100KB of source in one function,
  // and V8 must fully compile a function's body the first time it's called.
  // Deferring the two large, branch-only JSX trees (this one and the
  // dashboard below) cuts what has to be compiled just to serve the tiny
  // loading shell that every SSR request actually renders.
  function renderCustomerView() {
    const copy = {
      fr: {
        progress: "Trajet effectué",
        remaining: "Distance restante",
        gps: "Dernière position",
        fresh: "GPS à jour",
        noGps: "Position indisponible",
        current: "Position actuelle",
        currentDetail: (progress: number) => `${progress}% du trajet effectué`,
        relayCurrent: "Relais CTM en cours",
        relayCurrentDetail: "Notre partenaire local achemine le colis vers l’agence",
        destination: "Destination",
        events: {
          REGISTERED: "Colis enregistré",
          DEPARTED: "Camion parti",
          PROGRESS_25: "25% du trajet effectué",
          PROGRESS_50: "Mi-parcours atteint",
          PROGRESS_75: "75% du trajet effectué",
          SCAN_LOADED: "Colis chargé dans le camion",
          SCAN_HUB_ARRIVED: "Colis arrivé au centre logistique",
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
        gps: "Last position",
        fresh: "GPS up to date",
        noGps: "Position unavailable",
        current: "Current position",
        currentDetail: (progress: number) => `${progress}% of the trip completed`,
        relayCurrent: "CTM relay in progress",
        relayCurrentDetail: "Our local partner is carrying the parcel to the agency",
        destination: "Destination",
        events: {
          REGISTERED: "Parcel registered",
          DEPARTED: "Truck departed",
          PROGRESS_25: "25% of the trip completed",
          PROGRESS_50: "Halfway point reached",
          PROGRESS_75: "75% of the trip completed",
          SCAN_LOADED: "Parcel loaded onto the truck",
          SCAN_HUB_ARRIVED: "Parcel arrived at the logistics hub",
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
        gps: "Laatste positie",
        fresh: "GPS is actueel",
        noGps: "Positie niet beschikbaar",
        current: "Huidige positie",
        currentDetail: (progress: number) => `${progress}% van het traject voltooid`,
        relayCurrent: "CTM-relais bezig",
        relayCurrentDetail: "Onze lokale partner brengt het pakket naar het agentschap",
        destination: "Bestemming",
        events: {
          REGISTERED: "Zending geregistreerd",
          DEPARTED: "Vrachtwagen vertrokken",
          PROGRESS_25: "25% van het traject voltooid",
          PROGRESS_50: "Halverwege bereikt",
          PROGRESS_75: "75% van het traject voltooid",
          SCAN_LOADED: "Pakket in de vrachtwagen geladen",
          SCAN_HUB_ARRIVED: "Pakket aangekomen in het logistiek centrum",
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
    // Confirmed from real fleet GPS history (see KnownSite.finalLegTrackingUnavailable):
    // past the relay hub, the truck's position goes stale, so a live map and
    // GPS-derived stats (progress/speed/remaining distance/GPS freshness)
    // would show numbers that stopped meaning anything -- shown as a plain
    // relay notice instead of a map that looks like it's just stuck. Dynamic,
    // not a blanket "this route always relays" flag: a relay-destined
    // delivery still gets real live GPS for the Brussels-to-hub leg (same as
    // any other truck), so the live map stays up as long as positions keep
    // arriving (gpsFresh) and only switches once they actually stop
    // (positionAgeMinutes not null -- it has GPS history -- but stale). Before
    // the truck has any GPS history yet (positionAgeMinutes null), the normal
    // map still shows rather than jumping straight to the relay notice.
    const relayDestination = staticKnownSite(selected.destinationSiteId)?.finalLegTrackingUnavailable === true;
    const relayInEffect = relayDestination && selected.positionAgeMinutes != null && !selected.gpsFresh;
    // Reported live: for a relay destination, estimatedArrivalAt is only a
    // GPS-based ETA to the confirmed hub (route/progress math is capped
    // there -- see delivery-progress-destination.ts), not to the parcel's
    // actual destination. Once real GPS pace exists it was winning over
    // plannedArrivalAt (the destination-aware CTM relay estimate, see
    // relay-eta-estimate.ts) here, so the headline showed "arriving in 2
    // days" while the honest estimate accounting for the onward relay leg
    // was really over a week out -- silently understating the real date by
    // however long the relay leg itself takes. plannedArrivalAt wins for any
    // relay destination, not just once relayInEffect kicks in: the hub is an
    // operational waypoint the customer never asked about, so it should
    // never stand in for "when does MY parcel arrive" even while GPS is
    // still fresh on the way there.
    const displayedEta = relayDestination && selected.plannedArrivalAt
      ? new Date(selected.plannedArrivalAt).toLocaleString(dateLocale, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
      : selected.estimatedArrivalAt
        ? new Date(selected.estimatedArrivalAt).toLocaleString(dateLocale, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
        : selected.plannedArrivalAt
          ? new Date(selected.plannedArrivalAt).toLocaleString(dateLocale, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
          : selected.eta;
    const etaNote = customerEtaNote({
      source: selected.etaSource,
      delayMinutes: selected.etaDelayMinutes,
      historyTrips: selected.etaHistoryTrips,
      finalLegTrackingUnavailable: relayInEffect,
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
            <CompanyLogo className="brand-mark" logoDataUrl={companyBranding.logoDataUrl} />
            <span>{companyBranding.name || "TrackFleet"}</span>
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
              {(selected.weightKg != null || selected.priceAmount != null || selected.itemDescription) && <div className="shipment-facts">
                {selected.weightKg != null && <span><strong>{selected.weightKg.toLocaleString(dateLocale, { maximumFractionDigits: 3 })} kg</strong><small>{locale === "fr" ? "Poids du colis" : locale === "nl" ? "Gewicht zending" : "Parcel weight"}</small></span>}
                {selected.priceAmount != null && selected.priceCurrency && <span><strong>{selected.priceAmount.toLocaleString(dateLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {selected.priceCurrency}</strong><small>{locale === "fr" ? "Prix déclaré" : locale === "nl" ? "Aangegeven prijs" : "Declared price"}</small></span>}
                {selected.itemDescription && <span><strong>{selected.itemDescription}</strong><small>{locale === "fr" ? "Description" : locale === "nl" ? "Omschrijving" : "Description"}</small></span>}
              </div>}
            </div>
            <div className="eta-card">
              <span>{t.estimatedArrival}</span>
              <strong>{displayedEta}</strong>
              <small className={`eta-${selected.etaDelayMinutes != null && selected.etaDelayMinutes >= 60 ? "delayed" : selected.status.toLowerCase().replace(" ", "-")}`}>{etaNote}</small>
            </div>
          </div>

          {!relayInEffect && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 18 }}>
            <article className="stat-card"><div className="stat-head"><span>{copy.progress}</span><Icon>↗</Icon></div><div><strong>{selected.progress}%</strong></div><div className="progress"><div><i style={{ width: `${selected.progress}%` }} /></div></div></article>
            <article className="stat-card"><div className="stat-head"><span>{copy.remaining}</span><Icon>◇</Icon></div><div><strong>{selected.remainingDistanceKm == null ? "—" : `${selected.remainingDistanceKm.toLocaleString(dateLocale)} km`}</strong></div><p>{selected.routeDistanceKm == null ? "" : `${Math.round(selected.routeDistanceKm).toLocaleString(dateLocale)} km total`}</p></article>
            <article className="stat-card"><div className="stat-head"><span>{copy.gps}</span><Icon>⌖</Icon></div><div><strong>{selected.gpsFresh ? "●" : selected.positionAgeMinutes == null ? "—" : "△"}</strong></div><p>{gpsText}</p></article>
          </div>}

          <div className="customer-grid">
            {relayInEffect ? <div className="map customer-map relay-notice">
              <Icon>⇄</Icon>
              <strong>{locale === "fr" ? "La CTM a pris le relais" : locale === "nl" ? "CTM heeft dit traject overgenomen" : "CTM has taken over"}</strong>
              <p>{locale === "fr" ? "Le suivi GPS en direct s'arrête au point de relais. Notre partenaire local achemine votre colis pour la dernière étape." : locale === "nl" ? "Live GPS-tracking stopt op het overslagpunt. Onze lokale partner brengt uw pakket voor het laatste traject." : "Live GPS tracking stops at the relay point. Our local partner carries your parcel for the final leg."}</p>
            </div> : <div className="map customer-map">
              <InteractiveFleetMap deliveries={deliveries} selectedId={selectedId} customerMode label={`${routeDirection} · ${customerVehicleLabel}`} />
              <div className="map-live"><i className={selected.gpsFresh ? "" : "fallback"} /> {gpsText}</div>
            </div>}

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
                {selected.status !== "Delivered" && <div className="timeline-step active"><i>●</i><div><strong>{relayInEffect ? copy.relayCurrent : copy.current}</strong><span>{relayInEffect ? copy.relayCurrentDetail : copy.currentDetail(selected.progress)}</span></div></div>}
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
  if (view === "customer") return renderCustomerView();

  // See the comment on renderCustomerView above -- same reasoning, deferring
  // this compile cost too since it's also never reached during SSR.
  function renderDashboard() {
  const deliveriesPanel = (
    <div className="deliveries-panel">
      <div className="panel-header delivery-head"><div><h2>{t.todaysDeliveries}</h2><p>{t.shownCompleted(visibleDeliveries.length, deliveries.filter((delivery) => delivery.status === "Delivered").length)}</p></div><div className="panel-actions">{company?.role === "dispatcher" && <button type="button" className="label-print-button" disabled={selectedForLabels.size === 0} title={selectedForLabels.size ? undefined : (locale === "fr" ? "Sélectionnez un ou plusieurs colis" : locale === "nl" ? "Selecteer een of meer pakketten" : "Select one or more parcels")} onClick={() => { if (!selectedForLabels.size) return; window.open(`/labels?ids=${Array.from(selectedForLabels).join(",")}`, "_blank"); setSelectedForLabels(new Set()); }}>{selectedForLabels.size ? `🖨 ${locale === "fr" ? `Imprimer ${selectedForLabels.size} étiquette${selectedForLabels.size > 1 ? "s" : ""}` : locale === "nl" ? `${selectedForLabels.size} label${selectedForLabels.size > 1 ? "s" : ""} afdrukken` : `Print ${selectedForLabels.size} label${selectedForLabels.size > 1 ? "s" : ""}`}` : (locale === "fr" ? "🖨 Imprimer les étiquettes" : locale === "nl" ? "🖨 Labels afdrukken" : "🖨 Print labels")}</button>}<input type="search" className="table-search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder={locale === "fr" ? "Client, destinataire, numéro…" : locale === "nl" ? "Klant, ontvanger, nummer…" : "Customer, recipient, number…"} aria-label={locale === "fr" ? "Rechercher une livraison" : locale === "nl" ? "Levering zoeken" : "Search deliveries"} /><select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label={t.filterDeliveries}><option value="All deliveries">{t.allDeliveries}</option><option value="In transit">{t.statuses["In transit"]}</option><option value="Delayed">{t.statuses.Delayed}</option><option value="Loading">{t.statuses.Loading}</option><option value="Delivered">{t.statuses.Delivered}</option></select></div></div>
      <div className="table-wrap">
        {visibleDeliveries.length === 0 ? <div className="deliveries-empty">
          <div className="deliveries-empty-icon" aria-hidden="true">◇</div>
          <div><strong>{deliveries.length === 0 ? dashboardEmptyCopy.firstTitle : searchQuery.trim() ? (locale === "fr" ? "Aucun résultat" : locale === "nl" ? "Geen resultaten" : "No results") : dashboardEmptyCopy.filteredTitle}</strong><p>{deliveries.length === 0 ? dashboardEmptyCopy.firstBody : searchQuery.trim() ? (locale === "fr" ? "Aucune livraison ne correspond à cette recherche." : locale === "nl" ? "Geen levering komt overeen met deze zoekopdracht." : "No delivery matches this search.") : dashboardEmptyCopy.filteredBody}</p></div>
          <button type="button" className="primary-button" onClick={() => { if (deliveries.length === 0) { openCreateModal(); } else { setFilter("All deliveries"); setSearchQuery(""); } }}>{deliveries.length === 0 ? dashboardEmptyCopy.firstAction : dashboardEmptyCopy.reset}</button>
        </div> : <table>
          <thead><tr><th>{t.tableDelivery}</th><th>{locale === "fr" ? "Contrôle colis" : locale === "nl" ? "Pakketcontrole" : "Parcel control"}</th><th>{t.tableCustomer}</th><th>{locale === "fr" ? "Destination" : locale === "nl" ? "Bestemming" : "Destination"}</th><th>{locale === "fr" ? "Statut" : locale === "nl" ? "Status" : "Status"}</th><th className="col-actions">{t.tableActions}</th></tr></thead>
          {groupedDeliveries.map((group) => <tbody key={group.label}>
            <tr className="group-header-row"><td colSpan={3}><div className="group-header-row-inner">{group.numberLabel && <span className="truck-number-badge" style={{ background: truckBadgeColor(group.truckNumber) }}>{group.numberLabel}</span>}<strong>{group.label}</strong><span>{group.deliveries.length} {locale === "fr" ? "colis" : locale === "nl" ? "pakketten" : group.deliveries.length === 1 ? "parcel" : "parcels"}</span>{group.uniformOrigin && <span>{knownSites.find((site) => site.id === group.uniformOrigin)?.label ?? "—"}</span>}</div></td><td className="col-destination">{group.uniformDestination && <span className="group-header-destination">{group.uniformDestination.destination}{staticKnownSite(group.uniformDestination.destinationSiteId)?.finalLegTrackingUnavailable && <b className="relay-badge">{locale === "fr" ? "Relais CTM" : locale === "nl" ? "CTM-relais" : "CTM relay"}</b>}</span>}</td><td className="col-status">{group.uniformDestination && <div className="col-status-inner">
              <div className="col-status-top"><span className={statusClass[group.uniformDestination.status]}><i />{t.statuses[group.uniformDestination.status]}</span>
              <span>{group.uniformDestination.estimatedArrivalAt ? new Date(group.uniformDestination.estimatedArrivalAt).toLocaleString(locale === "fr" ? "fr-BE" : locale === "nl" ? "nl-BE" : "en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : group.uniformDestination.eta}</span></div>
              <span className="group-header-progress"><div className="progress"><div><i style={{ width: `${group.uniformDestination.progress}%` }} /></div><span>{group.uniformDestination.progress}%</span></div></span>
              </div>}</td><td className="col-actions"><div className="group-header-row-inner">{company?.role === "dispatcher" && group.label !== (locale === "fr" ? "À affecter" : locale === "nl" ? "Toe te wijzen" : "To assign") && integration.connected && integration.vehicles.length > 0 && <span className="group-truck-editor-wrap"><button type="button" className="more-button group-truck-editor-trigger" title={locale === "fr" ? "Changer le camion pour tout le groupe" : locale === "nl" ? "Voertuig wijzigen voor de hele groep" : "Change the truck for the whole group"} aria-label={locale === "fr" ? "Changer le camion pour tout le groupe" : locale === "nl" ? "Voertuig wijzigen voor de hele groep" : "Change the truck for the whole group"} onClick={(event) => { event.stopPropagation(); const opening = groupTruckEditorLabel !== group.label; setGroupTruckEditorLabel(opening ? group.label : null); setGroupTruckEditorSelection(""); }}>🚚</button>{groupTruckEditorLabel === group.label && <div className="group-truck-editor-popover journey-editor-popover truck-editor-popover"><strong>{locale === "fr" ? "Affecter tout le groupe à un camion" : locale === "nl" ? "Hele groep toewijzen aan voertuig" : "Assign the whole group to a truck"}</strong><select value={groupTruckEditorSelection} disabled={groupTruckEditorPending} onClick={(event) => event.stopPropagation()} onChange={(event) => setGroupTruckEditorSelection(event.target.value)}><option value="">{locale === "fr" ? "Choisir un camion" : locale === "nl" ? "Kies een voertuig" : "Choose a truck"}</option>{integration.vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{truckNumberLabel(vehicle.id) ? `${truckNumberLabel(vehicle.id)} · ${vehicle.name}` : vehicle.name}</option>)}</select>{groupTruckEditorSelection && deliveries.find((delivery) => !group.deliveries.some((groupDelivery) => groupDelivery.id === delivery.id) && delivery.sendatrackVehicleId === groupTruckEditorSelection && delivery.status !== "Delivered") && <small className="warning">{locale === "fr" ? `⚠ Ce camion est encore en route (${deliveries.find((delivery) => !group.deliveries.some((groupDelivery) => groupDelivery.id === delivery.id) && delivery.sendatrackVehicleId === groupTruckEditorSelection && delivery.status !== "Delivered")!.id}). Vérifiez qu'il sera bien de retour.` : locale === "nl" ? `⚠ Dit voertuig is nog onderweg (${deliveries.find((delivery) => !group.deliveries.some((groupDelivery) => groupDelivery.id === delivery.id) && delivery.sendatrackVehicleId === groupTruckEditorSelection && delivery.status !== "Delivered")!.id}). Controleer of het op tijd terug is.` : `⚠ This truck is still en route (${deliveries.find((delivery) => !group.deliveries.some((groupDelivery) => groupDelivery.id === delivery.id) && delivery.sendatrackVehicleId === groupTruckEditorSelection && delivery.status !== "Delivered")!.id}). Confirm it will actually be back.`}</small>}<button type="button" disabled={!groupTruckEditorSelection || groupTruckEditorPending} onClick={(event) => { event.stopPropagation(); void reassignTruckForGroup(group.deliveries.map((delivery) => delivery.id), groupTruckEditorSelection); }}>{groupTruckEditorPending ? (locale === "fr" ? "Confirmation…" : locale === "nl" ? "Bevestigen…" : "Confirming…") : (locale === "fr" ? "Confirmer" : locale === "nl" ? "Bevestigen" : "Confirm")}</button></div>}</span>}{group.uniformDestination && company?.role === "dispatcher" && <span className="group-schedule-editor-wrap"><button type="button" className="more-button group-schedule-editor-trigger" title={locale === "fr" ? "Modifier les dates pour ce camion" : locale === "nl" ? "Data wijzigen voor dit voertuig" : "Edit dates for this truck"} aria-label={locale === "fr" ? "Modifier les dates pour ce camion" : locale === "nl" ? "Data wijzigen voor dit voertuig" : "Edit dates for this truck"} onClick={(event) => { event.stopPropagation(); const opening = groupScheduleEditorLabel !== group.label; setGroupScheduleEditorLabel(opening ? group.label : null); setGroupScheduleNextDeparture(opening ? toDatetimeLocalValue(group.uniformDestination!.nextTruckDepartureAt) : ""); }}>✎</button>{groupScheduleEditorLabel === group.label && <div className="group-schedule-editor-popover journey-editor-popover truck-editor-popover"><strong>{locale === "fr" ? "Départ du prochain camion" : locale === "nl" ? "Vertrek volgende vrachtwagen" : "Next truck departure"}</strong><input type="datetime-local" value={groupScheduleNextDeparture} disabled={groupSchedulePending} onChange={(event) => setGroupScheduleNextDeparture(event.target.value)} /><strong>{locale === "fr" ? "Arrivée estimée" : locale === "nl" ? "Geschatte aankomst" : "Estimated arrival"}</strong><div className="price-preview">{estimateRelayArrival(group.uniformDestination?.destinationSiteId, groupScheduleNextDeparture ? new Date(groupScheduleNextDeparture) : null, departureArrivalEstimates[group.uniformDestination?.destinationSiteId ?? ""]) ? <strong>{estimateRelayArrival(group.uniformDestination?.destinationSiteId, new Date(groupScheduleNextDeparture), departureArrivalEstimates[group.uniformDestination?.destinationSiteId ?? ""])!.toLocaleString(locale === "fr" ? "fr-BE" : locale === "nl" ? "nl-BE" : "en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</strong> : <span>—</span>}</div><button type="button" disabled={groupSchedulePending} onClick={() => void updateGroupSchedule(group.deliveries.map((delivery) => delivery.id), "", groupScheduleNextDeparture)}>{groupSchedulePending ? (locale === "fr" ? "Confirmation…" : locale === "nl" ? "Bevestigen…" : "Confirming…") : (locale === "fr" ? "Confirmer" : locale === "nl" ? "Bevestigen" : "Confirm")}</button></div>}</span>}{company?.role === "dispatcher" && group.deliveries.some((delivery) => delivery.status === "Loading") && <button type="button" className="more-button" disabled={groupDeparturePending === group.label} title={locale === "fr" ? "Confirmer le départ pour tout le groupe" : locale === "nl" ? "Vertrek bevestigen voor de hele groep" : "Confirm departure for the whole group"} aria-label={locale === "fr" ? "Confirmer le départ pour tout le groupe" : locale === "nl" ? "Vertrek bevestigen voor de hele groep" : "Confirm departure for the whole group"} onClick={(event) => { event.stopPropagation(); void confirmGroupDeparture(group.label, group.deliveries.filter((delivery) => delivery.status === "Loading").map((delivery) => delivery.id)); }}>{groupDeparturePending === group.label ? "…" : "→"}</button>}{company && group.destinationSubgroups.map((subgroup) => {
              const eligible = subgroup.deliveries.filter((delivery) => delivery.status !== "Delivered" && delivery.status !== "Loading");
              if (!eligible.length) return null;
              // An agency can appear as the ORIGIN of a delivery too (every
              // Moroccan agency site also carries the "origin" role, for
              // return shipments) -- a truck group can therefore mix a
              // subgroup heading to this agency's own site with another
              // subgroup the agency merely originated, bound elsewhere. The
              // server already refuses agency_destination_mismatch for the
              // latter (manual-completion/route.ts); this keeps the button
              // itself from being offered for a destination that isn't the
              // agency's own, matching confirmArrivalForDelivery's own gate.
              if (company.role === "agency" && subgroup.deliveries[0]?.destinationSiteId !== company.siteId) return null;
              const arrivalKey = `${group.label}::${subgroup.destination}`;
              return <button key={arrivalKey} type="button" className="more-button" disabled={groupArrivalPending === arrivalKey} title={locale === "fr" ? `Confirmer l’arrivée à ${subgroup.destination}` : locale === "nl" ? `Aankomst bevestigen bij ${subgroup.destination}` : `Confirm arrival at ${subgroup.destination}`} aria-label={locale === "fr" ? `Confirmer l’arrivée à ${subgroup.destination}` : locale === "nl" ? `Aankomst bevestigen bij ${subgroup.destination}` : `Confirm arrival at ${subgroup.destination}`} onClick={(event) => { event.stopPropagation(); void confirmGroupArrival(arrivalKey, eligible.map((delivery) => delivery.id)); }}>{groupArrivalPending === arrivalKey ? "…" : "✓"}</button>;
            })}
            </div></td></tr>
            {group.deliveries.map((delivery) => <tr key={delivery.id} role="button" tabIndex={0} onClick={() => { setSelectedId(delivery.id); setShowPopover(true); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedId(delivery.id); setShowPopover(true); } }} className={selectedId === delivery.id ? "row-selected" : ""}><td className="delivery-cell">{company?.role === "dispatcher" && <input type="checkbox" className="label-select-checkbox" checked={selectedForLabels.has(delivery.id)} onClick={(event) => event.stopPropagation()} onChange={(event) => setSelectedForLabels((current) => { const next = new Set(current); if (event.target.checked) next.add(delivery.id); else next.delete(delivery.id); return next; })} aria-label={locale === "fr" ? `Sélectionner ${delivery.id} pour l’impression` : locale === "nl" ? `${delivery.id} selecteren om af te drukken` : `Select ${delivery.id} for printing`} />}<div className="delivery-identification"><strong>{registeredAtLabel(delivery)}</strong><span>{delivery.id}</span>{delivery.shipmentId && (shipmentSizes.get(delivery.shipmentId) ?? 0) > 1 && <span className="shipment-badge">{locale === "fr" ? `${shipmentSizes.get(delivery.shipmentId)} colis liés` : locale === "nl" ? `${shipmentSizes.get(delivery.shipmentId)} gekoppelde pakketten` : `${shipmentSizes.get(delivery.shipmentId)} linked parcels`}</span>}</div></td><td className="scan-control-cell"><div className="scan-control-inner"><span className={delivery.scanSummary?.loadedAt ? "scan-proof is-confirmed" : "scan-proof"}><b>{locale === "fr" ? "Chargé" : locale === "nl" ? "Geladen" : "Loaded"}</b><small>{scanAtLabel(delivery.scanSummary?.loadedAt)}{delivery.scanSummary?.loadedTruck ? ` · ${delivery.scanSummary.loadedTruck}` : ""}</small></span><span className={delivery.scanSummary?.hubArrivedAt ? "scan-proof is-confirmed" : "scan-proof"}><b>Hub</b><small>{scanAtLabel(delivery.scanSummary?.hubArrivedAt)}{delivery.scanSummary?.hubLabel ? ` · ${delivery.scanSummary.hubLabel}` : ""}</small></span><span className={delivery.labelPrintRequestedAt ? "label-print-status is-requested" : "label-print-status"}>{delivery.labelPrintRequestedAt ? (locale === "fr" ? "Impression lancée" : locale === "nl" ? "Afdrukken gestart" : "Print started") : (locale === "fr" ? "À imprimer" : locale === "nl" ? "Af te drukken" : "To print")}</span></div></td><td className="contact-cell-wrap"><button type="button" className="customer-cell contact-trigger" onClick={(event) => { event.stopPropagation(); setOpenContactPopover((current) => current === `${delivery.id}:customer` ? null : `${delivery.id}:customer`); }}><span>{delivery.customer}</span></button>{openContactPopover === `${delivery.id}:customer` && <div className="contact-popover"><strong>{locale === "fr" ? "Téléphone client" : locale === "nl" ? "Telefoon klant" : "Customer phone"}</strong>{delivery.contact ? <a href={`tel:${delivery.contact}`}>{delivery.contact}</a> : <span>—</span>}</div>}{delivery.recipientName && <div className="recipient-line"><button type="button" className="contact-trigger" onClick={(event) => { event.stopPropagation(); setOpenContactPopover((current) => current === `${delivery.id}:recipient` ? null : `${delivery.id}:recipient`); }}><span>→ {delivery.recipientName}</span></button>{openContactPopover === `${delivery.id}:recipient` && <div className="contact-popover"><strong>{locale === "fr" ? "Téléphone destinataire" : locale === "nl" ? "Telefoon ontvanger" : "Recipient phone"}</strong>{[delivery.contact, delivery.recipientContact].filter(Boolean).length > 0 ? [delivery.contact, delivery.recipientContact].filter(Boolean).map((number) => <a key={number} href={`tel:${number}`}>{number}</a>) : <span>—</span>}</div>}</div>}</td><td className="col-destination">{!group.uniformDestination && <span className="journey-destination">{knownSites.find((site) => site.id === delivery.destinationSiteId)?.city ?? delivery.destination}{staticKnownSite(delivery.destinationSiteId)?.finalLegTrackingUnavailable && <b className="relay-badge">{locale === "fr" ? "Relais CTM" : locale === "nl" ? "CTM-relais" : "CTM relay"}</b>}</span>}</td><td className="col-status"><div className="col-status-inner"><div className="col-status-top">{!group.uniformDestination && <span className={statusClass[delivery.status]}><i />{t.statuses[delivery.status]}</span>}{group.uniformDestination ? <span className="cell-hoisted">—</span> : <span className="journey-eta"><strong>{delivery.estimatedArrivalAt ? new Date(delivery.estimatedArrivalAt).toLocaleString(locale === "fr" ? "fr-BE" : locale === "nl" ? "nl-BE" : "en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : delivery.eta}</strong><span>{(delivery.etaDelayMinutes ?? 0) >= 60 ? `+${Math.round((delivery.etaDelayMinutes ?? 0) / 60)}h` : delivery.status === "Delivered" ? t.arrived : t.today}</span></span>}</div>{!group.uniformDestination && <div className="progress"><div><i style={{ width: `${delivery.progress}%` }} /></div><span>{delivery.progress}%</span></div>}</div></td><td className="col-actions">{company?.role === "dispatcher" && delivery.status !== "Delivered" && <button type="button" className="more-button journey-editor-trigger" title={locale === "fr" ? "Modifier la livraison" : locale === "nl" ? "Zending bewerken" : "Edit delivery"} aria-label={locale === "fr" ? "Modifier la livraison" : locale === "nl" ? "Zending bewerken" : "Edit delivery"} onClick={(event) => { event.stopPropagation(); openEditModal(delivery); }}>✎</button>}<button className="more-button" title={t.copyTrackingFor(delivery.id)} aria-label={t.copyTrackingFor(delivery.id)} onClick={(event) => { event.stopPropagation(); void copyDeliveryLink(delivery.id); }}>↗</button>{company?.role === "dispatcher" && <button type="button" className="more-button" title={locale === "fr" ? "Imprimer l’étiquette" : locale === "nl" ? "Label afdrukken" : "Print the label"} aria-label={locale === "fr" ? "Imprimer l’étiquette" : locale === "nl" ? "Label afdrukken" : "Print the label"} onClick={(event) => { event.stopPropagation(); window.open(`/labels?ids=${delivery.id}`, "_blank"); }}>🖨</button>}{company?.role === "dispatcher" && <button type="button" className="more-button delete-delivery-button" disabled={deleteBusyId === delivery.id} title={locale === "fr" ? `Supprimer la livraison ${delivery.id}` : locale === "nl" ? `Zending ${delivery.id} verwijderen` : `Delete delivery ${delivery.id}`} aria-label={locale === "fr" ? `Supprimer la livraison ${delivery.id}` : locale === "nl" ? `Zending ${delivery.id} verwijderen` : `Delete delivery ${delivery.id}`} onClick={(event) => { event.stopPropagation(); void deleteDelivery(delivery.id, delivery.customer); }}>🗑</button>}</td></tr>)}
          </tbody>)}
        </table>}
      </div>
    </div>
  );

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand company-brand">
          <span className="company-brand-name">{companyBranding.name || "TrackFleet"}</span>
          <CompanyLogo className="brand-mark company-brand-mark" logoDataUrl={companyBranding.logoDataUrl} />
        </div>
        <nav aria-label="Main navigation">
          <button className="nav-item active"><Icon>▦</Icon>{t.overview}</button>
          <button className="nav-item" disabled><Icon>▰</Icon>{t.fleet} <span className="nav-count">{integration.connected ? integration.vehicleCount : "—"}</span></button>
          <button className="nav-item" disabled><Icon>◇</Icon>{t.deliveries} <span className="nav-count">{deliveries.length}</span></button>
          <button className="nav-item" disabled><Icon>◉</Icon>{t.customers}</button>
        </nav>
        <div className="sidebar-divider" />
        <nav aria-label={locale === "fr" ? "Outils TrackFleet" : locale === "nl" ? "TrackFleet-tools" : "TrackFleet tools"}>
          {company?.role === "dispatcher" && <a className="nav-item" href="/api/operations/export"><Icon>⇩</Icon>{t.exportTool}</a>}
          <a className="nav-item" href={`/import?lang=${locale}`}><Icon>＋</Icon>{t.importTool}</a>
          <a className="nav-item" href="/guide"><Icon>◈</Icon>{t.guideTool}</a>
          <a className="nav-item" href="/scan/connect"><Icon>▦</Icon>{t.scanTool}</a>
        </nav>
        <div className="sidebar-divider" />
        <nav>
          {company?.role === "dispatcher" ? <button className="nav-item" onClick={openCompanySettings}><Icon>⚙</Icon>{t.settings}</button> : <button className="nav-item" disabled><Icon>⚙</Icon>{t.settings}</button>}
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
          <div className="top-actions"><LanguageSwitcher locale={locale} label={t.language} onChange={changeLocale} />{company?.role === "dispatcher" ? <><SiteManager locale={locale} /><button type="button" onClick={() => setDemoModalOpen(true)}>{locale === "fr" ? "Créer une livraison démo" : locale === "nl" ? "Demozending aanmaken" : "Create demo delivery"}</button><button type="button" onClick={() => void deleteDemoDeliveries()} disabled={demoBusy}>{locale === "fr" ? "Supprimer les livraisons démo" : locale === "nl" ? "Demozendingen verwijderen" : "Delete demo deliveries"}</button>{demoActiveDeliveryId && <span className="demo-walkthrough"><b>{locale === "fr" ? "Démo" : locale === "nl" ? "Demo" : "Demo"}</b><span>{demoDelivery ? `${t.statuses[demoDelivery.status]} · ${demoDelivery.progress}%` : (locale === "fr" ? "Synchronisation…" : locale === "nl" ? "Synchroniseren…" : "Syncing…")}</span><button type="button" disabled={!demoDelivery || demoDelivery.status === "Loading" || demoDelivery.status === "Delivered" || demoAdvancePending} onClick={() => void advanceDemoDelivery()}>{locale === "fr" ? "Faire avancer le camion" : locale === "nl" ? "Vrachtwagen laten rijden" : "Move truck forward"}</button><button type="button" aria-label={t.close} onClick={() => setDemoActiveDeliveryId(null)}>×</button></span>}</> : <><button type="button" onClick={() => setAgencyLocationOpen(true)}>{locale === "fr" ? "Localiser l’agence" : locale === "nl" ? "Agentschap lokaliseren" : "Locate agency"}</button><button type="button" onClick={() => window.location.assign("/import")}>{locale === "fr" ? "Importer des colis" : locale === "nl" ? "Zendingen importeren" : "Import parcels"}</button></>}<button className="primary-button" onClick={() => openCreateModal()}><span>＋</span>{t.newDelivery}</button></div>
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
            <div className="panel-header"><div><h2>{t.liveFleet}</h2><p>{integration.connected ? t.sendatrackRefreshing : t.updatesEvery30}</p></div><div className="panel-actions"><select aria-label={t.findVehicle} value={selectedId} onChange={(event) => { setSelectedId(event.target.value); setSelectedVehicleId(null); setShowPopover(true); }}>{deliveries.map((delivery) => <option key={delivery.id} value={delivery.id}>{vehicleLabel(delivery)}</option>)}</select></div></div>
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
                          {delivery.itemDescription && <span>{delivery.itemDescription}</span>}
                          <span>{note}</span>
                        </div>
                        <div className="expected-parcel-actions">
                          <button type="button" onClick={() => void confirmArrivalForDelivery(delivery.id, delivery.destinationSiteId)}>{locale === "fr" ? "Confirmer l’arrivée" : locale === "nl" ? "Aankomst bevestigen" : "Confirm arrival"}</button>
                          <button type="button" onClick={() => void notifyArrivalForDelivery(delivery.id, delivery.destinationSiteId)}>{locale === "fr" ? "Notifier par WhatsApp" : locale === "nl" ? "Melden via WhatsApp" : "Notify via WhatsApp"}</button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )
            ) : <>
              <InteractiveFleetMap deliveries={mapDeliveriesWithOrigin} liveVehicles={liveVehiclesWithNumbers} selectedId={showPopover ? selectedId : ""} selectedVehicleId={showPopover ? selectedVehicleId : null} label={t.liveFleet} onSelect={(deliveryId) => { setSelectedId(deliveryId); setSelectedVehicleId(null); setShowPopover(true); }} onSelectVehicle={(vehicleId) => { setSelectedVehicleId(vehicleId); setShowPopover(true); }} onBackgroundClick={() => setShowPopover(false)} />
              <div className="map-status"><i className={integration.connected ? "" : "fallback"} /> {integration.connected ? t.sendatrackLive(integration.vehicleCount) : t.vehiclesReporting}</div>
              {integration.connected && <div className="fleet-roster" aria-label={locale === "fr" ? "Tous les camions connectés" : locale === "nl" ? "Alle verbonden voertuigen" : "All connected vehicles"}>{integration.vehicles.map((vehicle) => <span key={vehicle.id}><i />{truckNumberLabel(vehicle.id) && <b className="truck-number-badge" style={{ background: truckBadgeColor(vehicleTruckNumbers.get(vehicle.id) ?? null) }}>{truckNumberLabel(vehicle.id)}</b>}{vehicle.name}<small>{vehicle.speed} km/h</small></span>)}</div>}
            </>}
            {!agencyMapUnavailable && showPopover && (selectedVehicle || deliveries.length > 0) && <div className="truck-popover">
              {selectedVehicle ? <>
                <div><span className="truck-badge" style={selectedVehicle.truckColor ? { background: selectedVehicle.truckColor } : undefined}>▰</span><p>
                  {renamingVehicleId && renamingVehicleId === selectedVehicle.id
                    ? <span className="rename-truck"><input value={renameDraft} maxLength={60} disabled={renameBusy} onChange={(event) => setRenameDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void renameVehicle(renamingVehicleId); if (event.key === "Escape") setRenamingVehicleId(null); }} /><button type="button" disabled={renameBusy} aria-label={locale === "fr" ? "Confirmer le nom" : locale === "nl" ? "Naam bevestigen" : "Confirm name"} onClick={() => void renameVehicle(renamingVehicleId)}>✓</button><button type="button" disabled={renameBusy} aria-label={t.cancel} onClick={() => setRenamingVehicleId(null)}>×</button></span>
                    : <><strong>{truckNumberLabel(selectedVehicle.id) && <b className="truck-number-badge" style={{ background: truckBadgeColor(vehicleTruckNumbers.get(selectedVehicle.id) ?? null) }}>{truckNumberLabel(selectedVehicle.id)}</b>}<span className="truck-name-text" title={selectedVehicle.name}>{selectedVehicle.name}</span></strong>{company?.role === "dispatcher" && <button type="button" className="rename-trigger" aria-label={locale === "fr" ? "Renommer ce véhicule" : locale === "nl" ? "Dit voertuig hernoemen" : "Rename this vehicle"} onClick={() => { setRenamingVehicleId(selectedVehicle.id); setRenameDraft(selectedVehicle.name); }}>✎</button>}</>}
                  <small>{locale === "fr" ? "Aucune livraison en cours" : locale === "nl" ? "Geen actieve levering" : "No active delivery"}</small>
                </p><button aria-label={t.closeDetails} onClick={() => setShowPopover(false)}>×</button></div>
                <dl><div><dt>{locale === "fr" ? "Vitesse" : locale === "nl" ? "Snelheid" : "Speed"}</dt><dd>{selectedVehicle.speed} km/h</dd></div>{selectedVehicle.address && <div className="dl-wide"><dt>{locale === "fr" ? "Position" : locale === "nl" ? "Locatie" : "Location"}</dt><dd>{selectedVehicle.address}</dd></div>}</dl>
              </> : <>
                <div><span className="truck-badge" style={selected.sendatrackVehicleId ? { background: truckBadgeColor(vehicleTruckNumbers.get(selected.sendatrackVehicleId) ?? null) } : undefined}>▰</span><p>
                  {renamingVehicleId && renamingVehicleId === selected.sendatrackVehicleId
                    ? <span className="rename-truck"><input value={renameDraft} maxLength={60} disabled={renameBusy} onChange={(event) => setRenameDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void renameVehicle(renamingVehicleId); if (event.key === "Escape") setRenamingVehicleId(null); }} /><button type="button" disabled={renameBusy} aria-label={locale === "fr" ? "Confirmer le nom" : locale === "nl" ? "Naam bevestigen" : "Confirm name"} onClick={() => void renameVehicle(renamingVehicleId)}>✓</button><button type="button" disabled={renameBusy} aria-label={t.cancel} onClick={() => setRenamingVehicleId(null)}>×</button></span>
                    : <><strong>{truckNumberLabel(selected.sendatrackVehicleId) && <b className="truck-number-badge" style={{ background: truckBadgeColor((selected.sendatrackVehicleId ? vehicleTruckNumbers.get(selected.sendatrackVehicleId) : undefined) ?? null) }}>{truckNumberLabel(selected.sendatrackVehicleId)}</b>}<span className="truck-name-text" title={vehicleLabel(selected)}>{vehicleLabel(selected)}</span></strong>{company?.role === "dispatcher" && !isUnassignedVehicle(selected) && integration.vehicles.some((vehicle) => vehicle.id === selected.sendatrackVehicleId) && <button type="button" className="rename-trigger" aria-label={locale === "fr" ? "Renommer ce véhicule" : locale === "nl" ? "Dit voertuig hernoemen" : "Rename this vehicle"} onClick={() => { setRenamingVehicleId(selected.sendatrackVehicleId ?? null); setRenameDraft(selected.truck); }}>✎</button>}</>}
                  <small>{isUnassignedVehicle(selected) ? (locale === "fr" ? "Aucun camion confirmé" : locale === "nl" ? "Nog geen voertuig bevestigd" : "No truck confirmed yet") : driverLabel(selected.driver)}</small>
                </p><button aria-label={t.closeDetails} onClick={() => setShowPopover(false)}>×</button></div>
                <dl><div className="dl-wide"><dt>{t.delivery}</dt><dd title={selected.id}>{selected.id}</dd></div><div><dt>{t.status}</dt><dd><i />{t.statuses[selected.status]}</dd></div><div><dt>{t.eta}</dt><dd>{selected.estimatedArrivalAt ? new Date(selected.estimatedArrivalAt).toLocaleString(locale === "fr" ? "fr-BE" : locale === "nl" ? "nl-BE" : "en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : selected.eta}</dd></div>{selected.weightKg != null && <div><dt>{locale === "fr" ? "Poids" : locale === "nl" ? "Gewicht" : "Weight"}</dt><dd>{selected.weightKg.toLocaleString(locale === "fr" ? "fr-BE" : locale === "nl" ? "nl-BE" : "en-GB", { maximumFractionDigits: 3 })} kg</dd></div>}{selected.priceAmount != null && selected.priceCurrency && <div><dt>{locale === "fr" ? "Prix" : locale === "nl" ? "Prijs" : "Price"}</dt><dd>{selected.priceAmount.toLocaleString(locale === "fr" ? "fr-BE" : locale === "nl" ? "nl-BE" : "en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {selected.priceCurrency}</dd></div>}{integration.vehicles.find((vehicle) => vehicle.id === selected.sendatrackVehicleId)?.address && <div className="dl-wide"><dt>{locale === "fr" ? "Position" : locale === "nl" ? "Locatie" : "Location"}</dt><dd>{integration.vehicles.find((vehicle) => vehicle.id === selected.sendatrackVehicleId)?.address}</dd></div>}</dl>{selected.estimatedArrivalAt && <div className="eta-explanation"><strong>{selectedEtaExplanation.sourceLabel}</strong><span>{selectedEtaExplanation.confidenceLabel}{selected.etaSource === "route-history" && selected.etaHistoricalSpeedKmh ? ` · ${selected.etaHistoricalSpeedKmh} km/h` : ""}</span></div>}
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
                {company?.role === "agency" && selected.destinationSiteId === company.siteId && <div className="popover-actions"><button type="button" onClick={() => void notifyArrivalForDelivery(selected.id, selected.destinationSiteId)}>{locale === "fr" ? "Notifier par WhatsApp" : locale === "nl" ? "Melden via WhatsApp" : "Notify via WhatsApp"}</button></div>}
                {company?.role === "dispatcher" && selected.status === "Loading" && <div className="popover-actions"><button type="button" onClick={() => void notifyDepartureForDelivery(selected.id)}>{locale === "fr" ? "Notifier par WhatsApp" : locale === "nl" ? "Melden via WhatsApp" : "Notify via WhatsApp"}</button></div>}
              </>}
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
                    {integration.vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{truckNumberLabel(vehicle.id) ? `${truckNumberLabel(vehicle.id)} · ${vehicle.name}` : vehicle.name}</option>)}
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

      {modalOpen && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="new-delivery-title"><div className="modal-header"><div><p className="eyebrow">{editingDeliveryId ? (locale === "fr" ? "MODIFIER" : locale === "nl" ? "BEWERKEN" : "EDIT") : t.createEyebrow}</p><h2 id="new-delivery-title">{editingDeliveryId ? (locale === "fr" ? "Modifier la livraison" : locale === "nl" ? "Zending bewerken" : "Edit delivery") : t.createTitle}</h2><span>{editingDeliveryId ? (locale === "fr" ? "Le camion et la date de départ utilisent leurs propres confirmations, séparées de l’enregistrement du reste." : locale === "nl" ? "Voertuig en vertrekdatum gebruiken hun eigen bevestiging, los van het opslaan van de rest." : "Truck and departure date are confirmed separately from saving the rest.") : (integration.connected ? t.createHelpAutomatic : t.createHelp)}</span></div><button onClick={closeCreateModal} aria-label={t.close}>×</button></div><form onSubmit={createDelivery} ref={creationFormRef}><div className="form-row"><label>{locale === "fr" ? "Site de départ" : locale === "nl" ? "Vertreklocatie" : "Origin site"}<select name="originSiteId" required value={defaultOriginSiteId} disabled={company?.role === "agency" || Boolean(editingDeliveryId)} onChange={(event) => { const siteId = event.target.value; setDefaultOriginSiteId(siteId); if (company) window.localStorage.setItem(originPreferenceKey(company), siteId); }}><option value="" disabled>{locale === "fr" ? "Choisir le site" : locale === "nl" ? "Kies locatie" : "Choose site"}</option>{knownSites.filter((site) => site.roles.includes("origin") && (company?.role !== "agency" || site.id === company.siteId)).map((site) => <option key={site.id} value={site.id}>{site.label}</option>)}</select><small>{company?.role === "agency" ? (locale === "fr" ? "Les colis enregistrés sont automatiquement rattachés à votre agence." : locale === "nl" ? "Geregistreerde zendingen worden automatisch aan uw agentschap gekoppeld." : "Registered parcels are automatically assigned to your agency.") : (locale === "fr" ? "Ce choix sera mémorisé pour cet utilisateur sur ce navigateur." : locale === "nl" ? "Deze keuze wordt voor deze gebruiker in deze browser onthouden." : "This choice will be remembered for this user on this browser.")}</small></label><label>{t.destination}<select name="destinationSiteId" required value={creationDestinationSiteId} onChange={(event) => setCreationDestinationSiteId(event.target.value)}><option value="" disabled>{locale === "fr" ? "Choisir l'agence" : locale === "nl" ? "Kies agentschap" : "Choose agency"}</option>{knownSites.filter((site) => site.roles.includes("destination") && (company?.role !== "agency" || site.country !== creationOriginCountry)).map((site) => <option key={site.id} value={site.id}>{site.label}</option>)}</select></label></div><div className="form-section"><strong>{locale === "fr" ? "Expéditeur / client" : locale === "nl" ? "Afzender / klant" : "Sender / customer"}</strong><div className="form-row"><label>{t.customerCompany}<input name="customer" required placeholder={t.customerPlaceholder} defaultValue={creationDraftSeed?.customer ?? ""} /></label><label><span className="field-label">{t.customerContact} <span>({t.optional})</span></span><input name="contact" inputMode="tel" autoComplete="tel" placeholder="+32… / +212…" defaultValue={creationDraftSeed?.contact ?? ""} /></label></div><div className="form-row"><label><span className="field-label">{locale === "fr" ? "E-mail du client" : locale === "nl" ? "E-mail klant" : "Customer email"} <span>({t.optional})</span></span><input name="customerEmail" type="email" autoComplete="email" placeholder="client@exemple.com" defaultValue={creationDraftSeed?.customerEmail ?? ""} /></label></div><small>{locale === "fr" ? "L'e-mail reçoit les mêmes mises à jour de suivi, sans consentement séparé à cocher." : locale === "nl" ? "Dit e-mailadres ontvangt dezelfde trackingupdates, zonder aparte toestemming aan te vinken." : "This email receives the same tracking updates, no separate consent checkbox needed."}</small></div><div className="form-section"><strong>{locale === "fr" ? "Personne qui reçoit le colis" : locale === "nl" ? "Ontvanger van het pakket" : "Parcel recipient"}</strong><div className="form-row"><label><span className="field-label">{locale === "fr" ? "Nom du destinataire" : locale === "nl" ? "Naam ontvanger" : "Recipient name"} <span>({t.optional})</span></span><input name="recipientName" autoComplete="name" placeholder={locale === "fr" ? "Nom et prénom" : locale === "nl" ? "Voor- en achternaam" : "Full name"} defaultValue={creationDraftSeed?.recipientName ?? ""} /></label><label><span className="field-label">{locale === "fr" ? "Téléphone du destinataire" : locale === "nl" ? "Telefoon ontvanger" : "Recipient phone"} <span>({t.optional})</span></span><input name="recipientContact" inputMode="tel" autoComplete="tel" placeholder="+32… / +212…" defaultValue={creationDraftSeed?.recipientContact ?? ""} /></label></div><small>{locale === "fr" ? "Renseignez le nom et le téléphone ensemble. Le destinataire recevra les mêmes mises à jour utiles." : locale === "nl" ? "Vul naam en telefoon samen in. De ontvanger krijgt dezelfde nuttige updates." : "Enter name and phone together. The recipient receives the same useful updates."}</small></div><div className="parcel-list">{parcelDrafts.map((parcel, index) => { const preview = creationPricePreviewFor(parcel.weightKg); return <div className="form-row parcel-row" key={parcel.key}>{parcelDrafts.length > 1 && <div className="parcel-row-head">{locale === "fr" ? `Colis ${index + 1}` : locale === "nl" ? `Pakket ${index + 1}` : `Parcel ${index + 1}`}</div>}<label><span className="field-label">{locale === "fr" ? "Poids du colis" : locale === "nl" ? "Gewicht zending" : "Parcel weight"} <span>({t.optional})</span></span><input type="number" min="0.001" max="100000" step="0.001" inputMode="decimal" placeholder="kg" value={parcel.weightKg} onChange={(event) => { const value = event.target.value; setParcelDrafts((rows) => rows.map((row) => row.key === parcel.key ? { ...row, weightKg: value } : row)); }} /><small>{locale === "fr" ? "Laissez vide pour un objet volumineux (machine à laver, télé…)" : locale === "nl" ? "Laat leeg voor een groot voorwerp (wasmachine, tv…)" : "Leave blank for a bulky item (washing machine, TV…)"}</small></label><label>{parcel.weightKg ? (locale === "fr" ? "Prix calculé" : locale === "nl" ? "Berekende prijs" : "Calculated price") : (locale === "fr" ? "Prix manuel" : locale === "nl" ? "Handmatige prijs" : "Manual price")}{parcel.weightKg ? <div className="price-preview">{preview.priceAmount != null ? <strong>{preview.priceAmount.toLocaleString(locale === "fr" ? "fr-BE" : locale === "nl" ? "nl-BE" : "en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {preview.priceCurrency}</strong> : <span>{locale === "fr" ? "Renseignez le poids" : locale === "nl" ? "Vul het gewicht in" : "Enter the weight"}</span>}</div> : <input type="number" min="0.01" max="1000000" step="0.01" inputMode="decimal" placeholder={creationOriginCountry === "MA" ? "MAD" : "EUR"} value={parcel.manualPriceAmount} onChange={(event) => { const value = event.target.value; setParcelDrafts((rows) => rows.map((row) => row.key === parcel.key ? { ...row, manualPriceAmount: value } : row)); }} />}<small>{parcel.weightKg ? (creationOriginCountry === "MA" ? (locale === "fr" ? "15 DH/kg au départ du Maroc" : locale === "nl" ? "15 DH/kg vanuit Marokko" : "15 MAD/kg from Morocco") : (locale === "fr" ? "1,50 €/kg" : locale === "nl" ? "1,50 €/kg" : "1.50 EUR/kg")) : (locale === "fr" ? "Objet volumineux : indiquez le prix directement" : locale === "nl" ? "Groot voorwerp: geef de prijs rechtstreeks op" : "Bulky item: enter the price directly")}</small></label>{!parcel.weightKg && <label>{locale === "fr" ? "Description de l'objet" : locale === "nl" ? "Omschrijving van het voorwerp" : "Item description"}<input type="text" required maxLength={200} placeholder={locale === "fr" ? "Ex. : télévision, lave-linge…" : locale === "nl" ? "Bijv. televisie, wasmachine…" : "E.g. TV, washing machine…"} value={parcel.itemDescription} onChange={(event) => { const value = event.target.value; setParcelDrafts((rows) => rows.map((row) => row.key === parcel.key ? { ...row, itemDescription: value } : row)); }} /><small>{locale === "fr" ? "Obligatoire pour un objet non pesé, pour le distinguer des autres colis." : locale === "nl" ? "Verplicht voor een niet-gewogen voorwerp, om het van andere zendingen te onderscheiden." : "Required for an unweighed item, to tell it apart from other parcels."}</small></label>}{parcelDrafts.length > 1 && <button type="button" className="remove-parcel-row" aria-label={locale === "fr" ? "Retirer ce colis" : locale === "nl" ? "Dit pakket verwijderen" : "Remove this parcel"} onClick={() => setParcelDrafts((rows) => rows.filter((row) => row.key !== parcel.key))}>×</button>}</div>; })}{!editingDeliveryId && <button type="button" className="add-parcel-row" onClick={() => setParcelDrafts((rows) => [...rows, { key: crypto.randomUUID(), weightKg: "", manualPriceAmount: "", itemDescription: "" }])}>{locale === "fr" ? "+ Ajouter un colis pour ce client" : locale === "nl" ? "+ Pakket toevoegen voor deze klant" : "+ Add another parcel for this customer"}</button>}</div><div className="form-row"><label><span className="field-label">{locale === "fr" ? "Date de départ" : locale === "nl" ? "Vertrekdatum" : "Departure date"} <span>({t.optional})</span></span><input type="datetime-local" name="nextTruckDepartureAt" value={creationDepartureAt} onChange={(event) => setCreationDepartureAt(event.target.value)} /></label><label>{locale === "fr" ? "Date d'arrivée estimée" : locale === "nl" ? "Geschatte aankomstdatum" : "Estimated arrival date"}<div className="price-preview">{creationEstimatedArrival ? <strong>{creationEstimatedArrival.toLocaleString(locale === "fr" ? "fr-BE" : locale === "nl" ? "nl-BE" : "en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</strong> : <span>{locale === "fr" ? "Choisissez l'agence et la date de départ" : locale === "nl" ? "Kies het agentschap en de vertrekdatum" : "Choose the agency and departure date"}</span>}</div><small>{locale === "fr" ? "Calculée automatiquement selon le délai CTM de l'agence de destination." : locale === "nl" ? "Automatisch berekend volgens de CTM-termijn van het bestemmingsagentschap." : "Calculated automatically from the destination agency's CTM transit time."}</small></label></div>{company?.role === "dispatcher" && integration.connected && integration.vehicles.length > 0 && <div className="form-row"><label><span className="field-label">{locale === "fr" ? "Camion" : locale === "nl" ? "Vrachtwagen" : "Truck"} <span>({t.optional})</span></span><select value={creationVehicleId} onChange={(event) => setCreationVehicleId(event.target.value)}><option value="">{locale === "fr" ? "À affecter plus tard" : locale === "nl" ? "Later toewijzen" : "Assign later"}</option>{integration.vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{truckNumberLabel(vehicle.id) ? `${truckNumberLabel(vehicle.id)} · ${vehicle.name}` : vehicle.name}</option>)}</select>{editingDeliveryId && creationVehicleId && vehicleAssignmentConflict(creationVehicleId, editingDeliveryId) ? <small className="warning">{locale === "fr" ? `⚠ Ce camion est encore en route (${vehicleAssignmentConflict(creationVehicleId, editingDeliveryId)!.id}). Vérifiez qu'il sera bien de retour.` : locale === "nl" ? `⚠ Dit voertuig is nog onderweg (${vehicleAssignmentConflict(creationVehicleId, editingDeliveryId)!.id}). Controleer of het op tijd terug is.` : `⚠ This truck is still en route (${vehicleAssignmentConflict(creationVehicleId, editingDeliveryId)!.id}). Confirm it will actually be back.`}</small> : !editingDeliveryId && creationVehicleId && vehicleCurrentlyEnRoute(creationVehicleId) ? <small className="warning">{locale === "fr" ? "⚠ Ce camion est déjà en route : la livraison démarrera directement à son niveau de progression actuel, pas à 0 %. Normal pour un ramassage en cours de route ; sinon attendez son prochain départ ou choisissez « À affecter plus tard »." : locale === "nl" ? "⚠ Dit voertuig is al onderweg: de zending start meteen op de huidige voortgang, niet op 0%. Normaal bij een tussentijdse ophaling; kies anders \"Later toewijzen\" of wacht op het volgende vertrek." : "⚠ This truck is already en route: the delivery will start directly at its current progress, not 0%. Expected for a mid-route pickup; otherwise wait for its next departure or choose \"Assign later\"."}</small> : <small>{locale === "fr" ? "Le dernier camion choisi est mémorisé pour la prochaine création." : locale === "nl" ? "De laatst gekozen vrachtwagen wordt onthouden voor de volgende aanmaak." : "The last truck you chose is remembered for the next delivery."}</small>}</label></div>}{!editingDeliveryId && features.whatsappAvailable && <label className="consent-choice"><input type="checkbox" name="whatsappOptIn" defaultChecked={creationDraftSeed?.whatsappOptIn ?? false} /><span>{locale === "fr" ? "Nouveau consentement WhatsApp confirmé pour les numéros renseignés" : locale === "nl" ? "Nieuwe WhatsApp-toestemming bevestigd voor de ingevulde nummers" : "New WhatsApp consent confirmed for the entered numbers"}<small>{locale === "fr" ? "Inutile de cocher si ce numéro a déjà consenti auparavant : TrackFleet le reconnaît automatiquement. Le consentement peut toujours être retiré." : locale === "nl" ? "Niet nodig als dit nummer eerder toestemming gaf: TrackFleet herkent dit automatisch. Toestemming kan altijd worden ingetrokken." : "Do not check this when the number already consented: TrackFleet remembers it automatically. Consent can always be withdrawn."}</small></span></label>}<div className="modal-footer"><button type="button" onClick={closeCreateModal}>{t.cancel}</button><button className="primary-button" type="submit" disabled={creating}>{creating ? t.creating : editingDeliveryId ? (locale === "fr" ? "Enregistrer les modifications" : locale === "nl" ? "Wijzigingen opslaan" : "Save changes") : t.createDelivery}<span>→</span></button></div></form></section></div>}

      {demoModalOpen && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="demo-delivery-title"><div className="modal-header"><div><p className="eyebrow">{locale === "fr" ? "DÉMONSTRATION" : locale === "nl" ? "DEMONSTRATIE" : "DEMO"}</p><h2 id="demo-delivery-title">{locale === "fr" ? "Créer une livraison démo" : locale === "nl" ? "Demozending aanmaken" : "Create demo delivery"}</h2><span>{locale === "fr" ? "Pour montrer la notification WhatsApp d’arrivée sans attendre un vrai camion." : locale === "nl" ? "Om de WhatsApp-aankomstmelding te tonen zonder op een echte vrachtwagen te wachten." : "To show off the WhatsApp arrival notification without waiting for a real truck."}</span></div><button onClick={() => setDemoModalOpen(false)} aria-label={t.close}>×</button></div><form onSubmit={createDemoDelivery}><div className="form-row"><label>{locale === "fr" ? "Numéro WhatsApp à utiliser pour la démo" : locale === "nl" ? "WhatsApp-nummer voor de demo" : "WhatsApp number to demo with"}<input value={demoContact} onChange={(event) => setDemoContact(event.target.value)} inputMode="tel" autoComplete="tel" placeholder="+32… / +212…" required /></label><label>{locale === "fr" ? "Agence de destination" : locale === "nl" ? "Bestemmingsagentschap" : "Destination agency"}<select value={demoDestinationSiteId} onChange={(event) => setDemoDestinationSiteId(event.target.value)} required><option value="" disabled>{locale === "fr" ? "Choisir l'agence" : locale === "nl" ? "Kies agentschap" : "Choose agency"}</option>{knownSites.filter((site) => site.roles.includes("destination")).map((site) => <option key={site.id} value={site.id}>{site.label}</option>)}</select></label></div><small>{locale === "fr" ? "Une livraison réelle et marquée [DEMO] sera créée et apparaîtra immédiatement dans le tableau de bord de cette agence." : locale === "nl" ? "Er wordt een echte, als [DEMO] gemarkeerde zending aangemaakt die meteen verschijnt in het dashboard van dit agentschap." : "A real delivery marked [DEMO] will be created and will appear immediately in that agency's dashboard."}</small><div className="modal-footer"><button type="button" onClick={() => setDemoModalOpen(false)}>{t.cancel}</button><button className="primary-button" type="submit" disabled={demoBusy}>{demoBusy ? t.creating : (locale === "fr" ? "Créer" : locale === "nl" ? "Aanmaken" : "Create")}<span>→</span></button></div></form></section></div>}

      {companySettingsOpen && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="company-settings-title"><div className="modal-header"><div><p className="eyebrow">{locale === "fr" ? "IDENTITÉ VISUELLE" : locale === "nl" ? "HUISSTIJL" : "BRANDING"}</p><h2 id="company-settings-title">{locale === "fr" ? "Paramètres de l’entreprise" : locale === "nl" ? "Bedrijfsinstellingen" : "Company settings"}</h2><span>{locale === "fr" ? "Votre nom, logo et couleur remplacent la marque TrackFleet sur la page de suivi client et dans le tableau de bord." : locale === "nl" ? "Uw naam, logo en kleur vervangen het TrackFleet-merk op de klant-trackingpagina en in het dashboard." : "Your name, logo and color replace TrackFleet's branding on the customer tracking page and in the dashboard."}</span></div><button onClick={() => setCompanySettingsOpen(false)} aria-label={t.close}>×</button></div><form onSubmit={saveCompanySettings}><div className="form-row"><label>{locale === "fr" ? "Nom de l’entreprise" : locale === "nl" ? "Bedrijfsnaam" : "Company name"}<input value={companySettingsName} onChange={(event) => setCompanySettingsName(event.target.value)} maxLength={80} placeholder="TrackFleet" /></label><label>{locale === "fr" ? "Couleur de la marque" : locale === "nl" ? "Merkkleur" : "Brand color"}<input type="color" value={companySettingsColor} onChange={(event) => setCompanySettingsColor(event.target.value)} /></label></div><label>{locale === "fr" ? "Logo" : "Logo"}<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleLogoFileChange(file); }} /></label>{companySettingsLogoDataUrl && <div className="company-logo-preview"><img src={companySettingsLogoDataUrl} alt="" />{/* eslint-disable-line @next/next/no-img-element -- a client-generated data: URI, not a static/remote asset Next's image pipeline could optimize */}<button type="button" onClick={() => setCompanySettingsLogoDataUrl(null)}>{locale === "fr" ? "Retirer le logo" : locale === "nl" ? "Logo verwijderen" : "Remove logo"}</button></div>}<small>{locale === "fr" ? "Laissez le nom vide pour garder la marque TrackFleet par défaut." : locale === "nl" ? "Laat de naam leeg om de standaard TrackFleet-branding te behouden." : "Leave the name blank to keep the default TrackFleet branding."}</small><div className="form-section"><strong>{locale === "fr" ? "Automatisation" : locale === "nl" ? "Automatisering" : "Automation"}</strong><div className="toggle-row"><div><span className="field-label">{locale === "fr" ? "Complétion automatique du relais CTM" : locale === "nl" ? "Automatische CTM-relaisafronding" : "Automatic CTM relay completion"}</span><small>{locale === "fr" ? "Si désactivé, une agence en relais (hors Casablanca/Tanger Med) attend toujours une confirmation manuelle — jamais de bascule automatique." : locale === "nl" ? "Indien uitgeschakeld wacht een relaisagentschap (buiten Casablanca/Tanger Med) altijd op een handmatige bevestiging — nooit een automatische overgang." : "When off, a relay agency (outside Casablanca/Tanger Med) always waits for a manual confirmation — never an automatic switch."}</small></div><label className="toggle-switch"><input type="checkbox" checked={companySettingsCtmRelayAutoEnabled} onChange={(event) => setCompanySettingsCtmRelayAutoEnabled(event.target.checked)} aria-label={locale === "fr" ? "Complétion automatique du relais CTM" : locale === "nl" ? "Automatische CTM-relaisafronding" : "Automatic CTM relay completion"} /><span /></label></div><div className="form-row"><label>{locale === "fr" ? "Délai de déchargement (minutes)" : locale === "nl" ? "Losvertraging (minuten)" : "Unloading grace period (minutes)"}<input type="number" min={15} max={720} value={companySettingsUnloadGraceMinutes} onChange={(event) => setCompanySettingsUnloadGraceMinutes(event.target.value)} placeholder="120" /></label><label>{locale === "fr" ? "Délai relais CTM (heures)" : locale === "nl" ? "CTM-relaisvertraging (uren)" : "CTM relay grace period (hours)"}<input type="number" min={1} max={168} value={companySettingsCtmRelayGraceHours} onChange={(event) => setCompanySettingsCtmRelayGraceHours(event.target.value)} placeholder="24" disabled={!companySettingsCtmRelayAutoEnabled} /></label></div><small>{locale === "fr" ? "Laissez vide pour garder les délais par défaut (2h de déchargement, 24h de relais)." : locale === "nl" ? "Laat leeg om de standaardtijden te behouden (2u lossen, 24u relais)." : "Leave blank to keep the default timings (2h unloading, 24h relay)."}</small></div><div className="modal-footer"><button type="button" onClick={() => setCompanySettingsOpen(false)}>{t.cancel}</button><button className="primary-button" type="submit" disabled={companySettingsSaving}>{companySettingsSaving ? (locale === "fr" ? "Enregistrement…" : locale === "nl" ? "Opslaan…" : "Saving…") : (locale === "fr" ? "Enregistrer" : locale === "nl" ? "Opslaan" : "Save")}<span>→</span></button></div></form></section></div>}
      {toast && <div className="toast" role="status" aria-live="polite"><span>✓</span>{toast}</div>}
    </main>
  );
  }
  return renderDashboard();
}
