import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const appSidebar = await readFile(new URL("../app/AppSidebar.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("dark mode is remembered per browser and applied at the document root", () => {
  assert.match(page, /const \[darkMode, setDarkMode\] = useState\(false\);/);
  assert.match(page, /window\.localStorage\.getItem\("trackfleet-theme"\)/);
  assert.match(page, /document\.documentElement\.dataset\.theme = darkMode \? "dark" : "light";/);
  assert.match(page, /window\.localStorage\.setItem\("trackfleet-theme", darkMode \? "dark" : "light"\);/);
});

test("the sidebar exposes an accessible dark-mode toggle and the whole app has dark theme surfaces", () => {
  // The toggle now lives in AppSidebar.tsx, shared between the dashboard and
  // every standalone page (see the 2026-09-02 "sidebar everywhere" request).
  assert.match(appSidebar, /className="nav-item theme-toggle" type="button" aria-pressed=\{darkMode\}/);
  assert.match(css, /:root\[data-theme="dark"\] \{ --ink: #e7edf2;/);
  assert.match(css, /:root\[data-theme="dark"\] body, :root\[data-theme="dark"\] \.app-shell, :root\[data-theme="dark"\] \.customer-page/);
  assert.match(css, /:root\[data-theme="dark"\] \.sidebar \{ border-right-color: #2b3a47; background: #17212b;/);
});

// Reported live, with a computed-style check confirming it: the generic dark
// ".gps-coming" text-color rule (meant for the small non-live sub-label) beat
// ".is-live"'s own green in a same-element specificity tie, leaving grayish
// text (#9fb0bd) on the light mint success background (#dff3e9) -- a muddy
// "SYNCHRONISATION AUTOMATIQUE" badge instead of a clean success chip.
test("the 'automatic sync' badge keeps its clean green-on-mint look in dark mode, not grayish text on a mismatched background", () => {
  assert.match(css, /:root\[data-theme="dark"\] \.gps-coming\.is-live \{ color: #126f50; background: #dff3e9; \}/);
  const genericDarkRuleIndex = css.indexOf(':root[data-theme="dark"] .gps-card p, :root[data-theme="dark"] .gps-coming,');
  const liveOverrideIndex = css.indexOf(':root[data-theme="dark"] .gps-coming.is-live {');
  assert.ok(genericDarkRuleIndex > -1 && liveOverrideIndex > genericDarkRuleIndex, "the .is-live override must come after the generic dark .gps-coming rule to win the cascade");
});
