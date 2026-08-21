"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import styles from "./revenue.module.css";
import { knownSites } from "../../lib/known-sites";

type CurrencyTotal = { currency: "EUR" | "MAD"; totalAmount: number; parcelCount: number };
type Window = { key: "today" | "last7d" | "last30d" | "allTime"; totals: CurrencyTotal[]; unpricedCount: number };
type SiteBreakdown = { siteId: string | null; totals: CurrencyTotal[]; unpricedCount: number };
type Report = { available: boolean; generatedAt: string; windows: Window[]; bySite: SiteBreakdown[] };
type Locale = "fr" | "en" | "nl";

const labels = {
  fr: { eyebrow: "TRACKFLEET · REVENUS", title: "Revenus", subtitle: "Chiffre d'affaires calculé automatiquement (1,50 €/kg, 15 DH/kg au départ du Maroc)", back: "Retour aux opérations", today: "Aujourd'hui", last7d: "7 derniers jours", last30d: "30 derniers jours", allTime: "Depuis le début", parcels: "colis", byAgency: "Par agence", agency: "Agence", unpriced: "Sans poids déclaré", refreshed: "Actualisé", unavailable: "Rapport indisponible", noRevenue: "Aucun revenu pour cette période", unassignedSite: "Site non défini" },
  en: { eyebrow: "TRACKFLEET · REVENUE", title: "Revenue", subtitle: "Revenue calculated automatically (1.50 EUR/kg, 15 MAD/kg from Morocco)", back: "Back to operations", today: "Today", last7d: "Last 7 days", last30d: "Last 30 days", allTime: "All time", parcels: "parcels", byAgency: "By agency", agency: "Agency", unpriced: "Missing declared weight", refreshed: "Updated", unavailable: "Report unavailable", noRevenue: "No revenue for this period", unassignedSite: "No site set" },
  nl: { eyebrow: "TRACKFLEET · OMZET", title: "Omzet", subtitle: "Automatisch berekende omzet (1,50 €/kg, 15 DH/kg vanuit Marokko)", back: "Terug naar operaties", today: "Vandaag", last7d: "Laatste 7 dagen", last30d: "Laatste 30 dagen", allTime: "Sinds het begin", parcels: "pakketten", byAgency: "Per agentschap", agency: "Agentschap", unpriced: "Geen gewicht opgegeven", refreshed: "Bijgewerkt", unavailable: "Rapport niet beschikbaar", noRevenue: "Geen omzet voor deze periode", unassignedSite: "Geen site ingesteld" },
} as const;

function localeFromUrl(): Locale {
  if (typeof window === "undefined") return "fr";
  const value = new URLSearchParams(window.location.search).get("lang");
  return value === "en" || value === "nl" ? value : "fr";
}

function formatAmount(value: number, currency: string, locale: Locale) {
  return `${value.toLocaleString(locale === "fr" ? "fr-BE" : locale === "nl" ? "nl-BE" : "en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function siteLabel(siteId: string | null, unassignedLabel: string) {
  if (!siteId) return unassignedLabel;
  return knownSites.find((site) => site.id === siteId)?.label ?? siteId;
}

export default function RevenueOperationsPage() {
  const [locale] = useState<Locale>(() => localeFromUrl());
  const [report, setReport] = useState<Report | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const t = labels[locale];

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/operations/revenue", { cache: "no-store" });
      if (response.status === 401) {
        window.location.assign(`/?lang=${locale}`);
        return;
      }
      if (!response.ok) throw new Error("report_unavailable");
      const data = await response.json() as Report;
      setReport(data);
      setState(data.available ? "ready" : "error");
    } catch {
      setState("error");
    }
  }, [locale]);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(), 300_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [refresh]);

  const windowLabel: Record<Window["key"], string> = { today: t.today, last7d: t.last7d, last30d: t.last30d, allTime: t.allTime };

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div><p className={styles.eyebrow}>{t.eyebrow}</p><h1>{t.title}</h1><p>{t.subtitle}</p></div>
          <Link className={styles.button} href={`/operations?lang=${locale}`}>{t.back}</Link>
        </header>

        {state === "error" ? <section className={styles.message}>{t.unavailable}</section> : null}
        {state === "loading" ? <section className={styles.message}>…</section> : null}

        {state === "ready" && report ? (
          <>
            <section className={styles.grid}>
              {report.windows.map((window) => (
                <article key={window.key} className={styles.card}>
                  <h2>{windowLabel[window.key]}</h2>
                  {window.totals.length === 0
                    ? <p className={styles.note}>{t.noRevenue}</p>
                    : window.totals.map((total) => <span key={total.currency} className={styles.amount}>{formatAmount(total.totalAmount, total.currency, locale)}</span>)}
                  <p className={styles.count}>{window.totals.reduce((sum, total) => sum + total.parcelCount, 0)} {t.parcels}</p>
                  {window.unpricedCount > 0 && <p className={styles.note}>{window.unpricedCount} · {t.unpriced}</p>}
                </article>
              ))}
            </section>

            {report.bySite.length > 0 && (
              <section className={styles.section}>
                <h2>{t.byAgency}</h2>
                <table className={styles.table}>
                  <thead><tr><th>{t.agency}</th><th>{t.allTime}</th><th>{t.parcels}</th><th>{t.unpriced}</th></tr></thead>
                  <tbody>
                    {report.bySite.map((site) => (
                      <tr key={site.siteId ?? "unassigned"}>
                        <td>{siteLabel(site.siteId, t.unassignedSite)}</td>
                        <td>{site.totals.length === 0 ? "—" : site.totals.map((total) => <span key={total.currency} style={{ display: "block" }}>{formatAmount(total.totalAmount, total.currency, locale)}</span>)}</td>
                        <td>{site.totals.reduce((sum, total) => sum + total.parcelCount, 0)}</td>
                        <td>{site.unpricedCount || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            <p className={styles.note}>{t.refreshed} {new Date(report.generatedAt).toLocaleTimeString(locale === "fr" ? "fr-BE" : locale === "nl" ? "nl-BE" : "en-GB", { hour: "2-digit", minute: "2-digit" })}</p>
          </>
        ) : null}
      </div>
    </main>
  );
}
