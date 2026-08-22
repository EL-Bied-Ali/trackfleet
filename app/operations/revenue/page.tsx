"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import styles from "./revenue.module.css";
import { knownSites } from "../../lib/known-sites";

type CurrencyTotal = { currency: "EUR" | "MAD"; totalAmount: number; parcelCount: number };
type Window = { key: "today" | "last7d" | "last30d" | "allTime"; totals: CurrencyTotal[]; unpricedCount: number };
type SiteBreakdown = { siteId: string | null; totals: CurrencyTotal[]; unpricedCount: number };
type ParcelStatus = "In transit" | "Delayed" | "Loading" | "Delivered";
type Parcel = { id: string; customer: string; createdAt: string; weightKg: number | null; priceAmount: number | null; priceCurrency: "EUR" | "MAD" | null; status: ParcelStatus };
type Report = { available: boolean; generatedAt: string; windows: Window[]; bySite: SiteBreakdown[]; recentParcels: Parcel[] };
type Locale = "fr" | "en" | "nl";

const labels = {
  fr: {
    eyebrow: "TRACKFLEET · REVENUS", title: "Revenus", subtitle: "Chiffre d'affaires calculé automatiquement (1,50 €/kg, 15 DH/kg au départ du Maroc)", back: "Retour aux opérations",
    today: "Aujourd'hui", last7d: "7 derniers jours", last30d: "30 derniers jours", allTime: "Depuis le début", parcels: "colis",
    heroLabel: "Gagné depuis le début", heroSub: "Sur les 30 derniers jours",
    byAgency: "Par agence", agency: "Agence", unpriced: "Sans poids déclaré", refreshed: "Actualisé", unavailable: "Rapport indisponible",
    noRevenue: "Aucun revenu pour cette période", unassignedSite: "Site non défini",
    parcelsTitle: "Colis", parcelsSubtitle: "Les 200 colis les plus récents", number: "Numéro", sender: "Envoyeur", departureDate: "Date de départ", weight: "Poids", status: "Statut", amount: "Montant",
    noParcels: "Aucun colis enregistré pour le moment", noWeight: "—",
    statuses: { "In transit": "En route", Delayed: "En retard", Loading: "Chargement", Delivered: "Livrée" } as Record<ParcelStatus, string>,
  },
  en: {
    eyebrow: "TRACKFLEET · REVENUE", title: "Revenue", subtitle: "Revenue calculated automatically (1.50 EUR/kg, 15 MAD/kg from Morocco)", back: "Back to operations",
    today: "Today", last7d: "Last 7 days", last30d: "Last 30 days", allTime: "All time", parcels: "parcels",
    heroLabel: "Earned all time", heroSub: "Over the last 30 days",
    byAgency: "By agency", agency: "Agency", unpriced: "Missing declared weight", refreshed: "Updated", unavailable: "Report unavailable",
    noRevenue: "No revenue for this period", unassignedSite: "No site set",
    parcelsTitle: "Parcels", parcelsSubtitle: "The 200 most recent parcels", number: "Number", sender: "Sender", departureDate: "Departure date", weight: "Weight", status: "Status", amount: "Amount",
    noParcels: "No parcels registered yet", noWeight: "—",
    statuses: { "In transit": "In transit", Delayed: "Delayed", Loading: "Loading", Delivered: "Delivered" } as Record<ParcelStatus, string>,
  },
  nl: {
    eyebrow: "TRACKFLEET · OMZET", title: "Omzet", subtitle: "Automatisch berekende omzet (1,50 €/kg, 15 DH/kg vanuit Marokko)", back: "Terug naar operaties",
    today: "Vandaag", last7d: "Laatste 7 dagen", last30d: "Laatste 30 dagen", allTime: "Sinds het begin", parcels: "pakketten",
    heroLabel: "Verdiend sinds het begin", heroSub: "Over de laatste 30 dagen",
    byAgency: "Per agentschap", agency: "Agentschap", unpriced: "Geen gewicht opgegeven", refreshed: "Bijgewerkt", unavailable: "Rapport niet beschikbaar",
    noRevenue: "Geen omzet voor deze periode", unassignedSite: "Geen site ingesteld",
    parcelsTitle: "Pakketten", parcelsSubtitle: "De 200 meest recente pakketten", number: "Nummer", sender: "Afzender", departureDate: "Vertrekdatum", weight: "Gewicht", status: "Status", amount: "Bedrag",
    noParcels: "Nog geen pakketten geregistreerd", noWeight: "—",
    statuses: { "In transit": "Onderweg", Delayed: "Vertraagd", Loading: "Laden", Delivered: "Geleverd" } as Record<ParcelStatus, string>,
  },
} as const;

