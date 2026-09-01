"use client";

import Link from "next/link";
import { translations, type Locale } from "./i18n";
import { Icon, CompanyLogo } from "./CompanyLogo";

export type AppSidebarCompany = { account: string; user: string; role: "dispatcher" | "agency"; siteId: string | null } | null;
export type AppSidebarBranding = { name: string | null; logoDataUrl: string | null };
export type AppSidebarIntegration = { connected: boolean; configured: boolean; vehicleCount: number };
export type AppSidebarActivePage = "overview" | "revenue" | "history" | "guide";

// Shared across the dashboard (app/page.tsx) and every standalone page
// (Revenue, History, Guide, Import, the operations hub, Storage) so none of
// them are a dead end with no way back and no consistent look -- reported
// live, with a screenshot of the history page's raw inline styles next to
// the dashboard's actual design system. Deliberately NOT used by
// /scan/connect or /scan: both are focused, phone-oriented single-purpose
// screens (pair a phone via QR, then scan barcodes), not dashboard surfaces.
export function AppSidebar({
  activePage, locale, company, companyBranding, integration, darkMode, onToggleDarkMode, onOpenSettings, settingsHref, onLogout,
}: {
  activePage: AppSidebarActivePage;
  locale: Locale;
  company: AppSidebarCompany;
  companyBranding: AppSidebarBranding;
  integration: AppSidebarIntegration;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onOpenSettings?: () => void;
  settingsHref?: string;
  onLogout: () => void | Promise<void>;
}) {
  const t = translations[locale];
  const navLabel = locale === "fr" ? "Outils TrackFleet" : locale === "nl" ? "TrackFleet-tools" : "TrackFleet tools";
  return (
    <aside className="sidebar">
      <Link className="brand company-brand" href="/">
        <span className="company-brand-name">{companyBranding.name || "TrackFleet"}</span>
        <CompanyLogo className="brand-mark company-brand-mark" logoDataUrl={companyBranding.logoDataUrl} />
      </Link>
      <nav aria-label="Main navigation">
        <Link className={`nav-item ${activePage === "overview" ? "active" : ""}`} href="/"><Icon>▦</Icon>{t.overview}</Link>
        <button className="nav-item" disabled><Icon>▰</Icon>{t.fleet}</button>
        <button className="nav-item" disabled><Icon>◇</Icon>{t.deliveries}</button>
        <button className="nav-item" disabled><Icon>◉</Icon>{t.customers}</button>
      </nav>
      <div className="sidebar-divider" />
      <nav aria-label={navLabel}>
        <a className="nav-item" href="/scan/connect"><Icon>▦</Icon>{t.scanTool}</a>
        <a className={`nav-item ${activePage === "revenue" ? "active" : ""}`} href={`/operations/revenue?lang=${locale}`}><Icon>€</Icon>{t.revenueTool}</a>
        <a className={`nav-item ${activePage === "history" ? "active" : ""}`} href={`/operations/history?lang=${locale}`}><Icon>◷</Icon>{t.historyTool}</a>
        <a className={`nav-item ${activePage === "guide" ? "active" : ""}`} href="/guide"><Icon>◈</Icon>{t.guideTool}</a>
      </nav>
      <div className="sidebar-divider" />
      <nav>
        <button className="nav-item theme-toggle" type="button" aria-pressed={darkMode} onClick={onToggleDarkMode}><Icon>{darkMode ? "☀" : "☾"}</Icon>{darkMode ? (locale === "fr" ? "Mode clair" : locale === "nl" ? "Lichte modus" : "Light mode") : (locale === "fr" ? "Mode sombre" : locale === "nl" ? "Donkere modus" : "Dark mode")}</button>
        {company?.role === "dispatcher"
          ? (onOpenSettings ? <button className="nav-item" onClick={onOpenSettings}><Icon>⚙</Icon>{t.settings}</button> : <a className="nav-item" href={settingsHref ?? "/"}><Icon>⚙</Icon>{t.settings}</a>)
          : <button className="nav-item" disabled><Icon>⚙</Icon>{t.settings}</button>}
        <button className="nav-item" disabled><Icon>?</Icon>{t.helpCentre}</button>
      </nav>
      <div className="sidebar-divider" />
      <nav>
        {company?.role === "dispatcher" && <a className="nav-item" href="/api/operations/export"><Icon>⇩</Icon>{t.exportTool}</a>}
        <a className="nav-item" href={`/import?lang=${locale}`}><Icon>＋</Icon>{t.importTool}</a>
      </nav>
      <div className="sidebar-spacer" />
      <div className="gps-card">
        <div className="gps-icon">⌖</div>
        <strong>{integration.connected ? t.gpsConnected : integration.configured ? t.gpsIssue : t.gpsPending}</strong>
        <p>{integration.connected ? t.gpsConnectedBody(integration.vehicleCount) : integration.configured ? t.gpsIssueBody : t.gpsPendingBody}</p>
        <span className={`gps-coming ${integration.connected ? "is-live" : ""}`}>{integration.connected ? t.gpsAutomatic : t.gpsFallback}</span>
      </div>
      <div className="profile"><div className="avatar">{(company?.user || "TF").slice(0, 2).toUpperCase()}</div><div><strong>{company?.user || "TrackFleet"}</strong><span>{company?.account || t.dispatcher}</span></div><button aria-label="Déconnexion" onClick={() => void onLogout()}>↪</button></div>
    </aside>
  );
}
