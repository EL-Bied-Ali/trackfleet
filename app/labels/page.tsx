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
// There's no universal standard for a physical pre-cut sheet's exact label
// size or printed gutter, so width/height are editable right on this page
// (see LabelSizeControls below) instead of fixed constants -- test-print one
// sheet against your actual label paper and adjust until it lines up, no
// code change needed. Remembered per browser via localStorage so it's a
// one-time setup, not a per-print chore.
const DEFAULT_LABEL_WIDTH_MM = 100;
const DEFAULT_LABEL_HEIGHT_MM = 65;
const LABEL_SIZE_STORAGE_KEY = "trackfleet-label-size-mm";
const MIN_LABEL_MM = 40;
const MAX_LABEL_MM = 200;
const PAGE_WIDTH_MM = 210;
const PAGE_HEIGHT_MM = 297;

// Each preset divides the A4 sheet exactly (cols/rows chosen so
// PAGE_WIDTH_MM/PAGE_HEIGHT_MM come out even) -- the whole sheet is used,
// no leftover margin strip on the right or bottom the way an arbitrary
// width/height can leave. Not tied to any specific commercial label
// product (there's no single standard) -- a starting point to test-print
// against your actual sheet, then fine-tune with the manual mm inputs.
const LABEL_PRESETS: Array<{ cols: number; rows: number }> = [
  { cols: 1, rows: 2 },
  { cols: 2, rows: 2 },
  { cols: 2, rows: 3 },
  { cols: 2, rows: 4 },
  { cols: 2, rows: 5 },
  { cols: 3, rows: 4 },
];

function clampLabelMm(value: number, fallback: number) {
  return Number.isFinite(value) ? Math.min(MAX_LABEL_MM, Math.max(MIN_LABEL_MM, value)) : fallback;
}

