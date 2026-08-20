"use client";

import { useCallback, useEffect, useState } from "react";

type HistoryItem = {
  id: string;
  customer: string;
  destination: string;
  truck: string;
  contact: string;
  plannedArrivalAt: string | null;
  createdAt: string;
};

type HistoryCursor = { beforeCreatedAt: string; beforeId: string };
type HistoryPage = { items: HistoryItem[]; nextCursor: HistoryCursor | null };

function locale() {
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
      const session = await fetch("/api/auth/session", { cache: "no-store" });
      if (session.status === 401) {
        window.location.assign(`/?lang=${language}`);
        return;
      }
      if (!session.ok) throw new Error("session_unavailable");
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
  }, [language]);

  useEffect(() => {
    const initial = window.setTimeout(() => void loadPage(null, false), 0);
    return () => window.clearTimeout(initial);
  }, [loadPage]);

  const dateLocale = language === "nl" ? "nl-BE" : language === "en" ? "en-GB" : "fr-BE";
  const copy = language === "nl"
    ? { eyebrow: "TRACKFLEET · HISTORIEK", title: "Leveringsgeschiedenis", back: "Terug naar operaties", empty: "Nog geen voltooide leveringen.", more: "Meer laden", loading: "Geschiedenis laden…", retry: "Opnieuw proberen", error: "Geschiedenis kon niet worden geladen." }
    : language === "en"
      ? { eyebrow: "TRACKFLEET · HISTORY", title: "Delivery history", back: "Back to operations", empty: "No completed deliveries yet.", more: "Load more", loading: "Loading history…", retry: "Retry", error: "Unable to load delivery history." }
      : { eyebrow: "TRACKFLEET · HISTORIQUE", title: "Historique des livraisons", back: "Retour aux opérations", empty: "Aucune livraison terminée pour le moment.", more: "Charger plus", loading: "Chargement de l’historique…", retry: "Réessayer", error: "Impossible de charger l’historique." };

  return (
    <main style={{ maxWidth: 1180, margin: "0 auto", padding: "32px 24px 64px", fontFamily: "system-ui", color: "#111827" }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", marginBottom: 24 }}>
        <div><p style={{ margin: 0, color: "#6b7280", fontSize: 12, fontWeight: 700, letterSpacing: ".12em" }}>{copy.eyebrow}</p><h1 style={{ margin: "6px 0" }}>{copy.title}</h1></div>
        <a href={`/operations?lang=${language}`} style={{ color: "#111827", fontWeight: 700 }}>{copy.back}</a>
      </header>

      {loading ? <p>{copy.loading}</p> : error && items.length === 0 ? (
        <section style={{ border: "1px solid #fecaca", background: "#fef2f2", padding: 18, borderRadius: 14 }}>
          <p>{copy.error}</p><button onClick={() => void loadPage(null, false)}>{copy.retry}</button>
        </section>
      ) : items.length === 0 ? <p>{copy.empty}</p> : (
        <>
          <div style={{ overflowX: "auto", border: "1px solid #e5e7eb", borderRadius: 16 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead><tr style={{ background: "#f9fafb", textAlign: "left" }}>
                {['ID', 'Client', 'Destination', 'Camion', 'Arrivée prévue', 'Créée le'].map((label) => <th key={label} style={{ padding: 12, borderBottom: "1px solid #e5e7eb" }}>{label}</th>)}
              </tr></thead>
              <tbody>{items.map((item) => <tr key={item.id}>
                <td style={{ padding: 12, borderBottom: "1px solid #f3f4f6", fontFamily: "monospace" }}>{item.id}</td>
                <td style={{ padding: 12, borderBottom: "1px solid #f3f4f6" }}>{item.customer}</td>
                <td style={{ padding: 12, borderBottom: "1px solid #f3f4f6" }}>{item.destination}</td>
                <td style={{ padding: 12, borderBottom: "1px solid #f3f4f6" }}>{item.truck}</td>
                <td style={{ padding: 12, borderBottom: "1px solid #f3f4f6" }}>{item.plannedArrivalAt ? new Date(item.plannedArrivalAt).toLocaleString(dateLocale) : "—"}</td>
                <td style={{ padding: 12, borderBottom: "1px solid #f3f4f6" }}>{new Date(item.createdAt).toLocaleString(dateLocale)}</td>
              </tr>)}</tbody>
            </table>
          </div>
          <div style={{ display: "flex", justifyContent: "center", marginTop: 20 }}>
            {cursor && <button disabled={loadingMore} onClick={() => void loadPage(cursor, true)} style={{ padding: "10px 18px", borderRadius: 10, border: "1px solid #d1d5db", background: "white", fontWeight: 700 }}>{loadingMore ? copy.loading : copy.more}</button>}
            {error && items.length > 0 && <button onClick={() => void loadPage(cursor, true)} style={{ marginLeft: 12 }}>{copy.retry}</button>}
          </div>
        </>
      )}
    </main>
  );
}