const statusClass: Record<ParcelStatus, string> = {
  "In transit": "transit",
  Delayed: "delayed",
  Loading: "loading",
  Delivered: "delivered",
};

function localeFromUrl(): Locale {
  if (typeof window === "undefined") return "fr";
  const value = new URLSearchParams(window.location.search).get("lang");
  return value === "en" || value === "nl" ? value : "fr";
}

function formatAmount(value: number, currency: string, locale: Locale) {
  return `${value.toLocaleString(locale === "fr" ? "fr-BE" : locale === "nl" ? "nl-BE" : "en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function formatDate(value: string, locale: Locale) {
  return new Date(value).toLocaleDateString(locale === "fr" ? "fr-BE" : locale === "nl" ? "nl-BE" : "en-GB", { day: "2-digit", month: "short", year: "numeric" });
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
  const heroTotals = report?.windows.find((window) => window.key === "allTime")?.totals ?? [];
  const last30dTotals = report?.windows.find((window) => window.key === "last30d")?.totals ?? [];

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
            <section className={styles.hero}>
              <div>
                <p className={styles.heroLabel}>{t.heroLabel}</p>
                {heroTotals.length === 0
                  ? <p className={styles.heroAmount}>{t.noRevenue}</p>
                  : heroTotals.map((total) => <p key={total.currency} className={styles.heroAmount}>{formatAmount(total.totalAmount, total.currency, locale)}</p>)}
              </div>
              <div className={styles.heroSecondary}>
                <p className={styles.heroLabel}>{t.heroSub}</p>
                {last30dTotals.length === 0
                  ? <p className={styles.heroAmountSmall}>{t.noRevenue}</p>
                  : last30dTotals.map((total) => <p key={total.currency} className={styles.heroAmountSmall}>{formatAmount(total.totalAmount, total.currency, locale)}</p>)}
              </div>
            </section>

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

            <section className={styles.section}>
              <h2>{t.parcelsTitle}</h2>
              <p className={styles.sectionSubtitle}>{t.parcelsSubtitle}</p>
              {report.recentParcels.length === 0 ? <p className={styles.note}>{t.noParcels}</p> : (
                <div className={styles.tableScroll}>
                  <table className={styles.table}>
                    <thead><tr><th>{t.number}</th><th>{t.sender}</th><th>{t.departureDate}</th><th>{t.weight}</th><th>{t.status}</th><th>{t.amount}</th></tr></thead>
                    <tbody>
                      {report.recentParcels.map((parcel) => (
                        <tr key={parcel.id}>
                          <td><strong>{parcel.id}</strong></td>
                          <td>{parcel.customer}</td>
                          <td>{formatDate(parcel.createdAt, locale)}</td>
                          <td>{parcel.weightKg == null ? t.noWeight : `${parcel.weightKg} kg`}</td>
                          <td><span className={`${styles.status} ${styles[statusClass[parcel.status]]}`}><i />{t.statuses[parcel.status]}</span></td>
                          <td>{parcel.priceAmount == null || parcel.priceCurrency == null ? t.noWeight : formatAmount(parcel.priceAmount, parcel.priceCurrency, locale)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
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
