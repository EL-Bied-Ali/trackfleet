import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const [pageSource, mapSource, viteConfig] = await Promise.all([
  readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/InteractiveFleetMap.tsx", import.meta.url), "utf8"),
  readFile(new URL("../vite.config.ts", import.meta.url), "utf8"),
]);

test("login screen placeholders follow the selected locale", () => {
  assert.match(pageSource, /accountPlaceholder: "Compte SENDATRACK"/);
  assert.match(pageSource, /accountPlaceholder: "SENDATRACK account"/);
  assert.match(pageSource, /accountPlaceholder: "SENDATRACK-account"/);
  assert.match(pageSource, /placeholder=\{copy\.accountPlaceholder\}/);
  assert.match(pageSource, /placeholder=\{copy\.userPlaceholder\}/);
  assert.doesNotMatch(pageSource, /placeholder="Compte SENDATRACK"/);
  assert.doesNotMatch(pageSource, /placeholder="Utilisateur"/);
});

test("previewing a customer tracking link opens a new tab instead of replacing the dispatcher view", () => {
  assert.match(pageSource, /function openCustomerView\(\) \{[\s\S]*?window\.open\(link, "_blank", "noopener,noreferrer"\);[\s\S]*?\}/);
  assert.doesNotMatch(pageSource.slice(pageSource.indexOf("function openCustomerView")), /^[\s\S]{0,400}window\.history\.pushState/);
});

test("fleet map liveVehicles default is a stable reference, not a fresh array per render", () => {
  assert.match(mapSource, /const EMPTY_LIVE_VEHICLES: LiveVehicle\[\] = \[\];/);
  assert.match(mapSource, /liveVehicles = EMPTY_LIVE_VEHICLES/);
  assert.doesNotMatch(mapSource, /liveVehicles = \[\]/);
});

test("wrangler.jsonc is the single source of Cloudflare compatibility flags", () => {
  assert.doesNotMatch(viteConfig, /compatibility_flags/);
  assert.match(viteConfig, /const localBindingConfig = \{\s*main: "\.\/worker\/index\.ts",\s*\};/);
});

test("a one-time ?delivery= deep link does not keep overriding later manual selection", () => {
  assert.match(pageSource, /requestedUrl\.searchParams\.delete\("delivery"\)/);
  assert.match(pageSource, /window\.history\.replaceState\(\{\}, "", requestedUrl\)/);
  const refreshBody = pageSource.slice(pageSource.indexOf("async function refresh"), pageSource.indexOf("void refresh();"));
  assert.doesNotMatch(refreshBody, /setSelectedId\(\(current\) => requestedDeliveryId &&/);
});
