import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// User complaint, verbatim: "c pages ne matcha jour avec notre ux, tu peux
// t'en occupé ? et si possible la barre lateral devrait etre dispo partout
// ailleur" (these pages don't match our UX, can you take care of it? and if
// possible the sidebar should be available everywhere else) -- Revenue and
// History (freshly linked from the sidebar) were raw inline-styled pages
// with no navigation back to the dashboard at all. Guide, Import, the
// operations hub and Storage had the exact same problem, just not freshly
// linked. Deliberately excludes /scan/connect and /scan: both are focused,
// phone-oriented single-purpose screens (pair a phone via QR, then scan
// barcodes), not dashboard surfaces -- see AppSidebar.tsx's own comment.
const pagesUsingSharedShell = [
  "app/operations/revenue/page.tsx",
  "app/operations/history/page.tsx",
  "app/guide/page.tsx",
  "app/import/page.tsx",
  "app/operations/page.tsx",
  "app/operations/storage/page.tsx",
];

test("every standalone page (Revenue, History, Guide, Import, the operations hub, Storage) wraps itself in the shared AppShellLayout, not a bare/dead-end <main>", async () => {
  const sources = await Promise.all(pagesUsingSharedShell.map((path) => readFile(new URL(`../${path}`, import.meta.url), "utf8")));
  sources.forEach((source, index) => {
    assert.match(source, /import \{ AppShellLayout \} from ["'](?:\.\.\/)+AppShellLayout["'];/, `${pagesUsingSharedShell[index]} must import AppShellLayout`);
    assert.match(source, /<AppShellLayout activePage=/, `${pagesUsingSharedShell[index]} must render <AppShellLayout>`);
  });
});

test("/scan/connect is deliberately NOT wrapped in the shared shell -- it's a focused phone-pairing screen, not a dashboard surface", async () => {
  const scanConnect = await readFile(new URL("../app/scan/connect/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(scanConnect, /AppShellLayout/);
});

test("AppShellLayout redirects to the login page instead of rendering children when the session isn't authenticated", async () => {
  const shell = await readFile(new URL("../app/AppShellLayout.tsx", import.meta.url), "utf8");
  assert.match(shell, /if \(shell\.authState !== "authenticated"\) \{/);
  assert.match(shell, /return <main className="login-page login-loading">/);
});

test("AppShellLayout passes the dashboard's own dark-mode/branding/integration state through to AppSidebar, and links Settings to the dashboard instead of trying to open the settings modal", async () => {
  const shell = await readFile(new URL("../app/AppShellLayout.tsx", import.meta.url), "utf8");
  assert.match(shell, /darkMode=\{shell\.darkMode\}/);
  assert.match(shell, /onToggleDarkMode=\{\(\) => shell\.setDarkMode\(\(current\) => !current\)\}/);
  assert.match(shell, /settingsHref="\/"/);
  assert.doesNotMatch(shell, /onOpenSettings=/);
});
