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

type LabelBranding = { name: string | null; logoDataUrl: string | null };
const emptyBranding: LabelBranding = { name: null, logoDataUrl: null };

// A4 sheet of pre-cut adhesive labels, printed on a plain office printer --
// no thermal printer assumed (see the product spec this was built from).
// 2 columns x 4 rows of ~105x74mm labels exactly fills a 210x297mm page with
// no gap between them, so @page margin is 0 below. There's no universal
// standard for the printed gutter on physical pre-cut sheets though -- if
// yours has a border/margin printed on it, adjust LABEL_WIDTH_MM /
// LABEL_HEIGHT_MM to match and test-print one sheet before a full batch.
const LABELS_PER_ROW = 2;
const LABELS_PER_COLUMN = 4;
const LABELS_PER_PAGE = LABELS_PER_ROW * LABELS_PER_COLUMN;
const LABEL_WIDTH_MM = 105;
const LABEL_HEIGHT_MM = 74.25;

function chunk<T>(items: T[], size: number): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) pages.push(items.slice(i, i + size));
  return pages;
}

export default function LabelsPage() {
  const [auth, setAuth] = useState<"loading" | "ready" | "denied">("loading");
  const [deliveries, setDeliveries] = useState<LabelDelivery[]>([]);
  const [loadError, setLoadError] = useState("");
  const [branding, setBranding] = useState<LabelBranding>(emptyBranding);
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
    void fetch("/api/company/branding", { cache: "no-store" })
      .then((response) => response.json() as Promise<{ branding?: LabelBranding }>)
      .then((data) => { if (active) setBranding(data.branding ?? emptyBranding); })
      .catch(() => { if (active) setBranding(emptyBranding); });
    return () => { active = false; };
  }, [auth]);

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

  const pages = chunk(deliveries, LABELS_PER_PAGE);

  return (
    <main style={{ fontFamily: "system-ui", color: "#111827", background: "#e5e7eb", minHeight: "100vh" }}>
      <style>{`
        @page { size: A4; margin: 0; }
        @media print {
          .no-print { display: none !important; }
          main { background: #fff !important; padding: 0 !important; }
          .label-page { box-shadow: none !important; margin: 0 !important; }
          .label-page:not(:last-child) { break-after: page; }
          .label { break-inside: avoid; }
        }
      `}</style>

      <div className="no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 24px", background: "#111827", color: "#fff" }}>
        <div>
          <p style={{ margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: ".12em", color: "#9ca3af" }}>TRACKFLEET · ÉTIQUETTES</p>
          <h1 style={{ margin: "4px 0 0", fontSize: 18 }}>{deliveries.length} étiquette{deliveries.length > 1 ? "s" : ""} prête{deliveries.length > 1 ? "s" : ""}</h1>
          <p style={{ margin: "2px 0 0", fontSize: 12, color: "#9ca3af" }}>{LABELS_PER_PAGE} par feuille A4 ({LABEL_WIDTH_MM}×{LABEL_HEIGHT_MM}mm) · {pages.length} feuille{pages.length > 1 ? "s" : ""}</p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <Link href="/?lang=fr" style={{ color: "#fff", fontWeight: 700, fontSize: 13, alignSelf: "center" }}>← Tableau</Link>
          <button type="button" onClick={() => window.print()} disabled={!deliveries.length} style={{ padding: "10px 18px", borderRadius: 10, border: 0, background: "#22c55e", color: "#052e12", fontWeight: 700, cursor: deliveries.length ? "pointer" : "default" }}>
            Imprimer
          </button>
        </div>
      </div>

      {loadError && <p className="no-print" style={{ padding: 24, color: "#b91c1c" }}>{loadError}</p>}

      {pages.map((pageDeliveries, pageIndex) => (
        <div
          key={pageIndex}
          className="label-page"
          style={{
            width: "210mm",
            margin: "16px auto",
            background: "#fff",
            boxShadow: "0 1px 4px rgba(0,0,0,0.15)",
            display: "grid",
            gridTemplateColumns: `repeat(${LABELS_PER_ROW}, ${LABEL_WIDTH_MM}mm)`,
            gridTemplateRows: `repeat(${LABELS_PER_COLUMN}, ${LABEL_HEIGHT_MM}mm)`,
            justifyContent: "center",
          }}
        >
          {pageDeliveries.map((delivery) => (
            <div key={delivery.id} className="label" style={{ boxSizing: "border-box", border: "1px solid #000", padding: "4mm", display: "flex", flexDirection: "column", gap: "1.5mm", overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "2mm" }}>
                {branding.logoDataUrl && (
                  // eslint-disable-next-line @next/next/no-img-element -- a client-generated data: URI, not a static/remote asset Next's image pipeline could optimize
                  <img src={branding.logoDataUrl} alt="" style={{ maxHeight: "8mm", maxWidth: "22mm", objectFit: "contain", flex: "0 0 auto" }} />
                )}
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".04em", color: "#000", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{branding.name || "TRACKFLEET"}</div>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "3mm", flex: 1, minHeight: 0 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, wordBreak: "break-word" }}>{delivery.id}</div>
                  <div style={{ fontSize: 12, marginTop: "1.5mm", wordBreak: "break-word" }}>{delivery.customer}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, marginTop: "0.5mm", wordBreak: "break-word" }}>→ {delivery.destination}</div>
                  {delivery.truck && <div style={{ fontSize: 11, marginTop: "0.5mm", color: "#333" }}>Camion : {delivery.truck}</div>}
                </div>
                {delivery.parcelCode ? (
                  <canvas ref={(element) => { if (element) qrCanvases.current.set(delivery.id, element); }} style={{ width: "28mm", height: "28mm", flex: "0 0 auto" }} />
                ) : (
                  <div style={{ width: "28mm", height: "28mm", flex: "0 0 auto", border: "1px dashed #999", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#999", textAlign: "center", padding: "2mm" }}>
                    Code non disponible
                  </div>
                )}
              </div>
              {delivery.parcelCode && (
                <canvas ref={(element) => { if (element) barcodeCanvases.current.set(delivery.id, element); }} style={{ width: "100%", height: "9mm", flex: "0 0 auto" }} />
              )}
            </div>
          ))}
        </div>
      ))}
    </main>
  );
}
