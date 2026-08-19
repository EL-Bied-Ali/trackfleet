"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./storage.module.css";

type Metric = {
  key: "fleet_positions" | "trip_positions" | "eta_observations" | "delivery_events";
  totalRows: number;
  last24hRows: number;
  last7dRows: number;
  oldestAt: string | null;
  newestAt: string | null;
  projected30dRows: number;
};

type Report = { available: boolean; generatedAt: string; metrics: Metric[] };
type Locale = "fr" | "en" | "nl";

const labels = {
  fr: { title: "Croissance des données", subtitle: "Volume de télémétrie pour votre entreprise", back: "Retour aux opérations", total: "Total", day: "24 h", week: "7 jours", month: "Projection 30 jours", oldest: "Plus ancienne donnée", refreshed: "Actualisé", unavailable: "Rapport indisponible" },
  en: { title: "Data growth", subtitle: "Telemetry volume for your company", back: "Back to operations", total: "Total", day: "24h", week: "7 days", month: "30-day projection", oldest: "Oldest data", refreshed: "Updated", unavailable: "Report unavailable" },
  nl: { title: "Datagroei", subtitle: "Telemetrievolume voor uw bedrijf", back: "Terug naar operaties", total: "Totaal", day: "24 u", week: "7 dagen", month: "Projectie 30 dagen", oldest: "Oudste data", refreshed: "Bijgewerkt", unavailable: "Rapport niet beschikbaar" },
} as const;

const metricLabels = {
  fr: { fleet_positions: "Positions flotte", trip_positions: "Positions trajets", eta_observations: "Observations ETA", delivery_events: "Événements colis" },
  en: { fleet_positions: "Fleet positions", trip_positions: "Trip positions", eta_observations: "ETA observations", delivery_events: "Delivery events" },
  nl: { fleet_positions: "Vlootposities", trip_positions: "Ritposities", eta_observations: "ETA-observaties", delivery_events: "Zendinggebeurtenissen" },
} as const;

function localeFromUrl(): Locale {
  if (typeof window === "undefined") return "fr";
  const value = new URLSearchParams(window.location.search).get("lang");
  return value === "en" || value === "nl" ? value : "fr";
}

function formatDate(value: string | null, locale: Locale) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(locale === "fr" ? "fr-BE" : locale === "nl" ? "nl-BE" : "en-GB");
}

export default function StorageOperationsPage() {
  const [locale] = useState<Locale>(() => localeFromUrl());
  const [report, setReport] = useState<Report | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const t = labels[locale];

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/operations/storage", { cache: "no-store" });
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

  const totalProjected = useMemo(() => report?.metrics.reduce((sum, metric) => sum + metric.projected30dRows, 0) ?? 0, [report]);

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div><p className={styles.eyebrow}>TRACKFLEET STORAGE</p><h1>{t.title}</h1><p>{t.subtitle}</p></div>
          <Link className={styles.button} href={`/operations?lang=${locale}`}>{t.back}</Link>
        </header>

        {state === "error" ? <section className={styles.message}>{t.unavailable}</section> : null}
        {state === "loading" ? <section className={styles.message}>…</section> : null}

        {state === "ready" && report ? (
          <>
            <section className={styles.overview}>
              <article><span>{t.month}</span><strong>{totalProjected.toLocaleString()}</strong><small>rows</small></article>
              <article><span>{t.refreshed}</span><strong>{new Date(report.generatedAt).toLocaleTimeString(locale === "fr" ? "fr-BE" : locale === "nl" ? "nl-BE" : "en-GB", { hour: "2-digit", minute: "2-digit" })}</strong></article>
            </section>
            <section className={styles.grid}>
              {report.metrics.map((metric) => (
                <article key={metric.key} className={styles.card}>
                  <h2>{metricLabels[locale][metric.key]}</h2>
                  <dl>
                    <div><dt>{t.total}</dt><dd>{metric.totalRows.toLocaleString()}</dd></div>
                    <div><dt>{t.day}</dt><dd>{metric.last24hRows.toLocaleString()}</dd></div>
                    <div><dt>{t.week}</dt><dd>{metric.last7dRows.toLocaleString()}</dd></div>
                    <div><dt>{t.month}</dt><dd>{metric.projected30dRows.toLocaleString()}</dd></div>
                    <div><dt>{t.oldest}</dt><dd>{formatDate(metric.oldestAt, locale)}</dd></div>
                  </dl>
                </article>
              ))}
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}
