"use client";

import { useEffect, useState } from "react";
import styles from "./quick-tools.module.css";

type QuickToolsState = "checking" | "hidden" | "visible";

export default function QuickTools() {
  const [state, setState] = useState<QuickToolsState>("checking");
  const [isDispatcher, setIsDispatcher] = useState(false);
  const [locationKey, setLocationKey] = useState("");

  useEffect(() => {
    const syncLocation = () => setLocationKey(`${window.location.pathname}${window.location.search}`);
    syncLocation();
    window.addEventListener("popstate", syncLocation);
    return () => window.removeEventListener("popstate", syncLocation);
  }, []);

  useEffect(() => {
    let active = true;
    const url = new URL(window.location.href);
    if (url.pathname !== "/" || url.searchParams.has("tracking")) {
      queueMicrotask(() => {
        if (active) setState("hidden");
      });
      return () => { active = false; };
    }

    void fetch("/api/auth/session", { cache: "no-store" })
      .then(async (response) => {
        if (!active) return;
        if (!response.ok) {
          setState("hidden");
          return;
        }
        const data = (await response.json().catch(() => null)) as { company?: { role?: string } } | null;
        setIsDispatcher(data?.company?.role === "dispatcher");
        setState("visible");
      })
      .catch(() => {
        if (active) setState("hidden");
      });

    return () => { active = false; };
  }, [locationKey]);

  if (state !== "visible") return null;

  const language = typeof window === "undefined" ? "fr" : new URLSearchParams(window.location.search).get("lang") || "fr";
  const locale = language === "en" || language === "nl" ? language : "fr";
  const copy = {
    fr: { label: "Outils TrackFleet", operations: "Opérations", history: "Historique", storage: "Stockage", export: "Exporter", import: "Importer" },
    en: { label: "TrackFleet tools", operations: "Operations", history: "History", storage: "Storage", export: "Export", import: "Import" },
    nl: { label: "TrackFleet-tools", operations: "Operaties", history: "Historiek", storage: "Opslag", export: "Exporteren", import: "Importeren" },
  }[locale];
  return (
    <nav className={styles.tools} aria-label={copy.label}>
      <a href={`/operations?lang=${encodeURIComponent(locale)}`} className={styles.tool} aria-label={copy.operations}>
        <span aria-hidden="true">△</span>
        <span>{copy.operations}</span>
      </a>
      <a href={`/operations/history?lang=${encodeURIComponent(locale)}`} className={styles.tool} aria-label={copy.history}>
        <span aria-hidden="true">≡</span>
        <span>{copy.history}</span>
      </a>
      {isDispatcher && <a href={`/operations/storage?lang=${encodeURIComponent(locale)}`} className={styles.tool} aria-label={copy.storage}>
        <span aria-hidden="true">▥</span>
        <span>{copy.storage}</span>
      </a>}
      {isDispatcher && <a href="/api/operations/export" className={styles.tool} aria-label={copy.export}>
        <span aria-hidden="true">⇩</span>
        <span>{copy.export}</span>
      </a>}
      <a href={`/import?lang=${encodeURIComponent(locale)}`} className={styles.toolPrimary} aria-label={copy.import}>
        <span aria-hidden="true">＋</span>
        <span>{copy.import}</span>
      </a>
    </nav>
  );
}
