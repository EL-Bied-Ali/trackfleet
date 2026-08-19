"use client";

import { useEffect, useState } from "react";
import styles from "./quick-tools.module.css";

type QuickToolsState = "checking" | "hidden" | "visible";

export default function QuickTools() {
  const [state, setState] = useState<QuickToolsState>("checking");

  useEffect(() => {
    let active = true;
    const url = new URL(window.location.href);
    if (url.pathname !== "/" || url.searchParams.has("tracking")) {
      setState("hidden");
      return () => { active = false; };
    }

    void fetch("/api/auth/session", { cache: "no-store" })
      .then((response) => {
        if (!active) return;
        setState(response.ok ? "visible" : "hidden");
      })
      .catch(() => {
        if (active) setState("hidden");
      });

    return () => { active = false; };
  }, []);

  if (state !== "visible") return null;

  const language = typeof window === "undefined" ? "fr" : new URLSearchParams(window.location.search).get("lang") || "fr";
  return (
    <nav className={styles.tools} aria-label="TrackFleet quick tools">
      <a href={`/operations?lang=${encodeURIComponent(language)}`} className={styles.tool}>
        <span aria-hidden="true">△</span>
        <span>Operations</span>
      </a>
      <a href={`/import?lang=${encodeURIComponent(language)}`} className={styles.toolPrimary}>
        <span aria-hidden="true">＋</span>
        <span>Import CSV</span>
      </a>
    </nav>
  );
}
