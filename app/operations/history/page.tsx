"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShellLayout } from "../../AppShellLayout";
import type { Locale } from "../../i18n";

type HistoryItem = {
  id: string;
  customer: string;
  destination: string;
  truck: string;
  contact: string;
  recipientName: string;
  recipientContact: string;
  weightKg: number | null;
  priceAmount: number | null;
  priceCurrency: "EUR" | "MAD" | null;
  plannedArrivalAt: string | null;
  createdAt: string;
  locationMismatchBypassedAt: string | null;
};

type HistoryCursor = { beforeCreatedAt: string; beforeId: string };
type HistoryPage = { items: HistoryItem[]; nextCursor: HistoryCursor | null };

// Live request: "can't we attribute actions to the google accounts" --
// the actor is already threaded into the session by company-auth.ts for
// anyone who logged in via Google (their own email), so this list is only
// as personal as how staff actually log in; a shared password-login
// session still shows as the generic account user. Dispatcher-only, same
// gate as the delete-delivery action this exists to make accountable --
// an agency session gets a 401 from the endpoint itself, so this section
// just renders nothing for them rather than erroring.
type AuditLogEntry = {
  id: number;
  actor: string;
  action: "delivery_deleted" | "arrival_confirmed_missing_scans_bypassed" | "arrival_confirmed_location_mismatch_bypassed";
  deliveryId: string | null;
  deliveryCustomer: string | null;
  deliveryDestination: string | null;
  detail: string | null;
  createdAt: string;
};
type AuditLogPage = { items: AuditLogEntry[]; nextCursor: number | null };

function locale(): Locale {
  if (typeof window === "undefined") return "fr";
  const value = new URLSearchParams(window.location.search).get("lang");
  return value === "en" || value === "nl" ? value : "fr";
}

