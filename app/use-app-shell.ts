"use client";

import { useEffect, useState } from "react";
import type { AppSidebarBranding, AppSidebarCompany, AppSidebarIntegration } from "./AppSidebar";

const emptyBranding: AppSidebarBranding = { name: null, logoDataUrl: null };
const emptyIntegration: AppSidebarIntegration = { connected: false, configured: false, vehicleCount: 0 };

// Shared session/branding/integration/dark-mode bootstrap for every
// standalone page that now wraps itself in <AppSidebar> (Revenue, History,
// Guide, Import, the operations hub, Storage) -- each page already did its
// own inline "am I logged in" check before this existed; this just adds the
// two extra reads (branding, live fleet status) the sidebar itself needs,
// and the same dark-mode persistence app/page.tsx already had.
export function useAppShellData(locale: string) {
  const [company, setCompany] = useState<AppSidebarCompany>(null);
  const [companyBranding, setCompanyBranding] = useState<AppSidebarBranding>(emptyBranding);
  const [integration, setIntegration] = useState<AppSidebarIntegration>(emptyIntegration);
  const [darkMode, setDarkMode] = useState(false);
  const [authState, setAuthState] = useState<"loading" | "authenticated" | "anonymous">("loading");

  // One-time bootstrap read from localStorage, done as a render-phase
  // setState (React's documented escape hatch) rather than in an effect --
  // app/page.tsx has a scoped eslint exception for this same pattern, but
  // its own comment asks that the exception stay local to that file, not be
  // extended to new components.
  const [themeLoaded, setThemeLoaded] = useState(false);
  if (!themeLoaded && typeof window !== "undefined") {
    setThemeLoaded(true);
    setDarkMode(window.localStorage.getItem("trackfleet-theme") === "dark");
  }
  useEffect(() => {
    document.documentElement.dataset.theme = darkMode ? "dark" : "light";
    window.localStorage.setItem("trackfleet-theme", darkMode ? "dark" : "light");
  }, [darkMode]);

  useEffect(() => {
    let active = true;
    void fetch("/api/auth/session", { cache: "no-store" })
      .then((response) => response.json() as Promise<{ authenticated: boolean; company?: AppSidebarCompany }>)
      .then((session) => {
        if (!active) return;
        if (!session.authenticated) {
          setAuthState("anonymous");
          window.location.assign(`/?lang=${locale}`);
          return;
        }
        setCompany(session.company ?? null);
        setAuthState("authenticated");
      })
      .catch(() => { if (active) setAuthState("anonymous"); });
    return () => { active = false; };
  }, [locale]);

  useEffect(() => {
    if (authState !== "authenticated") return;
    let active = true;
    void fetch("/api/company/branding", { cache: "no-store" })
      .then((response) => response.json() as Promise<{ branding?: { name: string | null; logoDataUrl: string | null } }>)
      .then((data) => { if (active && data.branding) setCompanyBranding({ name: data.branding.name, logoDataUrl: data.branding.logoDataUrl }); })
      .catch(() => undefined);
    // /api/sendatrack answers 502 (not 200) while SENDATRACK is configured
    // but not yet connected -- still a real, parseable body (the
    // "reconnecting" state the sidebar needs to show), so this reads it
    // regardless of response.ok rather than only on success.
    void fetch("/api/sendatrack", { cache: "no-store" })
      .then((response) => response.json() as Promise<AppSidebarIntegration>)
      .then((data) => { if (active) setIntegration(data); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [authState]);

  async function logout() {
    await fetch("/api/auth/session", { method: "DELETE" });
    window.location.assign("/");
  }

  return { company, companyBranding, integration, darkMode, setDarkMode, authState, logout };
}
