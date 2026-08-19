"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { detectOperationalAlerts, type OperationalAlert, type OperationalDelivery } from "../lib/operational-alerts";
import styles from "./operations.module.css";

type IntegrationState = { configured: boolean; connected: boolean; vehicleCount: number; error: string | null };
type DeliveriesResponse = { deliveries: OperationalDelivery[]; integration?: IntegrationState };
type SeverityFilter = "all" | "critical" | "high" | "medium";
type Locale = "fr" | "en" | "nl";

function localeFromUrl(): Locale {
  if (typeof window === "undefined") return "fr";
  const value = new URLSearchParams(window.location.search).get("lang");
  return value === "en" || value === "nl" ? value : "fr";
}

const copy = {
  fr: {
    eyebrow: "CENTRE D’OPÉRATIONS", title: "Anomalies à traiter", back: "Retour au dashboard", import: "Import CSV", refresh: "Actualiser",
    critical: "Critiques", high: "Haute priorité", medium: "À surveiller", affected: "Colis concernés", all: "Toutes", updated: "Dernière mise à jour",
    loading: "Analyse de la flotte…", emptyTitle: "Aucune anomalie importante", emptyBody: "Les livraisons actives ne nécessitent pas d’intervention pour le moment.",
    errorTitle: "Données indisponibles", errorBody: "Impossible de charger l’état opérationnel. Réessayez dans quelques instants.",
    labels: { integration_offline: "Connexion SENDATRACK interrompue", vehicle_unassigned: "Camion non affecté", gps_stale: "Position GPS trop ancienne", eta_severely_delayed: "Retard ETA important", planned_arrival_overdue: "Heure prévue dépassée", destination_not_geocoded: "Destination non géocodée" },
    descriptions: {
      integration_offline: () => "TrackFleet ne reçoit plus de positions live de SENDATRACK.",
      vehicle_unassigned: (alert: OperationalAlert) => `${alert.customer ?? "Colis"} doit encore être affecté à un véhicule.`,
      gps_stale: (alert: OperationalAlert) => `Dernière position reçue il y a ${alert.ageMinutes ?? "?"} minutes.`,
      eta_severely_delayed: (alert: OperationalAlert) => `Retard estimé d’environ ${alert.delayMinutes ?? "?"} minutes.`,
      planned_arrival_overdue: (alert: OperationalAlert) => `L’heure prévue est dépassée d’environ ${alert.delayMinutes ?? "?"} minutes.`,
      destination_not_geocoded: () => "Les coordonnées de destination manquent, ce qui limite la détection d’arrivée et l’ETA.",
    },
  },
  en: {
    eyebrow: "OPERATIONS CENTER", title: "Issues requiring attention", back: "Back to dashboard", import: "CSV import", refresh: "Refresh",
    critical: "Critical", high: "High priority", medium: "Monitor", affected: "Affected parcels", all: "All", updated: "Last updated",
    loading: "Analysing fleet…", emptyTitle: "No material operational issues", emptyBody: "Active deliveries do not require intervention right now.",
    errorTitle: "Data unavailable", errorBody: "Unable to load operational state. Try again shortly.",
    labels: { integration_offline: "SENDATRACK connection offline", vehicle_unassigned: "Vehicle not assigned", gps_stale: "GPS position is stale", eta_severely_delayed: "Material ETA delay", planned_arrival_overdue: "Planned arrival overdue", destination_not_geocoded: "Destination not geocoded" },
    descriptions: {
      integration_offline: () => "TrackFleet is no longer receiving live SENDATRACK positions.",
      vehicle_unassigned: (alert: OperationalAlert) => `${alert.customer ?? "Parcel"} still needs a vehicle assignment.`,
      gps_stale: (alert: OperationalAlert) => `Last position was received ${alert.ageMinutes ?? "?"} minutes ago.`,
      eta_severely_delayed: (alert: OperationalAlert) => `Estimated delay is about ${alert.delayMinutes ?? "?"} minutes.`,
      planned_arrival_overdue: (alert: OperationalAlert) => `Planned arrival is overdue by about ${alert.delayMinutes ?? "?"} minutes.`,
      destination_not_geocoded: () => "Destination coordinates are missing, limiting arrival detection and ETA quality.",
    },
  },
  nl: {
    eyebrow: "OPERATIECENTRUM", title: "Afwijkingen die aandacht vragen", back: "Terug naar dashboard", import: "CSV import", refresh: "Vernieuwen",
    critical: "Kritiek", high: "Hoge prioriteit", medium: "Opvolgen", affected: "Betrokken zendingen", all: "Alle", updated: "Laatst bijgewerkt",
    loading: "Wagenpark analyseren…", emptyTitle: "Geen belangrijke afwijkingen", emptyBody: "Actieve leveringen vereisen momenteel geen interventie.",
    errorTitle: "Gegevens niet beschikbaar", errorBody: "De operationele status kon niet worden geladen. Probeer straks opnieuw.",
    labels: { integration_offline: "SENDATRACK-verbinding offline", vehicle_unassigned: "Voertuig niet toegewezen", gps_stale: "GPS-positie is verouderd", eta_severely_delayed: "Belangrijke ETA-vertraging", planned_arrival_overdue: "Geplande aankomst overschreden", destination_not_geocoded: "Bestemming niet gegeocodeerd" },
    descriptions: {
      integration_offline: () => "TrackFleet ontvangt geen live SENDATRACK-posities meer.",
      vehicle_unassigned: (alert: OperationalAlert) => `${alert.customer ?? "Zending"} heeft nog geen voertuig.`,
      gps_stale: (alert: OperationalAlert) => `Laatste positie werd ${alert.ageMinutes ?? "?"} minuten geleden ontvangen.`,
      eta_severely_delayed: (alert: OperationalAlert) => `Geschatte vertraging is ongeveer ${alert.delayMinutes ?? "?"} minuten.`,
      planned_arrival_overdue: (alert: OperationalAlert) => `Geplande aankomst is ongeveer ${alert.delayMinutes ?? "?"} minuten overschreden.`,
      destination_not_geocoded: () => "Bestemmingscoördinaten ontbreken, waardoor aankomstdetectie en ETA minder betrouwbaar zijn.",
    },
  },
} as const;

