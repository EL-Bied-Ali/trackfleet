"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

type Checkpoint = "loaded" | "arrived" | "delivered";
type Pairing = { code: string; expiresAt: number; scope: string; deviceLabel: string; checkpoint: Checkpoint | null };
type Device = { id: string; deviceLabel: string; pairedAt: number; expiresAt: number; checkpoint?: Checkpoint | null };

const CHECKPOINTS: Array<{ value: Checkpoint; label: string }> = [
  { value: "loaded", label: "Chargement" },
  { value: "arrived", label: "Hub" },
  { value: "delivered", label: "Agence" },
];

export default function ScannerConnectPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [deviceLabelDraft, setDeviceLabelDraft] = useState("");
  // Required before generating a link -- an unset checkpoint would fall
  // back to today's free-choice picker on the receiving phone, exactly
  // the confusion this feature exists to remove.
  const [checkpointDraft, setCheckpointDraft] = useState<Checkpoint | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "denied" | "error">("loading");
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);

  const loadDevices = useCallback(async () => {
    try {
      const response = await fetch("/api/scan/pair", { cache: "no-store" });
      const data = await response.json() as { devices?: Device[] };
      setDevices(data.devices ?? []);
    } catch {
      // Best-effort refresh -- the create/revoke actions surface their own errors.
    }
  }, []);

  const createPairing = useCallback(async () => {
    const deviceLabel = deviceLabelDraft.trim();
    if (!deviceLabel) {
      setMessage("Indiquez un nom pour cet appareil (ex. : chauffeur ou camion).");
      return;
    }
    if (!checkpointDraft) {
      setMessage("Choisissez le poste de cet appareil (chargement, hub ou agence).");
      return;
    }
    setCreating(true);
    setMessage("");
    try {
      const response = await fetch("/api/scan/pair", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceLabel, checkpoint: checkpointDraft }),
      });
      const data = await response.json() as Pairing & { error?: string };
      if (!response.ok || !data.code) throw new Error(data.error ?? "pairing_failed");
      setPairing(data);
      setDeviceLabelDraft("");
      setCheckpointDraft(null);
    } catch {
      setMessage("Impossible de préparer le QR pour le moment. Réessayez dans un instant.");
    } finally {
      setCreating(false);
    }
  }, [deviceLabelDraft, checkpointDraft]);

  useEffect(() => {
    let active = true;
    void fetch("/api/auth/session", { cache: "no-store" })
      .then((response) => response.json() as Promise<{ authenticated: boolean }>)
      .then(async (session) => {
        if (!active) return;
        if (!session.authenticated) { setState("denied"); return; }
        await loadDevices();
        if (active) setState("ready");
      })
      .catch(() => { if (active) setState("denied"); });
    return () => { active = false; };
  }, [loadDevices]);

  useEffect(() => {
    if (!pairing || !canvasRef.current) return;
    const url = `${window.location.origin}/scan?pair=${encodeURIComponent(pairing.code)}`;
    void import("qrcode").then(({ default: QRCode }) => QRCode.toCanvas(canvasRef.current!, url, {
      width: 220, margin: 1, color: { dark: "#111827", light: "#ffffff" },
    }));
  }, [pairing]);

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setMessage("Copie impossible -- sélectionnez le lien manuellement.");
    }
  }

  async function disconnect(deviceId: string) {
    setRevokingId(deviceId);
    setMessage("");
    try {
      const response = await fetch("/api/scan/pair", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceId }),
      });
      if (!response.ok) throw new Error("revoke_failed");
      setDevices((current) => current.filter((device) => device.id !== deviceId));
      setMessage("Téléphone déconnecté.");
    } catch {
      setMessage("Impossible de déconnecter cet appareil pour le moment.");
    } finally {
      setRevokingId(null);
    }
  }

  if (state === "denied") return <main style={{ padding: 40, fontFamily: "system-ui" }}><h1>Connexion requise</h1><p>Ouvrez cette page depuis TrackFleet sur l’ordinateur.</p><Link href="/">Retour à TrackFleet</Link></main>;

  const link = pairing ? `${typeof window !== "undefined" ? window.location.origin : ""}/scan?pair=${encodeURIComponent(pairing.code)}` : "";
  return (
    <main style={{ minHeight: "100vh", background: "#0b0f14", color: "#f9fafb", fontFamily: "system-ui", padding: "40px 20px" }}>
      <section style={{ maxWidth: 560, margin: "0 auto", textAlign: "center", background: "#111827", border: "1px solid #374151", borderRadius: 20, padding: 32 }}>
        <p style={{ color: "#9ca3af", fontWeight: 700, fontSize: 12, letterSpacing: ".12em", margin: 0 }}>TRACKFLEET · APPAREIL SCANNER</p>
        <h1 style={{ margin: "10px 0 8px" }}>Connecter un téléphone</h1>
        <p style={{ color: "#d1d5db", margin: "0 0 20px" }}>Chaque chauffeur peut avoir son propre téléphone connecté en permanence -- pas besoin de le reconnecter à chaque livraison.</p>

        {state === "loading" && <p>Chargement…</p>}

        {state === "ready" && !pairing && <div style={{ display: "grid", gap: 10 }}>
          <input
            value={deviceLabelDraft}
            onChange={(event) => setDeviceLabelDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") void createPairing(); }}
            placeholder="Nom de l’appareil (ex. : Ahmed - Camion 3)"
            maxLength={60}
            style={{ borderRadius: 10, border: "1px solid #374151", background: "#0b0f14", color: "#f9fafb", padding: "10px 12px", fontSize: 14 }}
          />
          <p style={{ color: "#9ca3af", fontSize: 13, margin: "4px 0 0", textAlign: "left" }}>Poste de cet appareil -- le lien ouvrira directement ce poste, sans que la personne ait à choisir :</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
            {CHECKPOINTS.map((checkpoint) => (
              <button
                key={checkpoint.value}
                type="button"
                onClick={() => setCheckpointDraft(checkpoint.value)}
                style={{
                  padding: "10px 4px",
                  borderRadius: 10,
                  border: checkpointDraft === checkpoint.value ? "2px solid #22c55e" : "1px solid #374151",
                  background: checkpointDraft === checkpoint.value ? "#14532d" : "#0b0f14",
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
          <button onClick={() => void createPairing()} disabled={creating} style={buttonStyle}>{creating ? "Préparation…" : "Générer le lien"}</button>
        </div>}

        {state === "ready" && pairing && <>
          <p style={{ color: "#d1d5db", margin: "0 0 4px", fontWeight: 700 }}>{pairing.deviceLabel} · {CHECKPOINTS.find((checkpoint) => checkpoint.value === pairing.checkpoint)?.label ?? "Libre"}</p>
          <p style={{ color: "#d1d5db", margin: "0 0 16px" }}>Avec ce téléphone, scannez ce QR (ou ouvrez le lien). Il ouvrira directement ce poste, connecté pour 30 jours.</p>
          <div style={{ background: "#fff", borderRadius: 16, display: "inline-flex", padding: 14 }}><canvas ref={canvasRef} aria-label="QR de connexion au scanner" /></div>
          <p style={{ color: "#9ca3af", fontSize: 13 }}>Le lien est valable 10 minutes · accès limité à {pairing.scope}</p>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
            <a href={link} style={{ color: "#86efac", flex: 1, overflowWrap: "anywhere", fontSize: 12, textAlign: "left" }}>{link}</a>
            <button onClick={() => void copyLink(link)} style={{ border: "1px solid #374151", borderRadius: 8, padding: "6px 10px", background: copied ? "#14532d" : "#1f2937", color: "#f9fafb", fontWeight: 700, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}>
              {copied ? "Copié ✓" : "Copier"}
            </button>
          </div>
          <p style={{ color: "#9ca3af", fontSize: 12, margin: "8px 0 0" }}>Envoyez ce lien par WhatsApp au chauffeur -- il n’a besoin de l’ouvrir qu’une seule fois.</p>
          <button onClick={() => { setPairing(null); void loadDevices(); }} style={{ ...buttonStyle, marginTop: 16, background: "#374151", color: "#f9fafb" }}>Terminé</button>
        </>}

        {message && <p style={{ color: state === "error" ? "#fca5a5" : "#86efac", fontSize: 13, marginTop: 12 }}>{message}</p>}

        {state === "ready" && devices.length > 0 && <div style={{ marginTop: 28, textAlign: "left" }}>
          <p style={{ color: "#9ca3af", fontWeight: 700, fontSize: 12, letterSpacing: ".08em", margin: "0 0 10px" }}>APPAREILS CONNECTÉS ({devices.length})</p>
          <div style={{ display: "grid", gap: 8 }}>
            {devices.map((device) => (
              <div key={device.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#0b0f14", border: "1px solid #374151", borderRadius: 10, padding: "10px 12px" }}>
                <span style={{ fontSize: 14 }}>
                  {device.deviceLabel}
                  {device.checkpoint && <span style={{ color: "#86efac", fontWeight: 700 }}> · {CHECKPOINTS.find((checkpoint) => checkpoint.value === device.checkpoint)?.label}</span>}
                </span>
                <button onClick={() => void disconnect(device.id)} disabled={revokingId === device.id} style={{ border: 0, background: "transparent", color: "#fca5a5", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                  {revokingId === device.id ? "…" : "Déconnecter"}
                </button>
              </div>
            ))}
          </div>
        </div>}

        <Link href="/" style={{ display: "inline-block", marginTop: 24, color: "#d1d5db", fontSize: 13 }}>← Retour au tableau</Link>
      </section>
    </main>
  );
}

const buttonStyle: React.CSSProperties = { border: 0, borderRadius: 10, padding: "10px 14px", fontWeight: 700, background: "#22c55e", color: "#052e12", cursor: "pointer" };
