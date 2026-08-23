import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const [mapSource, polish, layout, i18n, page] = await Promise.all([
  readFile(new URL("../app/InteractiveFleetMap.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard-polish.css", import.meta.url), "utf8"),
  readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/i18n.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
]);

test("live map markers use one compact vehicle label instead of a GPS badge stack", () => {
  assert.match(mapSource, /compactVehicleLabel/);
  // The marker's badge shows the friendly truck number when known, falling
  // back to the generic icon glyph only when it isn't (see
  // vehicle-truck-number.test.mjs for the full truck-number contract).
  assert.match(mapSource, /<span aria-hidden="true">\$\{delivery\.truckNumber \?\? "▰"\}<\/span><em>/);
  assert.doesNotMatch(mapSource, /<b>GPS<\/b>/);
});

test("MapLibre is loaded only when the interactive map mounts", () => {
  assert.match(mapSource, /await import\("maplibre-gl"\)/);
  assert.doesNotMatch(mapSource, /import \* as maplibregl from "maplibre-gl"/);
  assert.match(mapSource, /maplibreRef/);
});

test("empty dashboard controls do not render as blank UI", () => {
  assert.match(polish, /\.map-panel \.panel-actions select:empty/);
  assert.match(page, /className="deliveries-empty"/);
  assert.match(page, /setModalOpen\(true\)/);
  assert.match(page, /setFilter\("All deliveries"\)/);
});

test("dashboard copy contains no stale demo person or fixed fleet totals", () => {
  assert.doesNotMatch(i18n, /Camille/);
  assert.doesNotMatch(i18n, /12 vehicles|12 véhicules|12 voertuigen/);
  assert.doesNotMatch(i18n, /20 vehicles reporting|20 véhicules connectés|20 voertuigen online/);
});

test("customer tracking links require private tracking tokens", () => {
  assert.match(page, /if \(!delivery\?\.trackingToken\)/);
  assert.match(page, /if \(!selected\.trackingToken\)/);
  assert.match(page, /searchParams\.set\("tracking", delivery\.trackingToken\)/);
  assert.match(page, /searchParams\.set\("tracking", selected\.trackingToken\)/);
  assert.doesNotMatch(page, /trackingToken \|\| deliveryId/);
  assert.doesNotMatch(page, /trackingToken \|\| selected\.id/);
});

test("fleet KPI counts vehicles rather than GPS devices", () => {
  assert.match(page, /integration\.vehicleCount/);
  assert.match(page, /"véhicules"/);
  assert.doesNotMatch(page, /\$\{integration\.vehicleCount\} GPS/);
});

test("dashboard polish stylesheet is loaded after global styles", () => {
  const globalIndex = layout.indexOf('import "./globals.css"');
  const polishIndex = layout.indexOf('import "./dashboard-polish.css"');
  assert.ok(globalIndex >= 0);
  assert.ok(polishIndex > globalIndex);
});

test("the WhatsApp consent checkbox is hidden until a real phone number is entered, but stays in the DOM and functional once one is", () => {
  // Regression guard: the checkbox looked confusing/unnecessary before any
  // contact or recipient number existed. Rather than removing consent
  // capture entirely (which would silently break automatic WhatsApp for
  // any brand-new number forever -- see whatsapp-automation.ts's gate),
  // it's just visually hidden via CSS until a number is typed.
  assert.match(polish, /\.modal \.consent-choice \{\s*\n\s*display: none !important;/);
  assert.match(polish, /form:has\(input\[name="contact"\]:not\(:placeholder-shown\)\) \.consent-choice/);
  assert.match(polish, /form:has\(input\[name="recipientContact"\]:not\(:placeholder-shown\)\) \.consent-choice/);
  assert.match(page, /className="consent-choice"><input type="checkbox" name="whatsappOptIn"/);
});

test("the WhatsApp consent gate itself is untouched -- automatic messages still require it", () => {
  // Confirms the consent requirement was kept exactly as-is (a deliberate
  // decision after weighing the risk that Meta can suspend the whole
  // WhatsApp Business number if messages go out without recorded consent).
  assert.match(page, /name="whatsappOptIn"/);
});

test("submitting a new delivery with a phone number but an unchecked consent box asks for confirmation instead of silently skipping it", () => {
  // The checkbox only appears once a number is typed, which made it easy to
  // miss entirely. This doesn't check it automatically (that would defeat
  // the point of real affirmative consent) -- it just makes sure a
  // dispatcher can't submit past it without noticing.
  assert.match(page, /if \(!whatsappOptIn && \(contactRaw \|\| recipientContactRaw\)\) \{/);
  assert.match(page, /if \(!window\.confirm\(confirmMessage\)\) return;/);
  assert.match(page, /contact: contactRaw,/);
  assert.match(page, /recipientContact: recipientContactRaw,/);
});

test("the sidebar's real Outils TrackFleet nav (Operations/History/Revenue/Storage/Export/Import) is never hidden alongside the still-unimplemented placeholder nav", () => {
  // Regression guard, reproduced live: a broad ".sidebar nav + .sidebar-divider
  // + nav { display: none }" selector was written back when every nav after
  // the overview was an unimplemented placeholder. It matched ANY nav
  // directly following a divider, not just the still-disabled settings/help
  // one -- so once the Outils nav shipped with real, working links, this
  // same rule silently hid it too, leaving the sidebar with no way to reach
  // any other page.
  assert.doesNotMatch(polish, /nav \+ \.sidebar-divider \+ nav/);
  assert.match(polish, /\.sidebar \.nav-item:disabled,\s+\.sidebar \.sidebar-divider \{/);
  assert.match(page, /aria-label=\{locale === "fr" \? "Outils TrackFleet"/);
  assert.match(page, /href=\{`\/operations\?lang=\$\{locale\}`\}/);
});
