"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

type Pairing = { code: string; expiresAt: number; scope: string };

export default function ScannerConnectPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "denied" | "error">("loading");
  const [message, setMessage] = useState("");

  const createPairing = useCallback(async () => {
    setState("loading");
    try {
      const response = await fetch("/api/scan/pair", { method: "POST" });
      const data = await response.json() as Pairing & { error?: string };
      if (!response.ok || !data.code) throw new Error(data.error ?? "pairing_failed");
      setPairing(data);
      setState("ready");
    } catch {
      setState("error");
      setMessage("Impossible de préparer le QR pour le moment. Réessayez dans un instant.");
    }
  }, []);

  useEffect(() => {
    let active = true;
    void fetch("/api/auth/session", { cache: "no-store" })
      .then((response) => response.json() as Promise<{ authenticated: boolean }>)
      .then((session) => {
        if (!active) return;
        if (!session.authenticated) { setState("denied"); return; }
        void createPairing();
      })
      .catch(() => { if (active) setState("denied"); });
    return () => { active = false; };
  }, [createPairing]);

  useEffect(() => {
    if (!pairing || !canvasRef.current) return;
    const url = `${window.location.origin}/scan?pair=${encodeURIComponent(pairing.code)}`;
    void import("qrcode").then(({ default: QRCode }) => QRCode.toCanvas(canvasRef.current!, url, {
      width: 260, margin: 1, color: { dark: "#111827", light: "#ffffff" },
    }));
  }, [pairing]);

  async function disconnect() {
    await fetch("/api/scan/pair", { method: "DELETE" });
    setMessage("Le téléphone scanner a été déconnecté.");
  }

  if (state === "denied") return <main style={{ padding: 40, fontFamily: "system-ui" }}><h1>Connexion requise</h1><p>Ouvrez cette page depuis TrackFleet sur l’ordinateur.</p><Link href="/">Retour à TrackFleet</Link></main>;

  const link = pairing && typeof window !== "undefined" ? `${window.location.origin}/scan?pair=${encodeURIComponent(pairing.code)}` : "";
  return (
    <main style={{ minHeight: "100vh", background: "#0b0f14", color: "#f9fafb", fontFamily: "system-ui", padding: "40px 20px" }}>
      <section style={{ maxWidth: 560, margin: "0 auto", textAlign: "center", background: "#111827", border: "1px solid #374151", borderRadius: 20, padding: 32 }}>
        <p style={{ color: "#9ca3af", fontWeight: 700, fontSize: 12, letterSpacing: ".12em", margin: 0 }}>TRACKFLEET · APPAREIL SCANNER</p>
        <h1 style={{ margin: "10px 0 8px" }}>Connecter un téléphone</h1>
        <p style={{ color: "#d1d5db", margin: "0 0 24px" }}>Avec le téléphone, scannez ce QR. Il ouvrira uniquement le scanner de colis.</p>
        {state === "loading" && <p>Préparation du QR…</p>}
        {state === "error" && <><p style={{ color: "#fca5a5" }}>{message}</p><button onClick={() => void createPairing()} style={buttonStyle}>Réessayer</button></>}
        {state === "ready" && pairing && <>
          <div style={{ background: "#fff", borderRadius: 16, display: "inline-flex", padding: 14 }}><canvas ref={canvasRef} aria-label="QR de connexion au scanner" /></div>
          <p style={{ color: "#9ca3af", fontSize: 13 }}>Valable 10 minutes · accès limité à {pairing.scope}</p>
          <a href={link} style={{ color: "#86efac", display: "block", overflowWrap: "anywhere", fontSize: 12 }}>{link}</a>
          <div style={{ display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap", marginTop: 24 }}>
            <button onClick={() => void createPairing()} style={buttonStyle}>Nouveau QR</button>
            <button onClick={() => void disconnect()} style={{ ...buttonStyle, background: "#374151", color: "#f9fafb" }}>Déconnecter le téléphone</button>
          </div>
          {message && <p style={{ color: "#86efac", fontSize: 13 }}>{message}</p>}
        </>}
        <Link href="/" style={{ display: "inline-block", marginTop: 24, color: "#d1d5db", fontSize: 13 }}>← Retour au tableau</Link>
      </section>
    </main>
  );
}

const buttonStyle: React.CSSProperties = { border: 0, borderRadius: 10, padding: "10px 14px", fontWeight: 700, background: "#22c55e", color: "#052e12", cursor: "pointer" };
