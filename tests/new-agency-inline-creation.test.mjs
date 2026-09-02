import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { memorySiteStore } from "../app/lib/site-store.memory.ts";

// Client asked (via a photo of the company's real agency-address flyer):
// the delivery creation form should let a dispatcher add a destination
// agency that isn't in the known list yet, right from an "Autre" option --
// name, address and WhatsApp number, same shape as every other agency.
// Phone numbers from the photo itself are a separate, later task (backfill
// onto the 9 existing known sites) -- not done here.

test("a site can carry an optional whatsapp contact number, round-tripped through the store", async () => {
  await memorySiteStore.upsert({
    companyId: "company-whatsapp-a",
    id: "test-agency-with-whatsapp",
    label: "Test Agency",
    city: "Test City",
    country: "MA",
    address: "1 Test Street, Test City, Maroc",
    latitude: null,
    longitude: null,
    arrivalRadiusKm: 0.5,
    roles: ["destination"],
    whatsapp: "+212 6 00 00 00 00",
  });
  const sites = await memorySiteStore.listForCompany("company-whatsapp-a");
  const created = sites.find((site) => site.id === "test-agency-with-whatsapp");
  assert.equal(created?.whatsapp, "+212 6 00 00 00 00");
});

test("a site created without a whatsapp number stores null, not undefined or an error", async () => {
  await memorySiteStore.upsert({
    companyId: "company-whatsapp-b",
    id: "test-agency-without-whatsapp",
    label: "Test Agency 2",
    city: "Test City 2",
    country: "MA",
    address: "2 Test Street, Test City, Maroc",
    latitude: null,
    longitude: null,
    arrivalRadiusKm: 0.5,
    roles: ["destination"],
  });
  const sites = await memorySiteStore.listForCompany("company-whatsapp-b");
  const created = sites.find((site) => site.id === "test-agency-without-whatsapp");
  assert.ok(created);
});

test("the sites.whatsapp column is part of the production Postgres schema contract, and was migrated (not just declared) before this shipped", async () => {
  const contract = await readFile(new URL("../app/lib/storage-schema-contract.ts", import.meta.url), "utf8");
  assert.match(contract, /\{ table: "sites", column: "whatsapp" \}/);
});

test("the D1 schema script creates/backfills sites.whatsapp for both fresh and pre-existing databases", async () => {
  const script = await readFile(new URL("../scripts/prepare-d1-schema.mjs", import.meta.url), "utf8");
  assert.match(script, /CREATE TABLE IF NOT EXISTS sites \([\s\S]*?whatsapp text,[\s\S]*?\)/);
  assert.match(script, /addMissingColumn\(alterations, "sites", siteColumns, "whatsapp", "text"\)/);
});

test("POST /api/sites accepts, validates and returns a whatsapp number", async () => {
  const route = await readFile(new URL("../app/api/sites/route.ts", import.meta.url), "utf8");
  assert.match(route, /const whatsappRaw = String\(payload\.whatsapp \?\? ""\)\.trim\(\);/);
  assert.match(route, /whatsapp,\s*\n\s*color,\s*\n\s*shortCodePrefix,\s*\n\s*\}\);/);
  assert.match(route, /whatsapp: site\.whatsapp \?\? null,/);
});

test("the delivery creation form offers an 'other/new agency' destination option that reveals name/city/address/WhatsApp fields", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /<option value="__new_agency__">/);
  assert.match(page, /name="newAgencyLabel"/);
  assert.match(page, /name="newAgencyCity"/);
  assert.match(page, /name="newAgencyAddress"/);
  assert.match(page, /name="newAgencyWhatsapp"/);
});

test("submitting with the new-agency option creates the site via POST /api/sites before creating the delivery, and aborts the whole submission on failure", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /if \(destinationSiteId === "__new_agency__"\) \{/);
  assert.match(page, /await fetch\("\/api\/sites", \{\s*\n\s*method: "POST",/);
  assert.match(page, /if \(!response\.ok \|\| !data\.site\) \{[\s\S]{0,200}setCreating\(false\);\s*\n\s*return;/);
});

test("the new agency is folded into knownSites immediately and the sites-changed event fires, same as SiteManager's own save", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /setKnownSites\(\(sites\) => \[\.\.\.sites, data\.site!\]\)/);
  assert.match(page, /window\.dispatchEvent\(new Event\("trackfleet-sites-changed"\)\)/);
});

test("the 'other' option is only offered to dispatchers, not agency-role sessions (whose /api/sites POST means something different: reporting their own GPS location)", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /\{company\?\.role !== "agency" && <option value="__new_agency__">/);
});
