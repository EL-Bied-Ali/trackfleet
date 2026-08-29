import assert from "node:assert/strict";
import test from "node:test";
import { memoryStore } from "../app/lib/delivery-store.memory.ts";

// Reported live during an audit: routeTemplateId (route-template.ts) is a
// hash of only the origin/destination site ids -- the known-sites catalog
// is identical across every company, so two unrelated companies shipping
// the same route (e.g. Brussels -> Casablanca) get the exact same
// routeTemplateId. listEtaObservationsForRoute previously filtered only on
// routeTemplateId + destinationSiteId, with no companyId at all -- a real
// cross-tenant leak of GPS-observed speed/delay history feeding directly
// into another company's route-learning state and customer-facing ETAs.
test("listEtaObservationsForRoute never returns another company's observations for the same route, even though routeTemplateId is identical across tenants", async () => {
  const routeTemplateId = "ROUTE-SHARED";
  const destinationSiteId = "casablanca-mohammed-vi-959";
  const companyA = `tenant-a-${Date.now()}`;
  const companyB = `tenant-b-${Date.now()}`;

  const recordedForA = await memoryStore.recordEtaObservation({
    companyId: companyA,
    deliveryId: "TF-A-1",
    routeTemplateId,
    tripInstanceId: "trip-a",
    destinationSiteId,
    positionAt: new Date("2026-08-20T10:00:00Z"),
    estimatedArrivalAt: new Date("2026-08-21T10:00:00Z"),
    plannedArrivalAt: null,
    delayMinutes: 15,
    effectiveSpeedKmh: 72,
    remainingDistanceKm: 400,
    progress: 60,
    confidence: "medium",
    source: "observed-pace",
  });
  const recordedForB = await memoryStore.recordEtaObservation({
    companyId: companyB,
    deliveryId: "TF-B-1",
    routeTemplateId,
    tripInstanceId: "trip-b",
    destinationSiteId,
    positionAt: new Date("2026-08-20T11:00:00Z"),
    estimatedArrivalAt: new Date("2026-08-21T11:00:00Z"),
    plannedArrivalAt: null,
    delayMinutes: 5,
    effectiveSpeedKmh: 90,
    remainingDistanceKm: 400,
    progress: 60,
    confidence: "medium",
    source: "observed-pace",
  });
  assert.ok(recordedForA);
  assert.ok(recordedForB);

  const seenByA = await memoryStore.listEtaObservationsForRoute(companyA, routeTemplateId, destinationSiteId);
  assert.deepEqual(seenByA.map((row) => row.deliveryId), ["TF-A-1"]);
  assert.equal(seenByA[0].effectiveSpeedKmh, 72);

  const seenByB = await memoryStore.listEtaObservationsForRoute(companyB, routeTemplateId, destinationSiteId);
  assert.deepEqual(seenByB.map((row) => row.deliveryId), ["TF-B-1"]);
  assert.equal(seenByB[0].effectiveSpeedKmh, 90);

  // A company with no observations of its own on this shared route must
  // never fall back to seeing someone else's.
  const companyC = `tenant-c-${Date.now()}`;
  const seenByC = await memoryStore.listEtaObservationsForRoute(companyC, routeTemplateId, destinationSiteId);
  assert.deepEqual(seenByC, []);
});

test("the DeliveryStore interface requires companyId on both recordEtaObservation's input and listEtaObservationsForRoute's query, and every backend implements it", async () => {
  const { readFile } = await import("node:fs/promises");
  const [typesSource, postgresSource, cloudflareSource, memorySource, failoverSource] = await Promise.all([
    readFile(new URL("../app/lib/delivery-store.types.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/delivery-store.postgres.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/delivery-store.cloudflare.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/delivery-store.memory.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/delivery-store.cloudflare-postgres-failover.ts", import.meta.url), "utf8"),
  ]);
  assert.match(typesSource, /companyId: string;\s*\n\s*deliveryId: string;/);
  assert.match(typesSource, /listEtaObservationsForRoute\(companyId: string, routeTemplateId: string, destinationSiteId: string, limit\?: number\): Promise<EtaObservationRow\[\]>;/);
  for (const source of [postgresSource, cloudflareSource, memorySource]) {
    assert.match(source, /listEtaObservationsForRoute\(companyId, routeTemplateId, destinationSiteId, limit/);
  }
  assert.match(failoverSource, /listEtaObservationsForRoute\(companyId, routeTemplateId, destinationSiteId, limit\)/);
});

test("the storage-schema-contract and D1 migration script both require delivery_eta_observations.company_id, so a real gap can't reach production silently", async () => {
  const { readFile } = await import("node:fs/promises");
  const [contractSource, d1SchemaSource] = await Promise.all([
    readFile(new URL("../app/lib/storage-schema-contract.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/prepare-d1-schema.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(contractSource, /\{ table: "delivery_eta_observations", column: "company_id" \}/);
  assert.match(d1SchemaSource, /\["company_id", "text"\]/);
  assert.match(d1SchemaSource, /UPDATE delivery_eta_observations SET company_id = \(SELECT company_id FROM deliveries WHERE deliveries\.id = delivery_eta_observations\.delivery_id\) WHERE company_id IS NULL/);
});
