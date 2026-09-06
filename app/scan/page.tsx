"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { isValidParcelCode } from "../lib/parcel-code";

declare global {
  interface Window {
    // Experimental Web API (Chrome/Edge/Android; not yet in lib.dom.d.ts).
    // Feature-detected below -- jsQR is the fallback for browsers without it
    // (notably Safari/iOS at time of writing).
    BarcodeDetector?: new (options: { formats: string[] }) => {
      detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>;
    };
  }
}

// "Départ" is detected from truck GPS, so no scan checkpoint exists for
// it. "Arrivée hub" is audit-only proof of an intermediate unload, never a
// final delivery. "Livré" is the real final-delivery confirmation -- the
// same effect the dashboard's "Confirmer l'arrivée" button triggers
// (see confirm-arrival-manually.ts), just reached via a QR scan at the
// destination agency instead of a dispatcher clicking a button.
type Checkpoint = "loaded" | "arrived" | "delivered";
type CompanyInfo = { account: string; role: "dispatcher" | "agency"; siteId: string | null };
type ScanOutcome = "success" | "duplicate" | "error";
type ScanLogEntry = { at: Date; checkpoint: Checkpoint; outcome: ScanOutcome; label: string };
type PendingItem = { id: string; shortCode: string | null; customer: string; destination: string; truck: string };

const CHECKPOINTS: Array<{ value: Checkpoint; label: string; help: string }> = [
  { value: "loaded", label: "Chargé", help: "Preuve que ce colis est monté dans le camion." },
  { value: "arrived", label: "Déchargé au hub", help: "Preuve que ce colis a été déchargé au hub. Cela ne confirme jamais une arrivée finale." },
  { value: "delivered", label: "Livré à l'agence", help: "Confirme l'arrivée finale à l'agence de destination. Nécessite d'avoir déjà scanné « Chargé » et « Déchargé au hub »." },
];

const RESUBMIT_COOLDOWN_MS = 2500;
const SCAN_INTERVAL_MS = 350;

// Errors worth an explicit dismiss instead of auto-clearing after ~1s -- a
// real, actionable mismatch someone could otherwise scan straight past in a
// fast rhythm. Routine outcomes (code not found, network hiccup) keep the
// old auto-clear behavior.
const severeScanErrors = new Set(["agency_destination_mismatch", "already_delivered", "arrival_blocked_missing_scans", "checkpoint_locked"]);

// Accepts either the bare code or the full deep-link URL the printed QR
// encodes (see parcel-code.ts's parcelScanUrl) -- a handheld Code128
// scanner typing the bare code in like a keyboard, or the phone's own
// camera app opening the URL, both need to resolve to the same code.
function extractParcelCode(raw: string): string | null {
  const trimmed = raw.trim();
  try {
    const url = new URL(trimmed);
    const fromUrl = url.searchParams.get("code");
    if (fromUrl) return fromUrl.trim().toUpperCase();
  } catch {
    // Not a URL -- fall through to treating it as a bare code.
  }
  return trimmed.toUpperCase();
}

function playBeep(ok: boolean) {
  try {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.frequency.value = ok ? 880 : 320;
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.15);
    oscillator.onended = () => void ctx.close();
  } catch {
    // Audio isn't available in every context (e.g. no user gesture yet) --
    // the vibration + visual feedback still confirm the scan either way.
  }
}