export default function OperationsPage() {
  const [locale] = useState<Locale>(() => localeFromUrl());
  const [deliveries, setDeliveries] = useState<OperationalDelivery[]>([]);
  const [integrationConnected, setIntegrationConnected] = useState(true);
  const [filter, setFilter] = useState<SeverityFilter>("all");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const t = copy[locale];

  const refresh = useCallback(async () => {
    try {
      const session = await fetch("/api/auth/session", { cache: "no-store" });
      if (session.status === 401) { window.location.assign(`/?lang=${locale}`); return; }
      if (!session.ok) throw new Error("session_unavailable");
      const response = await fetch("/api/deliveries", { cache: "no-store" });
      if (!response.ok) throw new Error("deliveries_unavailable");
      const data = await response.json() as DeliveriesResponse;
      setDeliveries(data.deliveries ?? []);
      setIntegrationConnected(data.integration?.connected !== false);
      setUpdatedAt(new Date());
      setState("ready");
    } catch { setState("error"); }
  }, [locale]);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, [refresh]);

  const summary = useMemo(
    () => detectOperationalAlerts(deliveries, integrationConnected, updatedAt ?? new Date()),
    [deliveries, integrationConnected, updatedAt],
  );
  const visible = filter === "all" ? summary.alerts : summary.alerts.filter((alert) => alert.severity === filter);

  if (state === "loading") return <main className={styles.page}><div className={styles.shell}><div className={styles.loading}>{t.loading}</div></div></main>;

  return (
    <main className={styles.page}><div className={styles.shell}>
      <header className={styles.header}><div><p className={styles.eyebrow}>{t.eyebrow}</p><h1>{t.title}</h1></div><div className={styles.actions}>
        <Link className={styles.button} href={`/?lang=${locale}`}>{t.back}</Link><Link className={styles.button} href={`/import?lang=${locale}`}>{t.import}</Link><button className={styles.buttonPrimary} onClick={() => void refresh()}>{t.refresh}</button>
      </div></header>
      {state === "error" ? <section className={styles.error}><h2>{t.errorTitle}</h2><p>{t.errorBody}</p><button className={styles.buttonPrimary} onClick={() => void refresh()}>{t.refresh}</button></section> : <>
        <section className={styles.summary} aria-label="Operational alert summary">
          <article className={styles.summaryCard}><span>{t.critical}</span><strong>{summary.critical}</strong></article><article className={styles.summaryCard}><span>{t.high}</span><strong>{summary.high}</strong></article><article className={styles.summaryCard}><span>{t.medium}</span><strong>{summary.medium}</strong></article><article className={styles.summaryCard}><span>{t.affected}</span><strong>{summary.affectedDeliveries}</strong></article>
        </section>
        <div className={styles.toolbar}><div className={styles.filters}>{(["all", "critical", "high", "medium"] as SeverityFilter[]).map((severity) => <button key={severity} className={filter === severity ? styles.filterActive : styles.filter} onClick={() => setFilter(severity)}>{severity === "all" ? t.all : severity === "critical" ? t.critical : severity === "high" ? t.high : t.medium}</button>)}</div><span className={styles.updated}>{t.updated}: {updatedAt?.toLocaleTimeString(locale === "fr" ? "fr-BE" : locale === "nl" ? "nl-BE" : "en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span></div>
        {visible.length === 0 ? <section className={styles.empty}><h2>{t.emptyTitle}</h2><p>{t.emptyBody}</p></section> : <section className={styles.list}>{visible.map((alert) => <article key={alert.id} className={`${styles.alert} ${styles[alert.severity]}`}><span className={styles.severity}>{alert.severity === "critical" ? t.critical : alert.severity === "high" ? t.high : t.medium}</span><div className={styles.alertBody}><strong>{t.labels[alert.kind]}</strong><p>{t.descriptions[alert.kind](alert as never)}{alert.destination ? ` · ${alert.destination}` : ""}</p></div><span className={styles.deliveryId}>{alert.deliveryId ?? "SYSTEM"}</span></article>)}</section>}
      </>}
    </div></main>
  );
}
