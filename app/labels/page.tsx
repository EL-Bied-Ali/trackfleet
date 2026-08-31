"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { parcelScanUrl } from "../lib/parcel-code";

type LabelDelivery = {
  id: string;
  customer: string;
  destination: string;
  truck: string;
  parcelCode: string | null;
};

// A4 sheet of pre-cut adhesive labels, printed on a plain office printer --
// no thermal printer assumed (see the product spec this was built from).
// Two columns keeps each label a comfortable ~9cm wide with A4's 10mm
// margins; break-inside: avoid (in the print stylesheet below) keeps one
// label from being split across a page boundary.
const LABELS_PER_ROW = 2;

export default function LabelsPage() {
  const [auth, setAuth] = useState<"loading" | "ready" | "denied">("loading");
  const [deliveries, setDeliveries] = useState<LabelDelivery[]>([]);
  const [loadError, setLoadError] = useState("");
  const qrCanvases = useRef(new Map<string, HTMLCanvasElement>());
  const barcodeCanvases = useRef(new Map<string, HTMLCanvasElement>());

  useEffect(() => {
    let active = true;
    void fetch("/api/auth/session", { cache: "no-store" })
      .then((response) => { if (active) setAuth(response.ok ? "ready" : "denied"); })
      .catch(() => { if (active) setAuth("denied"); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (auth !== "ready") return;
    let active = true;
    const ids = new Set(new URLSearchParams(window.location.search).get("ids")?.split(",").filter(Boolean) ?? []);
    void fetch("/api/deliveries", { cache: "no-store" })
      .then((response) => response.json() as Promise<{ deliveries?: LabelDelivery[] }>)
      .then((data) => {
        if (!active) return;
        const all = data.deliveries ?? [];
        const selected = ids.size ? all.filter((delivery) => ids.has(delivery.id)) : all;
        setDeliveries(selected);
        if (!selected.length) setLoadError(ids.size ? "Aucune de ces livraisons n’a été trouvée." : "Aucune livraison à imprimer.");
      })
      .catch(() => { if (active) setLoadError("Impossible de charger les livraisons."); });
    return () => { active = false; };
  }, [auth]);

  useEffect(() => {
    if (!deliveries.length) return;
    let cancelled = false;
    void (async () => {
      const [{ default: QRCode }, { default: JsBarcode }] = await Promise.all([import("qrcode"), import("jsbarcode")]);
      if (cancelled) return;
      const origin = window.location.origin;
      for (const delivery of deliveries) {
        if (!delivery.parcelCode) continue;
        const qrCanvas = qrCanvases.current.get(delivery.id);
        const barcodeCanvas = barcodeCanvases.current.get(delivery.id);
        if (qrCanvas) {
          await QRCode.toCanvas(qrCanvas, parcelScanUrl(origin, delivery.parcelCode), { width: 160, margin: 1 });
        }
        if (barcodeCanvas) {
          JsBarcode(barcodeCanvas, delivery.parcelCode, { format: "CODE128", width: 1.6, height: 36, fontSize: 12, margin: 0 });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [deliveries]);

  if (auth === "loading") return <main style={{ padding: 40, fontFamily: "system-ui" }}>Chargement…</main>;
  if (auth === "denied") return (
    <main style={{ padding: 40, fontFamily: "system-ui", maxWidth: 480, margin: "0 auto" }}>
      <h1>Connexion requise</h1>
      <p>Connectez-vous d’abord à TrackFleet avant d’imprimer des étiquettes.</p>
      <Link href="/">Retour à TrackFleet</Link>
    </main>
  );

  return (
    <main style={{ fontFamily: "system-ui", color: "#111827", background: "#e5e7eb", minHeight: "100vh" }}>
      <style>{`
        @page { size: A4; margin: 10mm; }
        @media print {
          .no-print { display: none !important; }
          main { background: #fff !important; padding: 0 !important; }
          .label-sheet { box-shadow: none !important; margin: 0 !important; width: auto !important; }
          .label { break-inside: avoid; }
        }
      `}</style>

      <div className="no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 24px", background: "#111827", color: "#fff" }}>
        <div>
          <p style={{ margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: ".12em", color: "#9ca3af" }}>TRACKFLEET · ÉTIQUETTES</p>
          <h1 style={{ margin: "4px 0 0", fontSize: 18 }}>{deliveries.length} étiquette{deliveries.length > 1 ? "s" : ""} prête{deliveries.length > 1 ? "s" : ""}</h1>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <Link href="/?lang=fr" style={{ color: "#fff", fontWeight: 700, fontSize: 13, alignSelf: "center" }}>← Tableau</Link>
          <button type="button" onClick={() => window.print()} disabled={!deliveries.length} style={{ padding: "10px 18px", borderRadius: 10, border: 0, background: "#22c55e", color: "#052e12", fontWeight: 700, cursor: deliveries.length ? "pointer" : "default" }}>
            Imprimer
          </button>
        </div>
      </div>

      {loadError && <p className="no-print" style={{ padding: 24, color: "#b91c1c" }}>{loadError}</p>}

      <div className="label-sheet" style={{ maxWidth: "190mm", margin: "16px auto", padding: "10mm", background: "#fff", boxShadow: "0 1px 4px rgba(0,0,0,0.15)" }}>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${LABELS_PER_ROW}, 1fr)`, gap: "6mm" }}>
          {deliveries.map((delivery) => (
            <div key={delivery.id} className="label" style={{ border: "1px solid #000", borderRadius: 4, padding: "5mm", display: "flex", flexDirection: "column", gap: "2mm", minHeight: "45mm" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "3mm" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".04em", color: "#000" }}>TRACKFLEET</div>
                  <div style={{ fontSize: 13, fontWeight: 700, marginTop: "1mm", wordBreak: "break-word" }}>{delivery.id}</div>
                  <div style={{ fontSize: 12, marginTop: "1.5mm", wordBreak: "break-word" }}>{delivery.customer}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, marginTop: "0.5mm", wordBreak: "break-word" }}>→ {delivery.destination}</div>
                  {delivery.truck && <div style={{ fontSize: 11, marginTop: "0.5mm", color: "#333" }}>Camion : {delivery.truck}</div>}
                </div>
                {delivery.parcelCode ? (
                  <canvas ref={(element) => { if (element) qrCanvases.current.set(delivery.id, element); }} style={{ width: "32mm", height: "32mm", flex: "0 0 auto" }} />
                ) : (
                  <div style={{ width: "32mm", height: "32mm", flex: "0 0 auto", border: "1px dashed #999", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#999", textAlign: "center", padding: "2mm" }}>
                    Code non disponible
                  </div>
                )}
              </div>
              {delivery.parcelCode && (
                <canvas ref={(element) => { if (element) barcodeCanvases.current.set(delivery.id, element); }} style={{ width: "100%", height: "10mm" }} />
              )}
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
