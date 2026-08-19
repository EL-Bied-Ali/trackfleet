"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BULK_DELIVERY_CSV_TEMPLATE,
  parseBulkDeliveryCsv,
  type BulkDeliveryDraft,
} from "../lib/bulk-delivery-import";

type ImportStatus = "pending" | "success" | "failed";
type ImportRow = BulkDeliveryDraft & { status: ImportStatus; error?: string };

function downloadTemplate() {
  const blob = new Blob([BULK_DELIVERY_CSV_TEMPLATE], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "trackfleet-deliveries-template.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

async function importOne(row: BulkDeliveryDraft) {
  const response = await fetch("/api/deliveries", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      customer: row.customer,
      destination: row.destination,
      originSiteId: row.originSiteId,
      destinationSiteId: row.destinationSiteId,
      plannedArrivalAt: row.plannedArrivalAt,
      contact: row.contact,
      truck: row.truck,
      sendatrackVehicleId: row.sendatrackVehicleId,
      whatsappOptIn: row.whatsappOptIn,
    }),
  });
  const body = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
}

export default function BulkImportPage() {
  const [auth, setAuth] = useState<"loading" | "ready" | "denied">("loading");
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch("/api/auth/session", { cache: "no-store" })
      .then((response) => { if (active) setAuth(response.ok ? "ready" : "denied"); })
      .catch(() => { if (active) setAuth("denied"); });
    return () => { active = false; };
  }, []);

  const summary = useMemo(() => ({
    pending: rows.filter((row) => row.status === "pending").length,
    success: rows.filter((row) => row.status === "success").length,
    failed: rows.filter((row) => row.status === "failed").length,
  }), [rows]);

  async function chooseFile(file: File | null) {
    if (!file) return;
    setFileName(file.name);
    setBusy(false);
    const text = await file.text();
    const parsed = parseBulkDeliveryCsv(text);
    setErrors(parsed.errors);
    setRows(parsed.rows.map((row) => ({ ...row, status: "pending" })));
  }

  async function runImport() {
    if (busy || errors.length || !rows.length) return;
    setBusy(true);
    const queue = rows.map((row, index) => ({ row, index })).filter(({ row }) => row.status !== "success");
    let cursor = 0;
    async function worker() {
      while (cursor < queue.length) {
        const current = queue[cursor++];
        try {
          await importOne(current.row);
          setRows((existing) => existing.map((row, index) => index === current.index ? { ...row, status: "success", error: undefined } : row));
        } catch (error) {
          const message = error instanceof Error ? error.message : "Import failed";
          setRows((existing) => existing.map((row, index) => index === current.index ? { ...row, status: "failed", error: message } : row));
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, queue.length) }, () => worker()));
    setBusy(false);
  }

  if (auth === "loading") return <main style={{ padding: 40, fontFamily: "system-ui" }}>Chargement…</main>;
  if (auth === "denied") return (
    <main style={{ padding: 40, fontFamily: "system-ui", maxWidth: 720, margin: "0 auto" }}>
      <h1>Connexion requise</h1>
      <p>Connectez-vous d’abord à TrackFleet avant d’importer des livraisons.</p>
      <a href="/">Retour à TrackFleet</a>
    </main>
  );

  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 1180, margin: "0 auto", padding: "32px 24px 64px", color: "#111827" }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", marginBottom: 28 }}>
        <div>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 700, letterSpacing: ".12em", color: "#6b7280" }}>TRACKFLEET · IMPORT</p>
          <h1 style={{ margin: "6px 0" }}>Importer des livraisons en masse</h1>
          <p style={{ margin: 0, color: "#6b7280" }}>Prévisualisez et validez jusqu’à 100 colis avant de les créer.</p>
        </div>
        <a href="/" style={{ color: "#111827", fontWeight: 700 }}>← Dashboard</a>
      </header>

      <section style={{ border: "1px solid #e5e7eb", borderRadius: 16, padding: 20, marginBottom: 20 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
          <label style={{ display: "inline-flex", padding: "10px 16px", borderRadius: 10, background: "#111827", color: "white", fontWeight: 700, cursor: "pointer" }}>
            Choisir un CSV
            <input type="file" accept=".csv,text/csv" hidden onChange={(event) => void chooseFile(event.target.files?.[0] ?? null)} />
          </label>
          <button type="button" onClick={downloadTemplate} style={{ padding: "10px 16px", border: "1px solid #d1d5db", borderRadius: 10, background: "white", fontWeight: 700, cursor: "pointer" }}>Télécharger le modèle</button>
          {fileName && <span style={{ color: "#6b7280" }}>{fileName}</span>}
        </div>
        <p style={{ marginBottom: 0, color: "#6b7280", fontSize: 14 }}>
          Colonnes obligatoires : <code>customer</code>, <code>destination</code>, <code>planned_arrival_at</code>, <code>truck</code>. Les autres colonnes sont facultatives.
        </p>
      </section>

      {errors.length > 0 && (
        <section style={{ border: "1px solid #fecaca", background: "#fef2f2", borderRadius: 16, padding: 18, marginBottom: 20 }}>
          <strong>Le fichier contient des erreurs :</strong>
          <ul>{errors.slice(0, 20).map((error) => <li key={error}>{error}</li>)}</ul>
          {errors.length > 20 && <p>… et {errors.length - 20} autres erreurs.</p>}
        </section>
      )}

      {rows.length > 0 && (
        <>
          <section style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
            <strong>{rows.length} lignes valides</strong>
            <span>À importer : {summary.pending}</span>
            <span>Créées : {summary.success}</span>
            <span>Échecs : {summary.failed}</span>
            <button
              type="button"
              disabled={busy || errors.length > 0 || summary.pending + summary.failed === 0}
              onClick={() => void runImport()}
              style={{ marginLeft: "auto", padding: "10px 18px", border: 0, borderRadius: 10, background: busy ? "#9ca3af" : "#111827", color: "white", fontWeight: 700, cursor: busy ? "default" : "pointer" }}
            >
              {busy ? "Import en cours…" : summary.failed ? "Réessayer les échecs" : "Importer les livraisons"}
            </button>
          </section>

          <div style={{ overflowX: "auto", border: "1px solid #e5e7eb", borderRadius: 16 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead><tr style={{ textAlign: "left", background: "#f9fafb" }}>
                {['Ligne', 'Client', 'Destination', 'Arrivée prévue', 'Camion', 'Contact', 'WhatsApp', 'État'].map((label) => <th key={label} style={{ padding: 12, borderBottom: "1px solid #e5e7eb" }}>{label}</th>)}
              </tr></thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.rowNumber}>
                    <td style={{ padding: 12, borderBottom: "1px solid #f3f4f6" }}>{row.rowNumber}</td>
                    <td style={{ padding: 12, borderBottom: "1px solid #f3f4f6" }}>{row.customer}</td>
                    <td style={{ padding: 12, borderBottom: "1px solid #f3f4f6" }}>{row.destination}</td>
                    <td style={{ padding: 12, borderBottom: "1px solid #f3f4f6" }}>{new Date(row.plannedArrivalAt).toLocaleString()}</td>
                    <td style={{ padding: 12, borderBottom: "1px solid #f3f4f6" }}>{row.truck}</td>
                    <td style={{ padding: 12, borderBottom: "1px solid #f3f4f6" }}>{row.contact || "—"}</td>
                    <td style={{ padding: 12, borderBottom: "1px solid #f3f4f6" }}>{row.whatsappOptIn ? "Oui" : "Non"}</td>
                    <td style={{ padding: 12, borderBottom: "1px solid #f3f4f6", maxWidth: 260 }}>
                      {row.status === "success" ? "✓ Créée" : row.status === "failed" ? `Échec : ${row.error}` : "Prête"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}
