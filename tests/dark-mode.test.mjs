import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("dark mode is remembered per browser and applied at the document root", () => {
  assert.match(page, /const \[darkMode, setDarkMode\] = useState\(false\);/);
  assert.match(page, /window\.localStorage\.getItem\("trackfleet-theme"\)/);
  assert.match(page, /document\.documentElement\.dataset\.theme = darkMode \? "dark" : "light";/);
  assert.match(page, /window\.localStorage\.setItem\("trackfleet-theme", darkMode \? "dark" : "light"\);/);
});

test("the sidebar exposes an accessible dark-mode toggle and the whole app has dark theme surfaces", () => {
  assert.match(page, /className="nav-item theme-toggle" type="button" aria-pressed=\{darkMode\}/);
  assert.match(css, /:root\[data-theme="dark"\] \{ --ink: #e7edf2;/);
  assert.match(css, /:root\[data-theme="dark"\] body, :root\[data-theme="dark"\] \.app-shell, :root\[data-theme="dark"\] \.customer-page/);
  assert.match(css, /:root\[data-theme="dark"\] \.sidebar \{ border-right-color: #2b3a47; background: #17212b;/);
});
