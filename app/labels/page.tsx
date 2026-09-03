"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { parcelScanUrl } from "../lib/parcel-code";

type LabelDelivery = {
  id: string;
  customer: string;
  contact: string;
  recipientName: string | null;
  recipientContact: string | null;
  destination: string;
  destinationSiteId: string | null;
  originSiteId: string | null;
  truck: string;
  weightKg: number | null;
  priceAmount: number | null;
  priceCurrency: "EUR" | "MAD" | null;
  paymentStatus: "unpaid" | "partial" | "paid" | null;
  amountPaid: number | null;
  parcelCode: string | null;
  // Human-friendly per-destination sequence (e.g. "CAS 00"), additional to
  // and never replacing `id` -- null for a destination with no
  // shortCodePrefix configured yet, or for a delivery created before this
  // existed. Shown here in large type -- the label's main identifier for a
  // human routing the parcel by hand, per the client's own request.
  shortCode: string | null;
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
// Caught live: this used to be 40mm, which is ABOVE the 16/feuille
// preset's own 37.125mm height -- clicking that preset silently clamped
// it back up to 40mm (via clampLabelMm below), landing on 14/feuille
// instead. Lowered just enough to clear the shortest preset with a little
// headroom, not down to some arbitrary small number.
const MIN_LABEL_MM = 35;
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
  // 2x8 (16/feuille, 105x37.125mm) was requested after 3x4 (12/feuille)
  // shipped -- roughly half that preset's height. The earlier 3x6
  // (18/feuille, 49.5mm) attempt was reverted because the label's text
  // lines wrapped and overflowed at that height; that specific failure
  // mode is gone now (destination is city-only and every text line
  // truncates instead of wrapping -- see the label cell below), so what's
  // left to fit is just the fixed-size chrome: padding, the QR code, and
  // the optional logo. Those now scale down with the label's own height
  // (labelPadding/qrSizeMm/logoMaxHeightMm below) instead of staying fixed,
  // specifically so this preset doesn't clip. Verified live against a full
  // sheet of real deliveries (scrollHeight vs clientHeight, 0px overflow)
  // before shipping -- see project_label_16_per_sheet memory.
  { cols: 2, rows: 8 },
];

// Compact payment summary for the label's weight/price/payment line, e.g.
// "12.3kg · 18€ · Payé" or "12.3kg · 18€ · Reste 5€". Currency symbol kept
// terse (€ / MAD) to fit the same line as weight and status.
function paymentSummary(delivery: LabelDelivery): string | null {
  const currencySuffix = delivery.priceCurrency === "MAD" ? " MAD" : "€";
  const parts: string[] = [];
  if (delivery.weightKg != null) parts.push(`${delivery.weightKg}kg`);
  if (delivery.priceAmount != null) parts.push(`${delivery.priceAmount}${currencySuffix}`);
  if (delivery.paymentStatus === "paid") parts.push("Payé");
  else if (delivery.paymentStatus === "unpaid") parts.push("Impayé");
  else if (delivery.paymentStatus === "partial") {
    parts.push(delivery.priceAmount != null && delivery.amountPaid != null
      ? `Reste ${Math.round((delivery.priceAmount - delivery.amountPaid) * 100) / 100}${currencySuffix}`
      : "Partiel");
  }
  return parts.length ? parts.join(" · ") : null;
}

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

// A physical A4 label sheet is frequently only partly used -- the previous
// print run took the first few positions, and the rest are still blank
// adhesive labels worth reusing rather than wasting. `blockedCells` holds
// the 0-based, row-major grid positions the dispatcher has marked as
// already peeled off on the sheet currently in the printer; only the FIRST
// page (the physical sheet actually in hand) respects it -- any further
// pages are assumed to print on fresh sheets, so they always fill from
// position 0. Blocked positions stay in the output as an empty slot (no
// delivery placed there) so every real delivery still lands on the
// physical position it visually corresponds to in the on-screen grid.
function layoutLabelPages<T>(items: T[], labelsPerPage: number, blockedCells: Set<number>): Array<Array<T | null>> {
  if (!items.length) return [];
  const pages: Array<Array<T | null>> = [];
  const queue = [...items];
  let pageIndex = 0;
  while (queue.length > 0) {
    const blocked = pageIndex === 0 ? blockedCells : new Set<number>();
    const slots: Array<T | null> = [];
    for (let i = 0; i < labelsPerPage; i += 1) slots.push(blocked.has(i) ? null : (queue.shift() ?? null));
    pages.push(slots);
    pageIndex += 1;
  }
  return pages;
}