export default function ScanPage() {
  const [auth, setAuth] = useState<"loading" | "ready" | "denied">("loading");
  const [company, setCompany] = useState<CompanyInfo | null>(null);
  // A device paired purely for scanning (via /scan/connect's QR) only ever
  // gets a scanner-scoped session (see /api/scan/session), never a full
  // dispatcher login -- "← Tableau" linking to "/" on that device landed on
  // the SENDATRACK login screen instead of a dashboard, since getCompanySession
  // doesn't accept a scanner session. Reported live as the link "not working".
  const [scannerOnly, setScannerOnly] = useState(false);
  const [deviceLabel, setDeviceLabel] = useState<string | null>(null);
  // Set when this device was paired for one fixed post (see
  // /scan/connect) -- the checkpoint picker below is hidden entirely
  // instead of just pre-selected, since the whole point is removing the
  // choice, not just defaulting it (live feedback: "l'employé qui reçoit
  // le lien doit choisir où c'est... ça peut porter à confusion").
  const [lockedCheckpoint, setLockedCheckpoint] = useState<Checkpoint | null>(null);
  const [mode, setMode] = useState<Checkpoint>("loaded");
  const [cameraState, setCameraState] = useState<"idle" | "starting" | "active" | "error">("idle");
  const [cameraError, setCameraError] = useState("");
  const [manualCode, setManualCode] = useState(() => {
    if (typeof window === "undefined") return "";
    const code = new URLSearchParams(window.location.search).get("code");
    return code ? code.toUpperCase() : "";
  });
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<ScanOutcome | null>(null);
  const [message, setMessage] = useState("");
  // The scanned parcel's own short code (e.g. "CAS 05"), shown large and
  // separately from `message`'s customer/destination detail -- see
  // submitScan's own comment.
  const [flashShortCode, setFlashShortCode] = useState<string | null>(null);
  const [log, setLog] = useState<ScanLogEntry[]>([]);
  // Live request: "I wanna have at least a list of the parcels they are
  // supposed to still scan" -- scoped server-side per checkpoint (see
  // /api/scan/pending), refetched after every real scan so it shrinks live
  // instead of the person having to keep their own mental count.
  const [pending, setPending] = useState<{ checkpoint: Checkpoint; groupByTruck: boolean; items: PendingItem[] } | null>(null);
  const [pendingOpen, setPendingOpen] = useState(false);
  // A genuine mismatch (wrong agency, wrong post, blocked arrival) stays on
  // screen until explicitly dismissed instead of auto-clearing after ~1s
  // like a routine error -- live request: keep employees from scanning
  // straight past a real mistake in a fast rhythm. Routine errors (code not
  // found, network hiccup) keep the old auto-clear behavior.
  const [errorDismissible, setErrorDismissible] = useState(false);
  // The "delivered" checkpoint's phone position didn't match the
  // destination agency's own known location (see scan/route.ts's
  // AGENCY_LOCATION_MISMATCH_RADIUS_KM check) -- a two-step confirm, same
  // shape as the missing-scans bypass, rather than a silent pass or a hard
  // block: the person scanning explicitly asserts this really is the right
  // agency before it's recorded (and recorded as an explicit bypass either
  // way, visible later on the delivery).
  const [locationMismatch, setLocationMismatch] = useState<{ code: string; distanceKm: number; agencyLabel: string } | null>(null);
  // A real (non-duplicate) "Chargé" scan can be undone within a short
  // window -- live request: let someone who scanned the wrong parcel while
  // loading fix it themselves. Scoped to "loaded" only (see
  // /api/scan/undo's own comment for why "arrived"/"delivered" don't get
  // the same treatment).
  const [undo, setUndo] = useState<{ scanId: string; deliveryId: string; label: string } | null>(null);
  const [undoing, setUndoing] = useState(false);
  const undoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<InstanceType<NonNullable<Window["BarcodeDetector"]>> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const detectingRef = useRef(false);
  const lastSubmissionRef = useRef<{ code: string; at: number } | null>(null);
  const modeRef = useRef(mode);
  const busyRef = useRef(busy);
  // While a dismissible error or a location-mismatch confirm is on screen,
  // the camera loop pauses instead of silently scanning past it in the
  // background -- the whole point of making these "harder to miss" is
  // requiring an explicit acknowledgment, not just a louder banner.
  const blockedRef = useRef(false);
  // Best-effort, roughly-where-this-phone-is-right-now position, kept fresh
  // in the background for the whole scanning session -- never blocks a
  // scan waiting on a fix, and never required (a scan with no known
  // position just falls back to the existing truck-GPS-based label
  // server-side, see /api/scan/route.ts). Low accuracy on purpose: this is
  // routine per-scan proof, not the one-time precise agency pin capture in
  // AgencyLocationSetup.tsx, which needs a much tighter fix and can afford
  // to take its time getting one.
  const positionRef = useRef<{ latitude: number; longitude: number } | null>(null);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { busyRef.current = busy; }, [busy]);
  useEffect(() => { blockedRef.current = errorDismissible || locationMismatch !== null; }, [errorDismissible, locationMismatch]);

  const refreshPending = useCallback(async (checkpoint: Checkpoint) => {
    try {
      const response = await fetch(`/api/scan/pending?checkpoint=${checkpoint}`, { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json() as { checkpoint: Checkpoint; groupByTruck: boolean; items: PendingItem[] };
      setPending(data);
    } catch {
      // Best-effort -- a failed refresh just leaves the previous list
      // showing rather than blocking scanning itself.
    }
  }, []);

  useEffect(() => {
    if (auth !== "ready") return;
    queueMicrotask(() => { void refreshPending(mode); });
  }, [auth, mode, refreshPending]);

  useEffect(() => {
    let active = true;
    const pairCode = new URLSearchParams(window.location.search).get("pair");
    const activate = pairCode
      ? fetch("/api/scan/pair/consume", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: pairCode }),
      }).then(() => window.history.replaceState({}, "", "/scan"))
      : Promise.resolve();
    void activate.then(() => fetch("/api/scan/session", { cache: "no-store" }))
      .then((response) => response.json() as Promise<{ authenticated: boolean; scannerOnly?: boolean; deviceLabel?: string | null; checkpoint?: Checkpoint | null; company?: CompanyInfo }>)
      .then((data) => {
        if (!active) return;
        if (data.authenticated && data.company) {
          setCompany(data.company);
          setScannerOnly(data.scannerOnly === true);
          setDeviceLabel(data.deviceLabel ?? null);
          if (data.checkpoint) {
            setLockedCheckpoint(data.checkpoint);
            setMode(data.checkpoint);
          }
          setAuth("ready");
        } else {
          setAuth("denied");
        }
      })
      .catch(() => { if (active) setAuth("denied"); });
    return () => { active = false; };
  }, []);


  const submitScan = useCallback(async (code: string, options?: { bypassLocationMismatch?: boolean }) => {
    if (!isValidParcelCode(code)) {
      setFlash("error");
      setErrorDismissible(false);
      setMessage("Code invalide.");
      playBeep(false);
      window.setTimeout(() => setFlash(null), 900);
      return;
    }
    if (!options?.bypassLocationMismatch) {
      const now = Date.now();
      const last = lastSubmissionRef.current;
      if (last && last.code === code && now - last.at < RESUBMIT_COOLDOWN_MS) return;
      lastSubmissionRef.current = { code, at: now };
    }
    setLocationMismatch(null);

    setBusy(true);
    try {
      const response = await fetch("/api/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          parcelCode: code,
          checkpoint: modeRef.current,
          latitude: positionRef.current?.latitude ?? null,
          longitude: positionRef.current?.longitude ?? null,
          bypassLocationMismatch: options?.bypassLocationMismatch === true,
        }),
      });
      const data = await response.json() as {
        ok?: boolean; duplicate?: boolean; error?: string;
        missingLoadedScan?: boolean; missingHubScan?: boolean; distanceKm?: number; agencyLabel?: string;
        scanId?: string | null;
        delivery?: { id: string; customer: string; destination: string; status: string; shortCode: string | null } | null;
      };
      if (data.error === "location_mismatch") {
        // Not a terminal error -- a two-step confirm, same shape as the
        // missing-scans bypass on the dashboard button: the person scanning
        // sees exactly why this looks wrong and explicitly asserts it's
        // right before it's recorded (and recorded as a bypass either way).
        setLocationMismatch({ code, distanceKm: data.distanceKm ?? 0, agencyLabel: data.agencyLabel ?? "" });
        playBeep(false);
        if (navigator.vibrate) navigator.vibrate([80, 60, 80]);
        return;
      }
      if (!response.ok || !data.ok) {
        const dismissible = Boolean(data.error && severeScanErrors.has(data.error));
        setFlash("error");
        setErrorDismissible(dismissible);
        setMessage(
          data.error === "parcel_not_found" ? "Colis introuvable."
          : data.error === "agency_destination_mismatch" ? "Ce colis n'est pas destiné à cette agence."
          : data.error === "already_delivered" ? "Ce colis est déjà marqué livré."
          : data.error === "arrival_blocked_missing_scans" ? `Scans manquants avant la livraison : ${[data.missingLoadedScan ? "Chargé" : null, data.missingHubScan ? "Déchargé au hub" : null].filter(Boolean).join(", ")}.`
          : data.error === "checkpoint_locked" ? "Cet appareil est réservé à un autre poste."
          : "Échec du scan, réessayez.",
        );
        playBeep(false);
        const errorEntry: ScanLogEntry = { at: new Date(), checkpoint: modeRef.current, outcome: "error", label: code };
        setLog((entries) => [errorEntry, ...entries].slice(0, 20));
        if (!dismissible) window.setTimeout(() => setFlash(null), 1100);
      } else {
        const outcome: ScanOutcome = data.duplicate ? "duplicate" : "success";
        // Ultra-clear ticket id, live request: what the physical parcel's
        // own printed short code should read as, front and center -- the
        // customer name/destination stays as supporting detail underneath,
        // not the headline, so a mismatch against the parcel in hand is
        // obvious at a glance rather than something to read carefully for.
        const shortCode = data.delivery?.shortCode ?? null;
        const detail = data.delivery ? `${data.delivery.customer} → ${data.delivery.destination}` : code;
        setFlash(outcome);
        setErrorDismissible(false);
        setFlashShortCode(shortCode);
        setMessage(data.duplicate ? `Déjà scanné : ${detail}` : detail);
        playBeep(true);
        if (navigator.vibrate) navigator.vibrate(outcome === "duplicate" ? [80, 60, 80] : 150);
        setLog((entries) => [{ at: new Date(), checkpoint: modeRef.current, outcome, label: shortCode ? `${shortCode} · ${detail}` : detail }, ...entries].slice(0, 20));
        // A real (non-duplicate) scan removes this parcel from the pending
        // list immediately -- instant feedback that it's been accounted
        // for -- then a background refresh catches anything another device
        // scanned in the meantime.
        if (!data.duplicate && data.delivery) {
          const scannedId = data.delivery.id;
          setPending((current) => current && { ...current, items: current.items.filter((item) => item.id !== scannedId) });
          void refreshPending(modeRef.current);
        }
        // Live request: let someone who scanned the wrong parcel while
        // loading undo it themselves. Scoped to "loaded" only -- see
        // /api/scan/undo's own comment for why hub/delivered don't offer
        // the same button.
        if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
        if (!data.duplicate && data.delivery && data.scanId && modeRef.current === "loaded") {
          setUndo({ scanId: data.scanId, deliveryId: data.delivery.id, label: shortCode ?? detail });
          undoTimeoutRef.current = setTimeout(() => setUndo(null), 20_000);
        } else {
          setUndo(null);
        }
        window.setTimeout(() => setFlash(null), 1100);
      }
    } catch {
      setFlash("error");
      setErrorDismissible(false);
      setMessage("Connexion impossible, réessayez.");
      playBeep(false);
      window.setTimeout(() => setFlash(null), 1100);
    } finally {
      setBusy(false);
    }
  }, [refreshPending]);

  const dismissError = useCallback(() => {
    setFlash(null);
    setErrorDismissible(false);
  }, []);

  const undoScan = useCallback(async () => {
    if (!undo) return;
    setUndoing(true);
    try {
      const response = await fetch("/api/scan/undo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deliveryId: undo.deliveryId, scanId: undo.scanId, checkpoint: "loaded" }),
      });
      if (response.ok) {
        const undoEntry: ScanLogEntry = { at: new Date(), checkpoint: "loaded", outcome: "error", label: `Annulé : ${undo.label}` };
        setLog((entries) => [undoEntry, ...entries].slice(0, 20));
        void refreshPending("loaded");
        if (navigator.vibrate) navigator.vibrate(80);
      }
    } catch {
      // Best-effort -- the undo window simply expires if this fails, no
      // different from not having tapped it in time.
    } finally {
      setUndoing(false);
      if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
      setUndo(null);
    }
  }, [undo, refreshPending]);

  const detectFrame = useCallback(async () => {
    if (detectingRef.current || busyRef.current || blockedRef.current) return;
    const video = videoRef.current;
    if (!video || video.readyState < 2) return;
    detectingRef.current = true;
    try {
      if (detectorRef.current) {
        const results = await detectorRef.current.detect(video);
        if (results[0]) void submitScan(extractParcelCode(results[0].rawValue) ?? "");
        return;
      }
      const canvas = canvasRef.current;
      if (!canvas) return;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return;
      const width = 480;
      const height = Math.round((video.videoHeight / video.videoWidth) * width) || 360;
      canvas.width = width;
      canvas.height = height;
      context.drawImage(video, 0, 0, width, height);
      const imageData = context.getImageData(0, 0, width, height);
      const { default: jsQR } = await import("jsqr");
      const result = jsQR(imageData.data, width, height);
      if (result?.data) void submitScan(extractParcelCode(result.data) ?? "");
    } catch {
      // A single failed frame is normal (motion blur, out of focus) -- the
      // loop just tries again on the next tick.
    } finally {
      detectingRef.current = false;
    }
  }, [submitScan]);

  useEffect(() => {
    if (auth !== "ready" || !navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (position) => { positionRef.current = { latitude: position.coords.latitude, longitude: position.coords.longitude }; },
      () => { /* denied, unavailable, or timed out -- scans keep working without a position */ },
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 10_000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [auth]);

  useEffect(() => {
    if (auth !== "ready") return;
    let cancelled = false;
    async function startCamera() {
      setCameraState("starting");
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (cancelled) { stream.getTracks().forEach((track) => track.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        if (window.BarcodeDetector) {
          try {
            detectorRef.current = new window.BarcodeDetector({ formats: ["qr_code"] });
          } catch {
            detectorRef.current = null;
          }
        }
        setCameraState("active");
        intervalRef.current = setInterval(() => void detectFrame(), SCAN_INTERVAL_MS);
      } catch (error) {
        if (!cancelled) {
          setCameraState("error");
          setCameraError(error instanceof Error && error.name === "NotAllowedError"
            ? "Accès à la caméra refusé. Autorisez-le dans les réglages du navigateur."
            : "Caméra indisponible sur cet appareil.");
        }
      }
    }
    void startCamera();
    return () => {
      cancelled = true;
      if (intervalRef.current) clearInterval(intervalRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [auth, detectFrame]);

  function submitManualCode(event: React.FormEvent) {
    event.preventDefault();
    const code = extractParcelCode(manualCode);
    if (code) void submitScan(code);
    setManualCode("");
  }

  if (auth === "loading") return <main style={{ padding: 40, fontFamily: "system-ui" }}>Chargement…</main>;
  if (auth === "denied") return (
    <main style={{ padding: 40, fontFamily: "system-ui", maxWidth: 480, margin: "0 auto" }}>
      <h1>Connexion requise</h1>
      <p>Scannez le QR affiché dans TrackFleet pour connecter cet appareil au scanner.</p>
      <Link href="/">Retour à TrackFleet</Link>
    </main>
  );

  const flashColor = flash === "success" ? "#16a34a" : flash === "duplicate" ? "#d97706" : flash === "error" ? "#dc2626" : "transparent";

  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 520, margin: "0 auto", padding: "20px 16px 48px", color: "#111827", minHeight: "100vh", background: "#0b0f14" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, color: "#f9fafb" }}>
        <div>
          <p style={{ margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: ".12em", color: "#9ca3af" }}>TRACKFLEET · SCAN</p>
          <h1 style={{ margin: "4px 0", fontSize: 20 }}>Scanner un colis</h1>
          {company?.role === "agency" && <p style={{ margin: 0, fontSize: 13, color: "#9ca3af" }}>Agence : {company.siteId}</p>}
          {deviceLabel && <p style={{ margin: 0, fontSize: 13, color: "#9ca3af" }}>Appareil : {deviceLabel}</p>}
        </div>
        {!scannerOnly && <Link href="/?lang=fr" style={{ color: "#f9fafb", fontWeight: 700, fontSize: 13 }}>← Tableau</Link>}
      </header>

      {lockedCheckpoint ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderRadius: 10, border: "2px solid #22c55e", background: "#14532d", color: "#f9fafb", fontWeight: 700, fontSize: 13, marginBottom: 6 }}>
          Poste : {CHECKPOINTS.find((checkpoint) => checkpoint.value === lockedCheckpoint)?.label}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 6, marginBottom: 14 }}>
          {CHECKPOINTS.map((checkpoint) => (
            <button
              key={checkpoint.value}
              type="button"
              onClick={() => setMode(checkpoint.value)}
              style={{
                padding: "10px 4px",
                borderRadius: 10,
                border: mode === checkpoint.value ? "2px solid #22c55e" : "1px solid #374151",
                background: mode === checkpoint.value ? "#14532d" : "#1f2937",
                color: "#f9fafb",
                fontWeight: 700,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              {checkpoint.label}
            </button>
          ))}
        </div>
      )}
      <p style={{ margin: "0 0 10px", color: "#9ca3af", fontSize: 13 }}>
        {CHECKPOINTS.find((checkpoint) => checkpoint.value === mode)?.help}
      </p>

      {pending && (
        <div style={{ marginBottom: 14, borderRadius: 10, border: "1px solid #374151", background: "#1f2937", overflow: "hidden" }}>
          <button
            type="button"
            onClick={() => setPendingOpen((open) => !open)}
            style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: "transparent", border: 0, color: "#f9fafb", fontWeight: 700, fontSize: 13, cursor: "pointer" }}
          >
            <span>{pending.items.length === 0 ? "Aucun colis restant" : `${pending.items.length} colis restant${pending.items.length > 1 ? "s" : ""}`}</span>
            {pending.items.length > 0 && <span aria-hidden="true">{pendingOpen ? "▾" : "▸"}</span>}
          </button>
          {pendingOpen && pending.items.length > 0 && (
            <ul style={{ listStyle: "none", margin: 0, padding: "0 12px 12px", display: "grid", gap: 4, maxHeight: 220, overflowY: "auto" }}>
              {pending.items.map((item, index) => {
                const previous = pending.items[index - 1];
                const showTruckHeader = pending.groupByTruck && (!previous || previous.truck !== item.truck);
                return (
                  <li key={item.id}>
                    {showTruckHeader && <p style={{ margin: "8px 0 4px", color: "#9ca3af", fontSize: 11, fontWeight: 700, letterSpacing: ".06em" }}>{item.truck || "Camion à affecter"}</p>}
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "6px 8px", borderRadius: 6, background: "#111827", fontSize: 13 }}>
                      <span style={{ fontWeight: 700, color: "#f9fafb" }}>{item.shortCode ?? item.id}</span>
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#d1d5db" }}>{item.customer}</span>
                      <span style={{ color: "#6b7280", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.destination}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      <div style={{ position: "relative", borderRadius: 16, overflow: "hidden", background: "#000", aspectRatio: "3 / 4", border: `3px solid ${flash ? flashColor : "#1f2937"}`, transition: "border-color 120ms ease" }}>
        <video ref={videoRef} playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover", display: cameraState === "active" ? "block" : "none" }} />
        <canvas ref={canvasRef} style={{ display: "none" }} />
        {cameraState !== "active" && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#9ca3af", textAlign: "center", padding: 24, fontSize: 14 }}>
            {cameraState === "starting" ? "Démarrage de la caméra…" : cameraState === "error" ? cameraError : ""}
          </div>
        )}
        {flash && (
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "14px 16px", background: "rgba(0,0,0,0.85)", color: "#fff" }}>
            {flashShortCode && (
              <p style={{ margin: "0 0 2px", fontSize: 28, fontWeight: 800, letterSpacing: ".02em", fontFamily: "monospace" }}>{flashShortCode}</p>
            )}
            <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: flashShortCode ? "#d1d5db" : "#fff" }}>{message}</p>
            {errorDismissible && (
              <button type="button" onClick={dismissError} style={{ marginTop: 10, width: "100%", padding: "10px 0", borderRadius: 8, border: "1px solid rgba(255,255,255,0.3)", background: "rgba(255,255,255,0.1)", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                J’ai compris
              </button>
            )}
          </div>
        )}
        {busy && !flash && (
          <div style={{ position: "absolute", top: 12, right: 12, width: 10, height: 10, borderRadius: "50%", background: "#22c55e" }} />
        )}
      </div>

      {locationMismatch && (
        <div style={{ marginTop: 10, padding: "12px 14px", borderRadius: 10, border: "2px solid #d97706", background: "#451a03", color: "#fef3c7" }}>
          <p style={{ margin: "0 0 4px", fontWeight: 700, fontSize: 14 }}>Position inattendue</p>
          <p style={{ margin: "0 0 10px", fontSize: 13 }}>
            Ce téléphone est à environ {locationMismatch.distanceKm} km de {locationMismatch.agencyLabel}. Confirmez-vous que c’est bien la bonne agence ?
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={() => setLocationMismatch(null)} disabled={busy} style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "1px solid #78350f", background: "transparent", color: "#fef3c7", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
              Annuler
            </button>
            <button type="button" onClick={() => void submitScan(locationMismatch.code, { bypassLocationMismatch: true })} disabled={busy} style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: 0, background: "#d97706", color: "#451a03", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
              Confirmer quand même
            </button>
          </div>
        </div>
      )}

      {undo && (
        <div style={{ marginTop: 10, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 12px", borderRadius: 8, background: "#1f2937", border: "1px solid #374151" }}>
          <span style={{ fontSize: 13, color: "#d1d5db" }}>Scanné : {undo.label}</span>
          <button type="button" onClick={() => void undoScan()} disabled={undoing} style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid #f87171", background: "transparent", color: "#f87171", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
            {undoing ? "Annulation…" : "Annuler ce scan"}
          </button>
        </div>
      )}

      <form onSubmit={submitManualCode} style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <input
          value={manualCode}
          onChange={(event) => setManualCode(event.target.value.toUpperCase())}
          placeholder="Code manuel (si la caméra ne marche pas)"
          style={{ flex: 1, padding: "10px 12px", borderRadius: 10, border: "1px solid #374151", background: "#1f2937", color: "#f9fafb", fontSize: 14 }}
        />
        <button type="submit" disabled={!manualCode.trim()} style={{ padding: "10px 16px", borderRadius: 10, border: 0, background: "#22c55e", color: "#052e12", fontWeight: 700, cursor: "pointer" }}>
          Valider
        </button>
      </form>

      <section style={{ marginTop: 24 }}>
        <p style={{ margin: "0 0 8px", fontSize: 12, fontWeight: 700, letterSpacing: ".08em", color: "#9ca3af" }}>DERNIERS SCANS ({log.length})</p>
        {log.length === 0 && <p style={{ color: "#6b7280", fontSize: 13 }}>Aucun scan pour l’instant.</p>}
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
          {log.map((entry, index) => (
            <li key={`${entry.at.getTime()}-${index}`} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "8px 10px", borderRadius: 8, background: "#1f2937", color: "#f9fafb", fontSize: 13 }}>
              <span style={{ color: entry.outcome === "success" ? "#4ade80" : entry.outcome === "duplicate" ? "#fbbf24" : "#f87171" }}>
                {entry.outcome === "success" ? "✓" : entry.outcome === "duplicate" ? "↻" : "✕"} {CHECKPOINTS.find((checkpoint) => checkpoint.value === entry.checkpoint)?.label}
              </span>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.label}</span>
              <span style={{ color: "#6b7280" }}>{entry.at.toLocaleTimeString("fr-BE", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
