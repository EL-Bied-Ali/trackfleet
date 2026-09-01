"use client";

import { useAppShellData } from "./use-app-shell";
import { AppSidebar, type AppSidebarActivePage } from "./AppSidebar";
import type { Locale } from "./i18n";

// Shared page shell for every standalone page that isn't the dashboard
// itself (Revenue, History, Guide, Import, the operations hub, Storage) --
// see AppSidebar.tsx for why. Each page keeps its own data-fetching/content;
// this only handles the session/branding/dark-mode bootstrap and the
// sidebar + workspace wrapper around whatever it renders as children.
export function AppShellLayout({ activePage, locale, children }: { activePage: AppSidebarActivePage; locale: Locale; children: React.ReactNode }) {
  const shell = useAppShellData(locale);

  if (shell.authState !== "authenticated") {
    return <main className="login-page login-loading"><div className="brand brand-dark"><span className="brand-mark"><span>↗</span></span><span>TrackFleet</span></div></main>;
  }

  return (
    <main className="app-shell">
      <AppSidebar
        activePage={activePage}
        locale={locale}
        company={shell.company}
        companyBranding={shell.companyBranding}
        integration={shell.integration}
        darkMode={shell.darkMode}
        onToggleDarkMode={() => shell.setDarkMode((current) => !current)}
        settingsHref="/"
        onLogout={shell.logout}
      />
      <div className="workspace">{children}</div>
    </main>
  );
}
