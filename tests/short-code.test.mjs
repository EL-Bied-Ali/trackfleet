import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { knownSites } from "../app/lib/known-sites.ts";
import { memoryStore } from "../app/lib/delivery-store.memory.ts";

// Task 6 of the depot-shelf-photo batch: a short, human-friendly parcel
// identifier for the printed label ("CAS 00", "CAS 01", "TAN 00"...),
// additional to and never replacing the internal TF-xxxx id. Settled via
// AskUserQuestion: prefixes CAS (Casablanca) / TAN (Tanger Ville) /
// PORT_TAN (Tanger Med, kept distinct from Tanger Ville despite sharing a
// bin color) -- counter is lifetime, per-company, per-prefix, never resets.
// Kenitra/Rabat and every other known site get no prefix yet (user hasn't
// given real addresses / hasn't specified a code for them) -- a delivery to
// those destinations simply gets no short code, rather than one fabricated
// here.

const [
  deliveryStoreTypes, deliveryStorePostgres, deliveryStoreCloudflare, deliveryStoreSharedPostgres,
  knownSitesSource, siteStorePostgres, siteStoreCloudflare, sitesRoute, siteManager,
  deliveriesRoute, labelsPage, prepareD1Schema, schemaContract,
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
]);

test("the 3 confirmed sites carry their real shortCodePrefix, and Tanger Med's is kept distinct from Tanger Ville's despite sharing a bin color", () => {
  const byId = new Map(knownSites.map((site) => [site.id, site]));
  assert.equal(byId.get("casablanca-mohammed-vi-959")?.shortCodePrefix, "CAS");
  assert.equal(byId.get("tanger-ville-said-kotb-19a")?.shortCodePrefix, "TAN");
  assert.equal(byId.get("tanger-med-ksar-al-majaz")?.shortCodePrefix, "PORT_TAN");
});

test("every other known site (Kenitra/Rabat don't exist yet, and every existing site the client didn't specify) has no prefix, rather than one fabricated here", () => {
  const byId = new Map(knownSites.map((site) => [site.id, site]));
  for (const id of ["sale-hay-nasser-12bis", "marrakech-essaouira-12", "agadir-zaitoune-tikiouine-103a", "tetouan-cortoba-146"]) {
    assert.equal(byId.get(id)?.shortCodePrefix, undefined, `${id} should have no fabricated prefix`);
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
  assert.match(deliveriesRoute, /shortCode,\s*\n\s*driver: "To be assigned"/);
});

test("the printed label shows the short code inline on the same line as the id (not a new row), so it can never reopen the 16/feuille overflow that every other row was carefully sized to avoid", () => {
  assert.match(labelsPage, /shortCode: string \| null;/);
  assert.match(labelsPage, /\{delivery\.id\}\{delivery\.shortCode \? ` · \$\{delivery\.shortCode\}` : ""\}/);
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
