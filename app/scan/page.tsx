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

const CHECKPOINTS: Array<{ value: Checkpoint; label: string; help: string }> = [
  { value: "loaded", label: "Chargé", help: "Preuve que ce colis est monté dans le camion." },
  { value: "arrived", label: "Déchargé au hub", help: "Preuve que ce colis a été déchargé au hub. Cela ne confirme jamais une arrivée finale." },
  { value: "delivered", label: "Livré à l'agence", help: "Confirme l'arrivée finale à l'agence de destination. Nécessite d'avoir déjà scanné « Chargé » et « Déchargé au hub »." },
];

const RESUBMIT_COOLDOWN_MS = 2500;
const SCAN_INTERVAL_MS = 350;

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
  const [log, setLog] = useState<ScanLogEntry[]>([]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<InstanceType<NonNullable<Window["BarcodeDetector"]>> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const detectingRef = useRef(false);
  const lastSubmissionRef = useRef<{ code: string; at: number } | null>(null);
  const modeRef = useRef(mode);
  const busyRef = useRef(busy);
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


  const submitScan = useCallback(async (code: string) => {
    if (!isValidParcelCode(code)) {
      setFlash("error");
      setMessage("Code invalide.");
      playBeep(false);
      window.setTimeout(() => setFlash(null), 900);
      return;
    }
    const now = Date.now();
    const last = lastSubmissionRef.current;
    if (last && last.code === code && now - last.at < RESUBMIT_COOLDOWN_MS) return;
    lastSubmissionRef.current = { code, at: now };

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
        }),
      });
      const data = await response.json() as {
        ok?: boolean; duplicate?: boolean; error?: string;
        missingLoadedScan?: boolean; missingHubScan?: boolean;
        delivery?: { id: string; customer: string; destination: string; status: string } | null;
      };
      if (!response.ok || !data.ok) {
        setFlash("error");
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
      } else {
        const outcome: ScanOutcome = data.duplicate ? "duplicate" : "success";
        const label = data.delivery ? `${data.delivery.customer} → ${data.delivery.destination}` : code;
        setFlash(outcome);
        setMessage(data.duplicate ? `Déjà scanné : ${label}` : label);
        playBeep(true);
        if (navigator.vibrate) navigator.vibrate(outcome === "duplicate" ? [80, 60, 80] : 150);
        setLog((entries) => [{ at: new Date(), checkpoint: modeRef.current, outcome, label }, ...entries].slice(0, 20));
      }
    } catch {
      setFlash("error");
      setMessage("Connexion impossible, réessayez.");
      playBeep(false);
    } finally {
      setBusy(false);
      window.setTimeout(() => setFlash(null), 1100);
    }
  }, []);

  const detectFrame = useCallback(async () => {
    if (detectingRef.current || busyRef.current) return;
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
      <p style={{ margin: "0 0 14px", color: "#9ca3af", fontSize: 13 }}>
        {CHECKPOINTS.find((checkpoint) => checkpoint.value === mode)?.help}
      </p>

      <div style={{ position: "relative", borderRadius: 16, overflow: "hidden", background: "#000", aspectRatio: "3 / 4", border: `3px solid ${flash ? flashColor : "#1f2937"}`, transition: "border-color 120ms ease" }}>
        <video ref={videoRef} playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover", display: cameraState === "active" ? "block" : "none" }} />
        <canvas ref={canvasRef} style={{ display: "none" }} />
        {cameraState !== "active" && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#9ca3af", textAlign: "center", padding: 24, fontSize: 14 }}>
            {cameraState === "starting" ? "Démarrage de la caméra…" : cameraState === "error" ? cameraError : ""}
          </div>
        )}
        {flash && (
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "14px 16px", background: "rgba(0,0,0,0.75)", color: "#fff", fontWeight: 700, fontSize: 15 }}>
            {message}
          </div>
        )}
        {busy && !flash && (
          <div style={{ position: "absolute", top: 12, right: 12, width: 10, height: 10, borderRadius: "50%", background: "#22c55e" }} />
        )}
      </div>

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
