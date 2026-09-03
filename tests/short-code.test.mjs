import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { knownSites, suggestShortCodePrefix } from "../app/lib/known-sites.ts";
import { memoryStore } from "../app/lib/delivery-store.memory.ts";

// Task 6 of the depot-shelf-photo batch: a short, human-friendly parcel
// identifier for the printed label ("CAS 00", "CAS 01", "TAN 00"...),
// additional to and never replacing the internal TF-xxxx id. Settled via
// AskUserQuestion: prefixes CAS (Casablanca) / TAN (Tanger Ville) /
// PORT_TAN (Tanger Med, kept distinct from Tanger Ville despite sharing a
// bin color) -- counter is lifetime, per-company, per-prefix, never resets.
// Kenitra/Rabat don't exist as known sites yet -- a delivery to a
// not-yet-added destination simply gets no short code, rather than one
// fabricated for a site that isn't even configured. Every currently known
// site now has a prefix (explicitly requested live -- "tu peux les
// inventer c pg" -- rather than guessed silently, unlike the original
// caution this comment used to describe).

const [
  deliveryStoreTypes, deliveryStorePostgres, deliveryStoreCloudflare, deliveryStoreSharedPostgres,
  knownSitesSource, siteStorePostgres, siteStoreCloudflare, sitesRoute, siteManager,
  deliveriesRoute, labelsPage, prepareD1Schema, schemaContract,
  deliveryOperationalPostgres, deliveryOperationalCloudflare, d1StandbyReadStore, d1Reconciliation, d1HistoryBackfill,
  page,
] = await Promise.all([
  readFile(new URL("../app/lib/delivery-store.types.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/delivery-store.postgres.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/delivery-store.cloudflare.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/delivery-store.shared-postgres.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/known-sites.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/site-store.postgres.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/site-store.cloudflare.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/sites/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/SiteManager.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/deliveries/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/labels/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../scripts/prepare-d1-schema.mjs", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/storage-schema-contract.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/delivery-operational.postgres.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/delivery-operational.cloudflare.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/d1-standby-read-store.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/d1-reconciliation.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/d1-history-backfill.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
]);

test("the 3 confirmed sites carry their real shortCodePrefix, and Tanger Med's is kept distinct from Tanger Ville's despite sharing a bin color", () => {
  const byId = new Map(knownSites.map((site) => [site.id, site]));
  assert.equal(byId.get("casablanca-mohammed-vi-959")?.shortCodePrefix, "CAS");
  assert.equal(byId.get("tanger-ville-said-kotb-19a")?.shortCodePrefix, "TAN");
  assert.equal(byId.get("tanger-med-ksar-al-majaz")?.shortCodePrefix, "PORT_TAN");
});

test("every currently known site now has an explicitly-requested shortCodePrefix (none fabricated silently)", () => {
  const byId = new Map(knownSites.map((site) => [site.id, site]));
  const expected = {
    "sale-hay-nasser-12bis": "SALE",
    "marrakech-essaouira-12": "MARR",
    "agadir-zaitoune-tikiouine-103a": "AGA",
    "tetouan-cortoba-146": "TET",
    "khouribga-mohamed-vi-30": "KHO",
    "fquih-ben-salah-allal-ben-abdellah-197": "FBS",
    "brussels-abattoir-45": "BXL",
  };
  for (const [id, prefix] of Object.entries(expected)) {
    assert.equal(byId.get(id)?.shortCodePrefix, prefix, `${id} should carry its requested prefix`);
  }
});

test("DeliveryRow carries an optional shortCode, and DeliveryStore exposes an atomic per-(company,prefix) assignShortCode", () => {
  assert.match(deliveryStoreTypes, /shortCode\?: string \| null;/);
  assert.match(deliveryStoreTypes, /assignShortCode\(companyId: string, prefix: string\): Promise<string>;/);
});

test("the Postgres backend assigns short codes via a single atomic upsert+RETURNING round trip, formatted as 'PREFIX 00' zero-padded", async () => {
  assert.match(deliveryStorePostgres, /CREATE TABLE IF NOT EXISTS delivery_code_counters \(\s*\n\s*company_id text NOT NULL,\s*\n\s*prefix text NOT NULL,\s*\n\s*next_number integer NOT NULL,\s*\n\s*PRIMARY KEY \(company_id, prefix\)\s*\n\s*\)/);
  assert.match(deliveryStorePostgres, /async assignShortCode\(companyId, prefix\) \{/);
  assert.match(deliveryStorePostgres, /ON CONFLICT \(company_id, prefix\) DO UPDATE SET next_number = delivery_code_counters\.next_number \+ 1/);
  assert.match(deliveryStorePostgres, /RETURNING next_number/);
  assert.match(deliveryStorePostgres, /return `\$\{prefix\} \$\{String\(rows\[0\]\.next_number\)\.padStart\(2, "0"\)\}`;/);
});

test("the D1 backend assigns short codes via the same write-then-read shape as login-rate-limit.cloudflare.ts (no RETURNING support), safe under D1's per-database write serialization", () => {
  assert.match(deliveryStoreCloudflare, /async assignShortCode\(companyId, prefix\) \{/);
  assert.match(deliveryStoreCloudflare, /ON CONFLICT\(company_id, prefix\) DO UPDATE SET next_number = next_number \+ 1/);
  assert.match(deliveryStoreCloudflare, /SELECT next_number FROM delivery_code_counters WHERE company_id = \? AND prefix = \?/);
});

test("the memory backend (used by tests and local dev without DATABASE_URL) assigns sequential codes per (companyId, prefix), independent of every other company/prefix pair", async () => {
  const first = await memoryStore.assignShortCode("company-short-code-a", "CAS");
  const second = await memoryStore.assignShortCode("company-short-code-a", "CAS");
  const otherCompany = await memoryStore.assignShortCode("company-short-code-b", "CAS");
  const otherPrefix = await memoryStore.assignShortCode("company-short-code-a", "TAN");
  assert.equal(first, "CAS 00");
  assert.equal(second, "CAS 01");
  assert.equal(otherCompany, "CAS 00");
  assert.equal(otherPrefix, "TAN 00");
});

test("shared-postgres mirrors short_code to the D1 read-failover copy, same as every other delivery column", () => {
  assert.match(deliveryStoreSharedPostgres, /short_code\b/);
  assert.match(deliveryStoreSharedPostgres, /delivery\.shortCode \?\? null/);
});

test("the deliveries table's short_code column is deliberately NOT unique, unlike parcel_code -- two different companies legitimately both hand out 'CAS 00'", () => {
  assert.match(deliveryStorePostgres, /ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS short_code text`;/);
  assert.doesNotMatch(deliveryStorePostgres, /short_code text UNIQUE/);
});

test("a KnownSite can carry an optional shortCodePrefix, editable per site (same pattern as color), with NO shared default (unlike color's mauve fallback)", () => {
  assert.match(knownSitesSource, /shortCodePrefix\?: string \| null;/);
});

test("the site stores (Postgres and D1) thread shortCodePrefix through hydrate/seed/upsert, same as color", () => {
  assert.match(siteStorePostgres, /shortCodePrefix: row\.short_code_prefix === null \|\| row\.short_code_prefix === undefined \? null : String\(row\.short_code_prefix\)/);
  assert.match(siteStorePostgres, /short_code_prefix=excluded\.short_code_prefix/);
  assert.match(siteStoreCloudflare, /shortCodePrefix: row\.short_code_prefix === null \|\| row\.short_code_prefix === undefined \? null : String\(row\.short_code_prefix\)/);
  assert.match(siteStoreCloudflare, /short_code_prefix=excluded\.short_code_prefix/);
});

test("POST /api/sites validates shortCodePrefix as 2-12 uppercase letters/underscores, and GET returns it with no shared-default fallback (null when unset)", () => {
  assert.match(sitesRoute, /const shortCodePrefixPattern = \/\^\[A-Z_\]\{2,12\}\$\/;/);
  assert.match(sitesRoute, /if \(shortCodePrefix && !shortCodePrefixPattern\.test\(shortCodePrefix\)\) \{/);
  assert.match(sitesRoute, /shortCodePrefix: site\.shortCodePrefix \?\? null,/);
});

test("SiteManager exposes an editable, uppercased shortCodePrefix field in the add/edit form", () => {
  assert.match(siteManager, /shortCodePrefix: string \| null;/);
  assert.match(siteManager, /<input name="shortCodePrefix" style=\{\{ textTransform: "uppercase" \}\} maxLength=\{12\} placeholder="CAS" defaultValue=\{editingSite\?\.shortCodePrefix \?\? ""\} \/>/);
});

test("delivery creation assigns a short code only when the resolved destination site has a shortCodePrefix configured, via the atomic counter -- never fabricated for a site without one", () => {
  assert.match(deliveriesRoute, /const shortCode = site\?\.shortCodePrefix \? await store\.assignShortCode\(session\.companyId, site\.shortCodePrefix\) : null;/);
  assert.match(deliveriesRoute, /shortCode,\s*\n\s*paymentStatus: paymentStatusInput as "unpaid" \| "partial" \| "paid",\s*\n\s*amountPaid,\s*\n\s*driver: "To be assigned"/);
});

test("the printed label shows the short code inline on the same line as the id (not a new row), so it can never reopen the 16/feuille overflow that every other row was carefully sized to avoid", () => {
  assert.match(labelsPage, /shortCode: string \| null;/);
  assert.match(labelsPage, /\{delivery\.shortCode \?\? delivery\.id\}\{delivery\.shortCode \? ` · \$\{delivery\.id\}` : ""\}/);
});

test("the D1 schema script creates delivery_code_counters, sites.short_code_prefix and deliveries.short_code for both fresh and pre-existing databases", () => {
  assert.match(prepareD1Schema, /CREATE TABLE IF NOT EXISTS delivery_code_counters \(\s*\n\s*company_id text NOT NULL,\s*\n\s*prefix text NOT NULL,\s*\n\s*next_number integer NOT NULL,\s*\n\s*PRIMARY KEY \(company_id, prefix\)\s*\n\s*\)/);
  assert.match(prepareD1Schema, /short_code_prefix text/);
  assert.match(prepareD1Schema, /short_code text/);
  assert.match(prepareD1Schema, /\["short_code", "text"\]/);
  assert.match(prepareD1Schema, /addMissingColumn\(alterations, "sites", siteColumns, "short_code_prefix", "text"\);/);
});

test("the production Postgres schema contract requires delivery_code_counters, deliveries.short_code and sites.short_code_prefix -- only true once the live migration actually ran, per standing schema discipline", () => {
  assert.match(schemaContract, /"delivery_code_counters"/);
  assert.match(schemaContract, /\{ table: "deliveries", column: "short_code" \}/);
  assert.match(schemaContract, /\{ table: "sites", column: "short_code_prefix" \}/);
});

// Live-caught right after this feature's first version deployed: the POST
// /api/deliveries response DID carry the freshly-assigned shortCode, but
// the very next GET /api/deliveries (what the dashboard and /labels
// actually read from) never showed it. Root cause: the operational read
// path used for GET /api/deliveries is a SEPARATE, hand-optimized query
// (delivery-operational.postgres.ts's loadOperationalDeliveries, `SELECT
// delivery.*`) with its own RawDelivery type and hydrate() function,
// entirely independent of delivery-store.postgres.ts's own hydrate() that
// the main write path (and this test file's earlier assertions) already
// covered -- the SQL already fetched short_code (SELECT *), hydrate()
// just silently dropped it since neither the type nor the return object
// mentioned it. The same gap existed in 4 more parallel read/mirror paths:
// the D1 equivalent of this same optimized read, the D1 failover
// standby-read store, and the two D1 reconciliation/backfill mirrors.
test("every parallel delivery read/mirror path (not just the main store files) also carries short_code -- the operational dashboard/labels read path, its D1 equivalent, the D1 failover standby-read store, and both D1 reconciliation/backfill mirrors", () => {
  assert.match(deliveryOperationalPostgres, /short_code: string \| null;/);
  assert.match(deliveryOperationalPostgres, /shortCode: row\.short_code \?\? null,/);
  assert.match(deliveryOperationalCloudflare, /shortCode: string \| null;/);
  assert.match(deliveryOperationalCloudflare, /short_code AS shortCode,/);
  assert.match(d1StandbyReadStore, /shortCode: string \| null;/);
  assert.match(d1StandbyReadStore, /short_code AS shortCode,/);
  assert.match(d1Reconciliation, /short_code = excluded\.short_code,/);
  assert.match(d1Reconciliation, /delivery\.shortCode \?\? null,/);
  assert.match(d1HistoryBackfill, /short_code: string \| null;/);
  assert.match(d1HistoryBackfill, /shortCode: row\.short_code \?\? null,/);
  assert.match(d1HistoryBackfill, /short_code = excluded\.short_code,/);
});

// Follow-up: a dispatcher creating a brand-new agency inline ("Autre" at
// delivery creation) used to get shortCodePrefix: null, same as any other
// unconfigured site -- meaning every delivery to it printed with the plain
// TF id instead of a short code, forever, until someone opened SiteManager
// and typed one in by hand. suggestShortCodePrefix derives a best-effort
// candidate from the city name itself (never arbitrary), checked against
// every prefix already in use so it can't silently collide with one the
// client sets later -- falling back to null (no suggestion) rather than
// looping forever if every candidate is taken.
test("suggestShortCodePrefix derives initials for multi-word cities, else an increasingly long prefix of the first word, skipping accents/casing", () => {
  assert.equal(suggestShortCodePrefix("Fquih Ben Salah", []), "FBS");
  assert.equal(suggestShortCodePrefix("Kénitra", []), "KEN");
  assert.equal(suggestShortCodePrefix("Rabat", ["RAB".toLowerCase()]), "RABA");
});

test("suggestShortCodePrefix never returns a prefix already in use, and gives up (null) once every candidate for that city is taken", () => {
  assert.equal(suggestShortCodePrefix("Tanger", ["TAN"]), "TANG");
  assert.equal(suggestShortCodePrefix("Fes", ["FES"]), null);
});

test("suggestShortCodePrefix returns null for a blank/non-letter city rather than an empty-string prefix", () => {
  assert.equal(suggestShortCodePrefix("", []), null);
  assert.equal(suggestShortCodePrefix("   ", []), null);
});

test("the inline 'Autre' new-agency flow suggests a shortCodePrefix from the city and every prefix already known, rather than always leaving it null", () => {
  assert.match(page, /import \{ knownSite as staticKnownSite, suggestShortCodePrefix \} from "\.\/lib\/known-sites";/);
  assert.match(page, /const shortCodePrefix = suggestShortCodePrefix\(newAgencyCity, knownSites\.map\(\(site\) => site\.shortCodePrefix\)\);/);
  assert.match(page, /roles: \["destination"\],\s*\n\s*shortCodePrefix,\s*\n\s*\}\),/);
});
