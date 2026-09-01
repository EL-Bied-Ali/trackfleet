"use client";

import { useMemo, useState } from "react";
import {
  BULK_DELIVERY_CSV_TEMPLATE,
  parseBulkDeliveryCsv,
  type BulkDeliveryDraft,
} from "../lib/bulk-delivery-import";
import { UNASSIGNED_TRUCK } from "../lib/delivery-vehicle-choice";
import { computeDeliveryPrice } from "../lib/delivery-pricing";
import { knownSites } from "../lib/known-sites";
import { AppShellLayout } from "../AppShellLayout";

type ImportStatus = "pending" | "success" | "failed";
type ImportRow = BulkDeliveryDraft & { idempotencyKey: string; status: ImportStatus; error?: string };

function downloadTemplate() {
  const blob = new Blob([BULK_DELIVERY_CSV_TEMPLATE], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "trackfleet-deliveries-template.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

async function importOne(row: ImportRow) {
  const response = await fetch("/api/deliveries", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": row.idempotencyKey,
    },
    body: JSON.stringify({
      customer: row.customer,
      destination: row.destination,
      originSiteId: row.originSiteId,
      destinationSiteId: row.destinationSiteId,
      plannedArrivalAt: row.plannedArrivalAt,
      nextTruckDepartureAt: row.nextTruckDepartureAt,
      contact: row.contact,
      recipientName: row.recipientName,
      recipientContact: row.recipientContact,
      truck: row.truck,
      sendatrackVehicleId: row.sendatrackVehicleId,
      whatsappOptIn: row.whatsappOptIn,
      weightKg: row.weightKg,
    }),
  });
  const body = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
}

export default function BulkImportPage() {
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);

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
    setRows(parsed.rows.map((row) => ({ ...row, idempotencyKey: crypto.randomUUID(), status: "pending" })));
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

  return (
    <AppShellLayout activePage="overview" locale="fr">
      <div className="topbar">
        <div>
          <p className="eyebrow">TRACKFLEET · IMPORT</p>
          <h1>Importer des livraisons en masse</h1>
          <p>Prévisualisez et validez jusqu’à 100 colis avant de les créer.</p>
        </div>
      </div>

      <section className="deliveries-panel" style={{ padding: 20, marginBottom: 20 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
          <label className="primary-button" style={{ cursor: "pointer" }}>
            Choisir un CSV
            <input type="file" accept=".csv,text/csv" hidden onChange={(event) => void chooseFile(event.target.files?.[0] ?? null)} />
          </label>
          <button type="button" className="secondary-button" onClick={downloadTemplate}>Télécharger le modèle</button>
          {fileName && <span>{fileName}</span>}
        </div>
        <p style={{ marginBottom: 0, fontSize: 14 }}>
          Colonnes obligatoires : <code>customer</code>, <code>destination</code>, <code>origin_site_id</code> (nécessaire pour calculer le prix). Le camion, les dates d’arrivée/départ et les autres colonnes sont facultatifs -- les dates peuvent être renseignées plus tard depuis le tableau des livraisons.
        </p>
      </section>

      {errors.length > 0 && (
        <section className="deliveries-empty" style={{ marginBottom: 20 }}>
          <div>
            <strong>Le fichier contient des erreurs :</strong>
            <ul>{errors.slice(0, 20).map((error) => <li key={error}>{error}</li>)}</ul>
            {errors.length > 20 && <p>… et {errors.length - 20} autres erreurs.</p>}
          </div>
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
              className="primary-button"
              disabled={busy || errors.length > 0 || summary.pending + summary.failed === 0}
              onClick={() => void runImport()}
              style={{ marginLeft: "auto" }}
            >
              {busy ? "Import en cours…" : summary.failed ? "Réessayer les échecs" : "Importer les livraisons"}
            </button>
          </section>

          <div className="deliveries-panel">
            <table>
              <thead><tr>
                {["Ligne", "Client", "Destination", "Poids", "Prix estimé", "Arrivée prévue", "Camion", "Contact", "WhatsApp", "État"].map((label) => <th key={label}>{label}</th>)}
              </tr></thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.rowNumber}>
                    <td>{row.rowNumber}</td>
                    <td>{row.customer}</td>
                    <td>{row.destination}</td>
                    <td>{row.weightKg == null ? "—" : `${row.weightKg} kg`}</td>
                    <td>{(() => {
                      const originCountry = knownSites.find((site) => site.id === row.originSiteId)?.country ?? null;
                      const { priceAmount, priceCurrency } = computeDeliveryPrice(row.weightKg, originCountry);
                      return priceAmount == null ? "—" : `${priceAmount.toFixed(2)} ${priceCurrency}`;
                    })()}</td>
                    <td>{row.plannedArrivalAt ? new Date(row.plannedArrivalAt).toLocaleString() : "—"}</td>
                    <td>{row.truck === UNASSIGNED_TRUCK ? "À affecter" : row.truck}</td>
                    <td>{row.contact || "—"}</td>
                    <td>{row.whatsappOptIn ? "Oui" : "Non"}</td>
                    <td style={{ maxWidth: 260 }}>
                      {row.status === "success" ? "✓ Créée" : row.status === "failed" ? `Échec : ${row.error}` : "Prête"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </AppShellLayout>
  );
}
