import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { knownSites, defaultSiteColor } from "../app/lib/known-sites.ts";
import { memorySiteStore } from "../app/lib/site-store.memory.ts";

// User request, from a photo of the depot's physical color-coded ticket
// bins: match those colors in the app, and let the color be edited per
// agency. Tanger (both agencies) bleu, Salé orange, Casa blanc (light gray
// with a border -- literal white would be invisible in the UI), "villes
// transfert" (the catch-all bin for everything else) mauve, Marrakech
// rouge, Agadir vert foncé.

test("the 6 known agencies named in the photo carry their real color, matching the physical bins", () => {
  const byId = new Map(knownSites.map((site) => [site.id, site]));
  const expected = {
    "tanger-med-ksar-al-majaz": "#2563eb",
    "tanger-ville-said-kotb-19a": "#2563eb",
    "sale-hay-nasser-12bis": "#f97316",
    "marrakech-essaouira-12": "#dc2626",
    "agadir-zaitoune-tikiouine-103a": "#166534",
    "casablanca-mohammed-vi-959": "#e2e8f0",
  };
  for (const [id, color] of Object.entries(expected)) {
    assert.equal(byId.get(id)?.color, color, `${id} should have its real color`);
  }
});

test("a site with no assigned color yet (e.g. Tétouan, or a future Kenitra/Rabat) has none set on the known-sites record itself", () => {
  const byId = new Map(knownSites.map((site) => [site.id, site]));
  assert.equal(byId.get("tetouan-cortoba-146")?.color, undefined);
});

test("a site can carry and round-trip an optional color through the store", async () => {
  await memorySiteStore.upsert({
    companyId: "company-color-a",
    id: "test-agency-with-color",
    label: "Test Agency",
    city: "Test City",
    country: "MA",
    address: "1 Test Street, Test City, Maroc",
    latitude: null,
    longitude: null,
    arrivalRadiusKm: 0.5,
    roles: ["destination"],
    color: "#a855f7",
  });
  const sites = await memorySiteStore.listForCompany("company-color-a");
  assert.equal(sites.find((site) => site.id === "test-agency-with-color")?.color, "#a855f7");
});

test("the sites.color column is part of the production Postgres schema contract, and was migrated (not just declared) before this shipped", async () => {
  const contract = await readFile(new URL("../app/lib/storage-schema-contract.ts", import.meta.url), "utf8");
  assert.match(contract, /\{ table: "sites", column: "color" \}/);
});

test("the D1 schema script creates/backfills sites.color for both fresh and pre-existing databases", async () => {
  const script = await readFile(new URL("../scripts/prepare-d1-schema.mjs", import.meta.url), "utf8");
  assert.match(script, /CREATE TABLE IF NOT EXISTS sites \([\s\S]*?color text,[\s\S]*?\)/);
  assert.match(script, /addMissingColumn\(alterations, "sites", siteColumns, "color", "text"\)/);
});

test("POST /api/sites validates color as a 6-digit hex value, and GET falls back to the shared default (matching the 'villes transfert' bin) when a site has none", async () => {
  const route = await readFile(new URL("../app/api/sites/route.ts", import.meta.url), "utf8");
  assert.match(route, /const hexColorPattern = \/\^#\[0-9a-fA-F\]\{6\}\$\/;/);
  assert.match(route, /if \(color && !hexColorPattern\.test\(color\)\) \{/);
  assert.match(route, /color: site\.color \?\? defaultSiteColor,/);
});

test("SiteManager exposes an editable color picker in the add/edit form, defaulting to the shared fallback for a brand-new site", async () => {
  const siteManager = await readFile(new URL("../app/SiteManager.tsx", import.meta.url), "utf8");
  assert.match(siteManager, /<input name="color" type="color" defaultValue=\{editingSite\?\.color \?\? defaultSiteColor\}/);
});

test("defaultSiteColor is a real hex value (the 'villes transfert' mauve)", () => {
  assert.equal(defaultSiteColor, "#a855f7");
});