export default function DeliveryHistoryPage() {
  const [language] = useState(locale);
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [cursor, setCursor] = useState<HistoryCursor | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [auditItems, setAuditItems] = useState<AuditLogEntry[]>([]);
  const [auditCursor, setAuditCursor] = useState<number | null>(null);
  const [auditVisible, setAuditVisible] = useState(false);
  const [auditLoadingMore, setAuditLoadingMore] = useState(false);

  const loadPage = useCallback(async (next: HistoryCursor | null, append: boolean) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError(false);
    try {
      const query = new URLSearchParams({ limit: "50" });
      if (next) {
        query.set("beforeCreatedAt", next.beforeCreatedAt);
        query.set("beforeId", next.beforeId);
      }
      const response = await fetch(`/api/operations/history?${query}`, { cache: "no-store" });
      if (!response.ok) throw new Error("history_unavailable");
      const page = await response.json() as HistoryPage;
      setItems((current) => append ? [...current, ...page.items] : page.items);
      setCursor(page.nextCursor);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  const loadAuditPage = useCallback(async (beforeId: number | null, append: boolean) => {
    if (append) setAuditLoadingMore(true);
    try {
      const query = beforeId ? `?beforeId=${beforeId}` : "";
      const response = await fetch(`/api/operations/audit-log${query}`, { cache: "no-store" });
      if (!response.ok) { setAuditVisible(false); return; }
      const page = await response.json() as AuditLogPage;
      setAuditItems((current) => append ? [...current, ...page.items] : page.items);
      setAuditCursor(page.nextCursor);
      setAuditVisible(true);
    } catch {
      setAuditVisible(false);
    } finally {
      setAuditLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void loadPage(null, false), 0);
    const auditInitial = window.setTimeout(() => void loadAuditPage(null, false), 0);
    return () => { window.clearTimeout(initial); window.clearTimeout(auditInitial); };
  }, [loadPage, loadAuditPage]);

  const dateLocale = language === "nl" ? "nl-BE" : language === "en" ? "en-GB" : "fr-BE";
  const copy = language === "nl"
    ? { eyebrow: "TRACKFLEET · HISTORIEK", title: "Leveringsgeschiedenis", empty: "Nog geen voltooide leveringen.", more: "Meer laden", loading: "Geschiedenis laden…", retry: "Opnieuw proberen", error: "Geschiedenis kon niet worden geladen.", weight: "Gewicht", price: "Prijs", auditTitle: "Gevoelige acties", auditMore: "Meer laden" }
    : language === "en"
      ? { eyebrow: "TRACKFLEET · HISTORY", title: "Delivery history", empty: "No completed deliveries yet.", more: "Load more", loading: "Loading history…", retry: "Retry", error: "Unable to load delivery history.", weight: "Weight", price: "Price", auditTitle: "Sensitive actions", auditMore: "Load more" }
      : { eyebrow: "TRACKFLEET · HISTORIQUE", title: "Historique des livraisons", empty: "Aucune livraison terminée pour le moment.", more: "Charger plus", loading: "Chargement de l’historique…", retry: "Réessayer", error: "Impossible de charger l’historique.", weight: "Poids", price: "Prix", auditTitle: "Actions sensibles", auditMore: "Charger plus" };

  const auditActionLabel = (entry: AuditLogEntry) => {
    if (entry.action === "delivery_deleted") {
      return language === "nl" ? "Zending verwijderd" : language === "en" ? "Delivery deleted" : "Livraison supprimée";
    }
    if (entry.action === "arrival_confirmed_missing_scans_bypassed") {
      return language === "nl" ? "Aankomst bevestigd zonder scan" : language === "en" ? "Arrival confirmed without scan" : "Arrivée confirmée sans scan";
    }
    return language === "nl" ? "Aankomst bevestigd, positie onbevestigd" : language === "en" ? "Arrival confirmed, position unconfirmed" : "Arrivée confirmée, position non confirmée";
  };

  return (
    <AppShellLayout activePage="history" locale={language}>
      <div className="topbar">
        <div><p className="eyebrow">{copy.eyebrow}</p><h1>{copy.title}</h1></div>
      </div>

      {loading ? <p>{copy.loading}</p> : error && items.length === 0 ? (
        <div className="deliveries-empty">
          <p>{copy.error}</p><button className="secondary-button" onClick={() => void loadPage(null, false)}>{copy.retry}</button>
        </div>
      ) : items.length === 0 ? <p>{copy.empty}</p> : (
        <>
          <div className="deliveries-panel">
            <table>
              <thead><tr>
                {["ID", "Client", "Destinataire", "Destination", "Camion", copy.weight, copy.price, "Arrivée prévue", "Créée le"].map((label) => <th key={label}>{label}</th>)}
              </tr></thead>
              <tbody>{items.map((item) => <tr key={item.id}>
                <td><span style={{ fontFamily: "monospace" }}>{item.id}</span>{item.locationMismatchBypassedAt && <span className="location-mismatch-badge" style={{ marginLeft: 6 }} title={language === "fr" ? `Position du téléphone non confirmée à la livraison (${new Date(item.locationMismatchBypassedAt).toLocaleString(dateLocale)})` : language === "nl" ? `Telefoonpositie niet bevestigd bij levering (${new Date(item.locationMismatchBypassedAt).toLocaleString(dateLocale)})` : `Phone position unconfirmed at delivery (${new Date(item.locationMismatchBypassedAt).toLocaleString(dateLocale)})`}>⚠ {language === "fr" ? "Position non confirmée" : language === "nl" ? "Positie onbevestigd" : "Position unconfirmed"}</span>}</td>
                <td>{item.customer}</td>
                <td>{item.recipientName || "—"}{item.recipientContact ? <span>{item.recipientContact}</span> : null}</td>
                <td>{item.destination}</td>
                <td>{item.truck}</td>
                <td>{item.weightKg == null ? "—" : `${item.weightKg} kg`}</td>
                <td>{item.priceAmount == null ? "—" : `${item.priceAmount.toFixed(2)} ${item.priceCurrency}`}</td>
                <td>{item.plannedArrivalAt ? new Date(item.plannedArrivalAt).toLocaleString(dateLocale) : "—"}</td>
                <td>{new Date(item.createdAt).toLocaleString(dateLocale)}</td>
              </tr>)}</tbody>
            </table>
          </div>
          <div style={{ display: "flex", justifyContent: "center", marginTop: 20, gap: 12 }}>
            {cursor && <button className="secondary-button" disabled={loadingMore} onClick={() => void loadPage(cursor, true)}>{loadingMore ? copy.loading : copy.more}</button>}
            {error && items.length > 0 && <button className="secondary-button" onClick={() => void loadPage(cursor, true)}>{copy.retry}</button>}
          </div>
        </>
      )}

      {/* Live request: "can't we attribute actions to the google accounts"
          -- a company-scoped, dispatcher-only trail of the sensitive
          dispatcher actions this exists to make accountable: deleting a
          delivery, or confirming arrival despite a missing-scans or
          location-mismatch warning. Renders nothing at all when empty or
          when the viewer isn't a dispatcher (the endpoint 401s an agency
          session), rather than an empty panel nobody asked for. */}
      {auditVisible && auditItems.length > 0 && (
        <div className="deliveries-panel" style={{ marginTop: 32 }}>
          <div className="panel-header"><h2>{copy.auditTitle}</h2></div>
          <table>
            <thead><tr>
              {["ID", "Auteur", "Action", "Détail", "Date"].map((label) => <th key={label}>{label}</th>)}
            </tr></thead>
            <tbody>{auditItems.map((entry) => <tr key={entry.id}>
              <td><span style={{ fontFamily: "monospace" }}>{entry.deliveryId ?? "—"}</span></td>
              <td>{entry.actor}</td>
              <td>{auditActionLabel(entry)}</td>
              <td>{entry.deliveryCustomer ?? "—"}{entry.deliveryDestination ? ` → ${entry.deliveryDestination}` : ""}{entry.detail ? ` (${entry.detail})` : ""}</td>
              <td>{new Date(entry.createdAt).toLocaleString(dateLocale)}</td>
            </tr>)}</tbody>
          </table>
          {auditCursor && (
            <div style={{ display: "flex", justifyContent: "center", marginTop: 20 }}>
              <button className="secondary-button" disabled={auditLoadingMore} onClick={() => void loadAuditPage(auditCursor, true)}>{auditLoadingMore ? copy.loading : copy.auditMore}</button>
            </div>
          )}
        </div>
      )}
    </AppShellLayout>
  );
}
