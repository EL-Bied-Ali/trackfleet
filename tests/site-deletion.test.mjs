import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { memorySiteStore } from "../app/lib/site-store.memory.ts";
import { memoryStore } from "../app/lib/delivery-store.memory.ts";

// Live-caught while verifying suggestShortCodePrefix (see short-code.test.mjs):
// there was no way at all to remove an agency a dispatcher had added inline
// via "Autre" -- SiteManager only ever offered add/edit. This closes that
// gap, but a delete has two real footguns:
//  1. The client's own real depots are seeded from known-sites.ts on every
//     listForCompany call (ON CONFLICT DO NOTHING) -- deleting one would
//     just silently reappear on the next fetch, so those must be refused
//     up front rather than let a dispatcher believe it worked.
//  2. A site already referenced by a delivery (origin or destination) must
//     be refused too, rather than leave that delivery pointing at nothing.

function baseDeliveryInput(overrides) {
  const now = new Date();
  return {
    customer: "Jean Dupont", originSiteId: null, originLatitude: null, originLongitude: null,
    destinationSiteId: null, destination: "Casablanca", destinationLatitude: null, destinationLongitude: null,
    arrivalRadiusKm: 0.5, truck: "TRUCK-1", eta: "12:00", plannedArrivalAt: null, nextTruckDepartureAt: null,
    contact: "212612345678", recipientName: "", recipientContact: null, weightKg: 10, priceAmount: null, priceCurrency: null,
    whatsappOptIn: true, whatsappOptInAt: now, recipientWhatsappOptIn: false, recipientWhatsappOptInAt: null,
    sendatrackVehicleId: "", companyId: `site-deletion-test-${Date.now()}-${Math.random()}`, trackingToken: `tok-${Date.now()}-${Math.random()}`,
    driver: "TBD", status: "In transit", progress: 40, color: "#000",
    latitude: null, longitude: null, speed: 0, lastPositionAt: null, gpsSource: "simulation",
    ...overrides,
  };
}

test("memorySiteStore.remove deletes a company's own ad-hoc site and leaves other companies/sites untouched", async () => {
  const companyId = `site-deletion-test-${Date.now()}-${Math.random()}`;
  const otherCompanyId = `site-deletion-test-other-${Date.now()}-${Math.random()}`;
  const input = {
    companyId, id: "qa-test-agency", label: "QA Test Agency", city: "Testopolis", country: "MA",
    address: "1 Rue de Test", latitude: null, longitude: null, arrivalRadiusKm: 0.5,
    roles: ["destination"], whatsapp: null, color: null, shortCodePrefix: "TES",
  };
  await memorySiteStore.upsert(input);
  await memorySiteStore.upsert({ ...input, companyId: otherCompanyId });

  const removed = await memorySiteStore.remove(companyId, "qa-test-agency");
  assert.equal(removed, true);
  assert.equal((await memorySiteStore.listForCompany(companyId)).some((site) => site.id === "qa-test-agency"), false);
  assert.equal((await memorySiteStore.listForCompany(otherCompanyId)).some((site) => site.id === "qa-test-agency"), true);
});

test("memorySiteStore.remove returns false for an id that doesn't exist", async () => {
  const companyId = `site-deletion-test-missing-${Date.now()}-${Math.random()}`;
  assert.equal(await memorySiteStore.remove(companyId, "does-not-exist"), false);
});

test("a site referenced as a delivery's origin or destination is detectable via listForCompany, the same check the DELETE route relies on", async () => {
  const companyId = `site-deletion-test-inuse-${Date.now()}-${Math.random()}`;
  await memoryStore.create(baseDeliveryInput({ companyId, destinationSiteId: "qa-test-agency" }));
  const deliveries = await memoryStore.listForCompany(companyId);
  assert.equal(deliveries.some((delivery) => delivery.originSiteId === "qa-test-agency" || delivery.destinationSiteId === "qa-test-agency"), true);
});

const [sitesRoute, siteStoreTypes, siteStoreMemory, siteStorePostgres, siteStoreCloudflare, siteStoreSharedPostgres, siteStoreFailover, siteManager] = await Promise.all([
  readFile(new URL("../app/api/sites/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/site-store.types.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/site-store.memory.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/site-store.postgres.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/site-store.cloudflare.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/site-store.shared-postgres.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/site-store.cloudflare-postgres-failover.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/SiteManager.tsx", import.meta.url), "utf8"),
]);

test("SiteStore declares remove(companyId, id), and every backend implements it", () => {
  assert.match(siteStoreTypes, /remove\(companyId: string, id: string\): Promise<boolean>;/);
  assert.match(siteStoreMemory, /async remove\(companyId, id\) \{/);
  assert.match(siteStorePostgres, /async remove\(companyId, id\) \{/);
  assert.match(siteStorePostgres, /DELETE FROM sites WHERE company_id=\$\{companyId\} AND id=\$\{id\} RETURNING id/);
  assert.match(siteStoreCloudflare, /async remove\(companyId, id\) \{/);
  assert.match(siteStoreCloudflare, /DELETE FROM sites WHERE company_id=\? AND id=\?/);
  assert.match(siteStoreSharedPostgres, /remove\(companyId: string, id: string\) \{\s*\n\s*return primarySiteStore\.remove\(companyId, id\);/);
  assert.match(siteStoreFailover, /remove\(companyId: string, id: string\) \{\s*\n\s*return primarySiteStore\.remove\(companyId, id\);/);
});

test("the sites DELETE route is same-origin protected, dispatcher-only, refuses to delete a known/seeded site, and refuses a site still referenced by a delivery", () => {
  assert.match(sitesRoute, /export async function DELETE\(request: Request\) \{/);
  const body = sitesRoute.slice(sitesRoute.indexOf("export async function DELETE"));
  assert.match(body, /if \(!requestIsSameOrigin\(request\)\) return originRejectedResponse\(\);/);
  assert.match(body, /if \(session\.role !== "dispatcher"\) return Response\.json\(\{ error: "dispatcher_only" \}, \{ status: 403 \}\);/);
  assert.match(body, /if \(knownSite\(id\)\) return Response\.json\(\{ error: "cannot_delete_known_site" \}, \{ status: 400 \}\);/);
  assert.match(body, /delivery\.originSiteId === id \|\| delivery\.destinationSiteId === id/);
  assert.match(body, /return Response\.json\(\{ error: "site_in_use" \}, \{ status: 409 \}\);/);
  assert.match(body, /if \(!removed\) return Response\.json\(\{ error: "site_not_found" \}, \{ status: 404 \}\);/);
});

test("SiteManager offers a delete button for every site except the client's known/seeded ones, guarded by an explicit confirmation", () => {
  assert.match(siteManager, /const knownSiteIds = new Set\(knownSites\.map\(\(site\) => site\.id\)\);/);
  assert.match(siteManager, /async function removeSite\(site: Site\) \{/);
  const functionBody = siteManager.slice(siteManager.indexOf("async function removeSite(site: Site) {"));
  assert.match(functionBody, /if \(!window\.confirm\(confirmation\)\) return;/);
  assert.match(functionBody, /method: "DELETE"/);
  assert.match(siteManager, /\{!knownSiteIds\.has\(site\.id\) && <button type="button" className="danger-button" disabled=\{deleteBusy === site\.id\} onClick=\{\(\) => void removeSite\(site\)\}>/);
});