export default function LabelsPage() {
  const [auth, setAuth] = useState<"loading" | "ready" | "denied">("loading");
  const [deliveries, setDeliveries] = useState<LabelDelivery[]>([]);
  const [loadError, setLoadError] = useState("");
  const [branding, setBranding] = useState<LabelBranding>(emptyBranding);
  // The agency's city alone (e.g. "Marrakech"), not the full postal address
  // and not even the site's own longer label ("Marrakech · Boulevard
  // Essaouira") -- both were tried live against a real label and both still
  // wrapped across lines and got silently clipped by the label's own
  // overflow:hidden, even on the previously "safe" 12/feuille. Every known
  // site today is in a distinct city, so the city alone still uniquely
  // identifies the destination for a human routing a physical parcel; the
  // full address and precise agency name stay on the tracking page where
  // there's room for them. Falls back to the full address when there's no
  // matching site (id missing or not found).
  const [siteCities, setSiteCities] = useState<Map<string, string>>(new Map());
  const [labelSize, setLabelSize] = useState(() => readStoredLabelSize());
  // Which grid positions on the physical sheet already in hand are already
  // used -- not persisted (a one-off adjustment right before printing, not
  // a lasting setting like labelSize), and reset whenever the grid's own
  // shape changes below, since a cell index only means anything for the
  // grid dimensions it was picked against.
  const [blockedCells, setBlockedCells] = useState<Set<number>>(new Set());
  const qrCanvases = useRef(new Map<string, HTMLCanvasElement>());
  // Needed by the QR-drawing effect below (hooks run before the early
  // auth returns, so these have to live up here rather than beside the
  // rest of the labelSize-derived layout math further down).
  const labelPaddingMm = Math.min(4, Math.max(1.5, labelSize.height * 0.05));
  const qrSizeMm = Math.min(28, Math.max(14, labelSize.height - 2 * labelPaddingMm - 5.5));

  function updateLabelSize(next: { width?: number; height?: number }) {
    setLabelSize((current) => {
      const updated = {
        width: clampLabelMm(next.width ?? current.width, current.width),
        height: clampLabelMm(next.height ?? current.height, current.height),
      };
      try { window.localStorage.setItem(LABEL_SIZE_STORAGE_KEY, JSON.stringify(updated)); } catch { /* per-viewer convenience only */ }
      return updated;
    });
    // A blocked cell index only means anything for the grid shape it was
    // picked against -- changing the label size changes the grid, so any
    // existing selection would silently point at the wrong physical spot.
    setBlockedCells(new Set());
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
    void fetch("/api/sites", { cache: "no-store" })
      .then((response) => response.json() as Promise<{ sites?: Array<{ id: string; city: string }> }>)
      .then((data) => { if (active) setSiteCities(new Map((data.sites ?? []).map((site) => [site.id, site.city]))); })
      .catch(() => { if (active) setSiteCities(new Map()); });
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
          // Caught live: the qrcode library sets the canvas's own
          // style.width/height to match its raster size (160px) as part of
          // toCanvas, silently overriding the mm-based CSS size the JSX
          // below sets -- every printed label's QR column was rendering at
          // ~42mm regardless of preset, overflowing the label by a fixed
          // ~20px no matter what content it held. Re-asserted here, after
          // the library has had its say, so the intended print size always
          // wins.
          qrCanvas.style.width = `${qrSizeMm}mm`;
          qrCanvas.style.height = `${qrSizeMm}mm`;
        }
      }
    })();
    return () => { cancelled = true; };
  }, [deliveries, qrSizeMm]);

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
  const showExtendedDetails = labelSize.height >= 55;
  // logoMaxHeightMm scales the same way as labelPaddingMm/qrSizeMm above
  // (declared earlier in the component so the QR-drawing effect can use
  // them) -- fixed at 19mm, it fit every preset up to 12/feuille (74.25mm)
  // fine, but at 16/feuille (37.125mm) it alone would eat most of the
  // label's height before a single line of text is drawn. Capped tighter
  // still (0.13 not 0.22) below 55mm now that the compact layout also
  // carries every field the extended one does (see showExtendedDetails'
  // own comment) -- there's no spare room left for a tall logo.
  const logoMaxHeightMm = showExtendedDetails ? Math.min(19, labelSize.height * 0.22) : Math.min(19, labelSize.height * 0.13);
  // Client asked for every field the extended layout has (origin, phone,
  // weight, price/payment, recipient) to also fit on 16/feuille -- not
  // just the shortCode/customer/destination/truck subset this used to
  // stop at. Rather than duplicate the extended branch's own JSX, the
  // compact branch below now renders the exact same fields, just smaller
  // and with sender name/phone merged onto one line (see the branch
  // itself) -- live-verified against a real 16/feuille sheet with a real
  // logo, full payment/recipient data, at 0px overflow before shipping.
  const pages = layoutLabelPages(deliveries, labelsPerPage, blockedCells);
  const toggleBlockedCell = (index: number) => setBlockedCells((current) => {
    const next = new Set(current);
    if (next.has(index)) next.delete(index); else next.add(index);
    return next;
  });

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
        {labelsPerPage > 1 && (
          <div style={{ display: "flex", gap: 14, alignItems: "flex-start", marginTop: 14, paddingTop: 14, borderTop: "1px solid #374151" }}>
            <div>
              <span style={{ display: "block", fontSize: 11, color: "#9ca3af", marginBottom: 6 }}>
                Feuille déjà entamée ? Cliquez les étiquettes déjà utilisées pour les sauter{blockedCells.size > 0 ? ` (${blockedCells.size} sautée${blockedCells.size > 1 ? "s" : ""})` : ""} :
              </span>
              <div style={{ display: "grid", gridTemplateColumns: `repeat(${labelsPerRow}, 20px)`, gridTemplateRows: `repeat(${labelsPerColumn}, 20px)`, gap: 3 }}>
                {Array.from({ length: labelsPerPage }, (_, index) => {
                  const blocked = blockedCells.has(index);
                  return (
                    <button
                      key={index}
                      type="button"
                      onClick={() => toggleBlockedCell(index)}
                      aria-pressed={blocked}
                      aria-label={`Étiquette ${index + 1}${blocked ? ", déjà utilisée, sautée à l'impression" : ", disponible"}`}
                      style={{
                        width: 20,
                        height: 20,
                        padding: 0,
                        borderRadius: 4,
                        border: blocked ? "1px solid #6b7280" : "1px solid #22c55e",
                        background: blocked ? "#374151" : "#052e12",
                        cursor: "pointer",
                      }}
                    />
                  );
                })}
              </div>
            </div>
            {blockedCells.size > 0 && (
              <button type="button" onClick={() => setBlockedCells(new Set())} style={{ alignSelf: "center", padding: "6px 12px", borderRadius: 8, border: "1px solid #374151", background: "#1f2937", color: "#c9cdd3", fontSize: 11, fontWeight: 650, cursor: "pointer" }}>
                Réinitialiser
              </button>
            )}
          </div>
        )}
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
          {pageDeliveries.map((delivery, slotIndex) => delivery === null ? (
            // An already-used position on the physical sheet -- nothing
            // printed here (no border, no content), so it stays genuinely
            // blank rather than overprinting a real label that's already
            // been peeled off and used.
            <div key={`empty-${pageIndex}-${slotIndex}`} />
          ) : (
            // Two real columns spanning the label's full height (not a
            // header row above a content row) -- reported live as a big
            // empty gap next to the logo, since the QR only ever sat in
            // the lower content row while the header row above it had
            // nothing on its right side. The QR/code column now runs the
            // full height, growing with whatever space the logo+text
            // column doesn't need.
            <div key={delivery.id} className="label" style={{ boxSizing: "border-box", border: "1px solid #000", padding: `${labelPaddingMm}mm`, display: "flex", gap: "3mm", overflow: "hidden" }}>
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: showExtendedDetails ? "1.5mm" : "0.65mm" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "3mm" }}>
                  {branding.logoDataUrl && (
                    // eslint-disable-next-line @next/next/no-img-element -- a client-generated data: URI, not a static/remote asset Next's image pipeline could optimize
                    <img src={branding.logoDataUrl} alt="" style={{ maxHeight: `${logoMaxHeightMm}mm`, maxWidth: "46mm", objectFit: "contain", flex: "0 0 auto" }} />
                  )}
                  <div style={{ fontSize: showExtendedDetails ? 12 : 9.5, fontWeight: 700, letterSpacing: ".04em", lineHeight: showExtendedDetails ? "normal" : 1.1, color: "#000", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{branding.name || "TRACKFLEET"}</div>
                </div>
                {showExtendedDetails ? (<>
                  {/* The client's own big, primary identifier for routing
                      by hand -- "en très gros". Falls back to the plain id
                      at a smaller (but still bold) size when this
                      destination has no shortCodePrefix configured yet. */}
                  <div style={{ overflow: "hidden" }}>
                    {/* "fond gras" -- a solid dark badge behind the short
                        code, not just bold text, per the client's own
                        original wording. Only the real shortCode gets it;
                        the plain-id fallback (no shortCodePrefix
                        configured yet for this destination) stays plain
                        text, since it's not the "big and clear" primary
                        identifier being called out here. */}
                    <span style={{ display: "inline-block", maxWidth: "100%", fontSize: delivery.shortCode ? 20 : 15, fontWeight: 800, lineHeight: 1.15, color: delivery.shortCode ? "#fff" : "#000", background: delivery.shortCode ? "#000" : "transparent", padding: delivery.shortCode ? "1px 7px" : 0, borderRadius: delivery.shortCode ? 3 : 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{delivery.shortCode ?? delivery.id}</span>
                  </div>
                  {delivery.shortCode && <div style={{ fontSize: 8, fontFamily: "monospace", color: "#666", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{delivery.id}</div>}
                  <div style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{delivery.customer}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{((delivery.originSiteId && siteCities.get(delivery.originSiteId)) || "") + " → " + ((delivery.destinationSiteId && siteCities.get(delivery.destinationSiteId)) || delivery.destination)}</div>
                  {delivery.contact && <div style={{ fontSize: 11, color: "#333", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Tél : {delivery.contact}</div>}
                  {/* The person the parcel is actually handed to at the
                      destination -- distinct from `customer`/`contact`
                      above (the sender), requested separately since a
                      dispatcher at the destination needs to know who to
                      call/ask for, not just who shipped it. */}
                  {(delivery.recipientName || delivery.recipientContact) && (
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#000", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      Destinataire : {[delivery.recipientName, delivery.recipientContact].filter(Boolean).join(" · ")}
                    </div>
                  )}
                  {paymentSummary(delivery) && <div style={{ fontSize: 11, fontWeight: 700, color: "#333", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{paymentSummary(delivery)}</div>}
                  {delivery.truck && <div style={{ fontSize: 11, color: "#333", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Camion : {delivery.truck}</div>}
                </>) : (<>
                  {/* Shortest preset (16/feuille): every field the extended
                      layout carries (origin, recipient, weight/price/
                      payment) now fits here too, just smaller and with
                      sender name+phone merged onto one line -- live-
                      verified against a real sheet (real logo, full
                      payment/recipient data) at 0px overflow before
                      shipping. The plain TF-id is dropped once a
                      shortCode exists (nobody reads it by hand here,
                      unlike the QR/parcelCode below) -- falls back to it
                      only when this destination has no shortCodePrefix
                      configured, so the label always has one identifier. */}
                  <div style={{ overflow: "hidden" }}>
                    <span style={{ display: "inline-block", maxWidth: "100%", fontSize: 16, fontWeight: 800, lineHeight: 1.1, color: delivery.shortCode ? "#fff" : "#000", background: delivery.shortCode ? "#000" : "transparent", padding: delivery.shortCode ? "0.5px 6px" : 0, borderRadius: delivery.shortCode ? 3 : 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{delivery.shortCode ?? delivery.id}</span>
                  </div>
                  <div style={{ fontSize: 11, lineHeight: 1.1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{[delivery.customer, delivery.contact].filter(Boolean).join(" · ")}</div>
                  <div style={{ fontSize: 11, fontWeight: 700, lineHeight: 1.1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{((delivery.originSiteId && siteCities.get(delivery.originSiteId)) || "") + " → " + ((delivery.destinationSiteId && siteCities.get(delivery.destinationSiteId)) || delivery.destination)}</div>
                  {(delivery.recipientName || delivery.recipientContact) && (
                    <div style={{ fontSize: 10.5, fontWeight: 700, lineHeight: 1.1, color: "#000", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      Dest : {[delivery.recipientName, delivery.recipientContact].filter(Boolean).join(" · ")}
                    </div>
                  )}
                  {paymentSummary(delivery) && <div style={{ fontSize: 10.5, fontWeight: 700, lineHeight: 1.1, color: "#333", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{paymentSummary(delivery)}</div>}
                  {delivery.truck && <div style={{ fontSize: 10.5, lineHeight: 1.1, color: "#333", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Camion : {delivery.truck}</div>}
                </>)}
              </div>
              {delivery.parcelCode ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1.5mm", flex: "0 0 auto" }}>
                  <canvas ref={(element) => { if (element) qrCanvases.current.set(delivery.id, element); }} style={{ width: `${qrSizeMm}mm`, height: `${qrSizeMm}mm` }} />
                  {/* Plain-text fallback for manual entry on /scan when no
                      camera/scanner is available -- see the barcode
                      removal note above for why this replaced the
                      Code128 image instead of just disappearing with it. */}
                  <div style={{ fontSize: 9, fontFamily: "monospace", letterSpacing: ".05em", color: "#333" }}>{delivery.parcelCode}</div>
                </div>
              ) : (
                <div style={{ width: `${qrSizeMm}mm`, height: `${qrSizeMm}mm`, flex: "0 0 auto", alignSelf: "center", border: "1px dashed #999", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#999", textAlign: "center", padding: "2mm" }}>
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
