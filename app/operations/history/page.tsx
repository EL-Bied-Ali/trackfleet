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
};

type HistoryCursor = { beforeCreatedAt: string; beforeId: string };
type HistoryPage = { items: HistoryItem[]; nextCursor: HistoryCursor | null };

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

  useEffect(() => {
    const initial = window.setTimeout(() => void loadPage(null, false), 0);
    return () => window.clearTimeout(initial);
  }, [loadPage]);

  const dateLocale = language === "nl" ? "nl-BE" : language === "en" ? "en-GB" : "fr-BE";
  const copy = language === "nl"
    ? { eyebrow: "TRACKFLEET · HISTORIEK", title: "Leveringsgeschiedenis", empty: "Nog geen voltooide leveringen.", more: "Meer laden", loading: "Geschiedenis laden…", retry: "Opnieuw proberen", error: "Geschiedenis kon niet worden geladen.", weight: "Gewicht", price: "Prijs" }
    : language === "en"
      ? { eyebrow: "TRACKFLEET · HISTORY", title: "Delivery history", empty: "No completed deliveries yet.", more: "Load more", loading: "Loading history…", retry: "Retry", error: "Unable to load delivery history.", weight: "Weight", price: "Price" }
      : { eyebrow: "TRACKFLEET · HISTORIQUE", title: "Historique des livraisons", empty: "Aucune livraison terminée pour le moment.", more: "Charger plus", loading: "Chargement de l’historique…", retry: "Réessayer", error: "Impossible de charger l’historique.", weight: "Poids", price: "Prix" };

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
                <td><span style={{ fontFamily: "monospace" }}>{item.id}</span></td>
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
    </AppShellLayout>
  );
}