function readStoredLabelSize(): { width: number; height: number } {
  if (typeof window === "undefined") return { width: DEFAULT_LABEL_WIDTH_MM, height: DEFAULT_LABEL_HEIGHT_MM };
  try {
    const raw = window.localStorage.getItem(LABEL_SIZE_STORAGE_KEY);
    if (!raw) return { width: DEFAULT_LABEL_WIDTH_MM, height: DEFAULT_LABEL_HEIGHT_MM };
    const parsed = JSON.parse(raw) as { width?: number; height?: number };
    return {
      width: clampLabelMm(Number(parsed.width), DEFAULT_LABEL_WIDTH_MM),
      height: clampLabelMm(Number(parsed.height), DEFAULT_LABEL_HEIGHT_MM),
    };
  } catch {
    return { width: DEFAULT_LABEL_WIDTH_MM, height: DEFAULT_LABEL_HEIGHT_MM };
  }
}

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
  const [labelSize, setLabelSize] = useState(() => readStoredLabelSize());
  const qrCanvases = useRef(new Map<string, HTMLCanvasElement>());

  function updateLabelSize(next: { width?: number; height?: number }) {
    setLabelSize((current) => {
      const updated = {
        width: clampLabelMm(next.width ?? current.width, current.width),
        height: clampLabelMm(next.height ?? current.height, current.height),
      };
      try { window.localStorage.setItem(LABEL_SIZE_STORAGE_KEY, JSON.stringify(updated)); } catch { /* per-viewer convenience only */ }
      return updated;
    });
  }

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
      // Code128 barcode dropped (was the only other consumer of the
      // jsbarcode import): it only ever added value paired with a
      // dedicated handheld barcode scanner, which nobody here owns -- the
      // parcel code is already printed as plain text under the QR for
      // manual entry, so the barcode image itself was pure duplication for
      // now. Easy to bring back if that hardware shows up later.
      const { default: QRCode } = await import("qrcode");
      if (cancelled) return;
      const origin = window.location.origin;
      for (const delivery of deliveries) {
        if (!delivery.parcelCode) continue;
        const qrCanvas = qrCanvases.current.get(delivery.id);
        if (qrCanvas) {
          await QRCode.toCanvas(qrCanvas, parcelScanUrl(origin, delivery.parcelCode), { width: 160, margin: 1 });
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

  const labelsPerRow = Math.max(1, Math.floor(PAGE_WIDTH_MM / labelSize.width));
  const labelsPerColumn = Math.max(1, Math.floor(PAGE_HEIGHT_MM / labelSize.height));
  const labelsPerPage = labelsPerRow * labelsPerColumn;
  const pages = chunk(deliveries, labelsPerPage);

  async function handlePrint() {
    const deliveryIds = deliveries.map((delivery) => delivery.id);
    try {
      // We only mark the action once the dispatcher chooses the real print
      // action, not merely when they open this preview tab.
      if (deliveryIds.length) await fetch("/api/deliveries/label-print", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deliveryIds }),
      });
    } finally {
      window.print();
    }
  }

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

      <div className="no-print" style={{ padding: "16px 24px", background: "#111827", color: "#fff" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <p style={{ margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: ".12em", color: "#9ca3af" }}>TRACKFLEET · ÉTIQUETTES</p>
            <h1 style={{ margin: "4px 0 0", fontSize: 18 }}>{deliveries.length} étiquette{deliveries.length > 1 ? "s" : ""} prête{deliveries.length > 1 ? "s" : ""}</h1>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "#9ca3af" }}>{labelsPerPage} par feuille A4 ({labelSize.width}×{labelSize.height}mm) · {pages.length} feuille{pages.length > 1 ? "s" : ""}</p>
          </div>
          <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#c9cdd3" }}>
              Largeur
              <input type="number" min={MIN_LABEL_MM} max={MAX_LABEL_MM} step={1} value={labelSize.width} onChange={(event) => updateLabelSize({ width: Number(event.target.value) })} style={{ width: 52, padding: "5px 6px", borderRadius: 6, border: "1px solid #374151", background: "#1f2937", color: "#fff", fontSize: 12 }} />
              mm
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#c9cdd3" }}>
              Hauteur
              <input type="number" min={MIN_LABEL_MM} max={MAX_LABEL_MM} step={1} value={labelSize.height} onChange={(event) => updateLabelSize({ height: Number(event.target.value) })} style={{ width: 52, padding: "5px 6px", borderRadius: 6, border: "1px solid #374151", background: "#1f2937", color: "#fff", fontSize: 12 }} />
              mm
            </label>
            <Link href="/?lang=fr" style={{ color: "#fff", fontWeight: 700, fontSize: 13, alignSelf: "center" }}>← Tableau</Link>
            <button type="button" onClick={() => void handlePrint()} disabled={!deliveries.length} style={{ padding: "10px 18px", borderRadius: 10, border: 0, background: "#22c55e", color: "#052e12", fontWeight: 700, cursor: deliveries.length ? "pointer" : "default" }}>
              Imprimer
            </button>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
          <span style={{ fontSize: 11, color: "#9ca3af" }}>Préconfigurations (feuille A4 utilisée entièrement) :</span>
          {LABEL_PRESETS.map((preset) => {
            const presetWidth = Math.floor((PAGE_WIDTH_MM / preset.cols) * 100) / 100;
            const presetHeight = Math.floor((PAGE_HEIGHT_MM / preset.rows) * 100) / 100;
            const active = labelSize.width === presetWidth && labelSize.height === presetHeight;
            return (
              <button
                key={`${preset.cols}x${preset.rows}`}
                type="button"
                onClick={() => updateLabelSize({ width: presetWidth, height: presetHeight })}
                style={{
                  padding: "5px 10px",
                  borderRadius: 999,
                  border: active ? "1px solid #22c55e" : "1px solid #374151",
                  background: active ? "#052e12" : "#1f2937",
                  color: active ? "#22c55e" : "#c9cdd3",
                  fontSize: 11,
                  fontWeight: 650,
                  cursor: "pointer",
                }}
              >
                {preset.cols * preset.rows}/feuille
              </button>
            );
          })}
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
            gridTemplateColumns: `repeat(${labelsPerRow}, ${labelSize.width}mm)`,
            gridTemplateRows: `repeat(${labelsPerColumn}, ${labelSize.height}mm)`,
            justifyContent: "center",
          }}
        >
          {pageDeliveries.map((delivery) => (
            // Two real columns spanning the label's full height (not a
            // header row above a content row) -- reported live as a big
            // empty gap next to the logo, since the QR only ever sat in
            // the lower content row while the header row above it had
            // nothing on its right side. The QR/code column now runs the
            // full height, growing with whatever space the logo+text
            // column doesn't need.
            <div key={delivery.id} className="label" style={{ boxSizing: "border-box", border: "1px solid #000", padding: "4mm", display: "flex", gap: "3mm", overflow: "hidden" }}>
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "1.5mm" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "3mm" }}>
                  {branding.logoDataUrl && (
                    // eslint-disable-next-line @next/next/no-img-element -- a client-generated data: URI, not a static/remote asset Next's image pipeline could optimize
                    <img src={branding.logoDataUrl} alt="" style={{ maxHeight: "19mm", maxWidth: "46mm", objectFit: "contain", flex: "0 0 auto" }} />
                  )}
                  <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".04em", color: "#000", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{branding.name || "TRACKFLEET"}</div>
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, wordBreak: "break-word" }}>{delivery.id}</div>
                <div style={{ fontSize: 12, wordBreak: "break-word" }}>{delivery.customer}</div>
                <div style={{ fontSize: 12, fontWeight: 700, wordBreak: "break-word" }}>→ {delivery.destination}</div>
                {delivery.truck && <div style={{ fontSize: 11, color: "#333" }}>Camion : {delivery.truck}</div>}
              </div>
              {delivery.parcelCode ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1.5mm", flex: "0 0 auto" }}>
                  <canvas ref={(element) => { if (element) qrCanvases.current.set(delivery.id, element); }} style={{ width: "28mm", height: "28mm" }} />
                  {/* Plain-text fallback for manual entry on /scan when no
                      camera/scanner is available -- see the barcode
                      removal note above for why this replaced the
                      Code128 image instead of just disappearing with it. */}
                  <div style={{ fontSize: 9, fontFamily: "monospace", letterSpacing: ".05em", color: "#333" }}>{delivery.parcelCode}</div>
                </div>
              ) : (
                <div style={{ width: "28mm", height: "28mm", flex: "0 0 auto", alignSelf: "center", border: "1px dashed #999", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#999", textAlign: "center", padding: "2mm" }}>
                  Code non disponible
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </main>
  );
}
