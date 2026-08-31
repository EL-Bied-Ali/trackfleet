import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { memoryStore } from "../app/lib/delivery-store.memory.ts";
import { createParcelCode, isValidParcelCode, parcelScanUrl } from "../app/lib/parcel-code.ts";
import { customerFacingEvent } from "../app/lib/delivery-events.ts";

const route = await readFile(new URL("../app/api/scan/route.ts", import.meta.url), "utf8");
const typesFile = await readFile(new URL("../app/lib/delivery-store.types.ts", import.meta.url), "utf8");
const creationRoute = await readFile(new URL("../app/api/deliveries/route.ts", import.meta.url), "utf8");
const demoCreationRoute = await readFile(new URL("../app/api/deliveries/demo/route.ts", import.meta.url), "utf8");

function baseDeliveryInput(companyId, overrides = {}) {
  return {
    customer: "Scan Test SARL", originSiteId: "brussels-abattoir-45", originLatitude: null, originLongitude: null,
    destinationSiteId: "casablanca-mohammed-vi-959", destination: "Casablanca", destinationLatitude: null, destinationLongitude: null,
    arrivalRadiusKm: 0.5, truck: "TRUCK-scan", driver: "", status: "Loading", eta: "",
    plannedArrivalAt: null, nextTruckDepartureAt: null, progress: 0, color: "#000",
    contact: "", whatsappOptIn: false, whatsappOptInAt: null, sendatrackVehicleId: "",
    latitude: null, longitude: null, speed: null, lastPositionAt: null, gpsSource: "simulation",
    companyId, trackingToken: `tok-scan-${Date.now()}-${Math.random()}`, tripId: null,
    parcelCode: createParcelCode(),
    ...overrides,
  };
}

test("createParcelCode produces a valid, print-friendly code every time -- no ambiguous 0/O/1/I/L characters", () => {
  for (let i = 0; i < 200; i += 1) {
    const code = createParcelCode();
    assert.equal(isValidParcelCode(code), true, code);
    assert.doesNotMatch(code, /[01ILO]/);
    assert.equal(code.length, 10);
  }
});

test("isValidParcelCode rejects the customer-facing tracking token shape and other malformed input", () => {
  assert.equal(isValidParcelCode("abcdefghij"), false, "lowercase must be rejected -- the alphabet is uppercase-only");
  assert.equal(isValidParcelCode("2345678901"), false, "digits 0/1 are not in the alphabet");
  assert.equal(isValidParcelCode("SHORT"), false);
  assert.equal(isValidParcelCode(""), false);
});

test("parcelScanUrl builds a deep link a phone's native camera can also open directly", () => {
  const code = createParcelCode();
  assert.equal(parcelScanUrl("https://trackfleet.example", code), `https://trackfleet.example/scan?code=${code}`);
});

test("findByParcelCode is company-scoped -- a code never resolves across companies", async () => {
  const companyA = `scan-company-a-${Date.now()}`;
  const companyB = `scan-company-b-${Date.now()}`;
  const code = createParcelCode();
  const delivery = await memoryStore.create(baseDeliveryInput(companyA, { parcelCode: code }));

  const foundInOwnCompany = await memoryStore.findByParcelCode(companyA, code);
  assert.equal(foundInOwnCompany?.id, delivery.id);

  const foundInOtherCompany = await memoryStore.findByParcelCode(companyB, code);
  assert.equal(foundInOtherCompany, null, "the same code must never resolve under a different company");
});

test("recordScan and listScansForDelivery keep every scan, including repeats of the same checkpoint -- unlike recordEvent's one-per-type constraint", async () => {
  const companyId = `scan-audit-test-${Date.now()}`;
  const delivery = await memoryStore.create(baseDeliveryInput(companyId));

  await memoryStore.recordScan({ companyId, deliveryId: delivery.id, checkpoint: "loaded", scannedBy: "dispatcher:alice", truck: "TRUCK-scan", locationLabel: null });
  await memoryStore.recordScan({ companyId, deliveryId: delivery.id, checkpoint: "loaded", scannedBy: "dispatcher:bob", truck: "TRUCK-scan", locationLabel: null });

  const scans = await memoryStore.listScansForDelivery(delivery.id);
  assert.equal(scans.length, 2, "a second scan of the same checkpoint must not be silently dropped, unlike recordEvent");
  assert.deepEqual(new Set(scans.map((scan) => scan.scannedBy)), new Set(["dispatcher:alice", "dispatcher:bob"]));
});

test("SCAN_LOADED is internal bookkeeping, excluded from the customer-facing timeline like MANUAL_ARRIVAL_CONFIRMED -- the scanner's other checkpoint, 'arrived', has no scan-only event type at all since it reuses the real ARRIVED_AT_SITE milestone", () => {
  assert.equal(customerFacingEvent("SCAN_LOADED"), false);
});

test("the DeliveryStore interface declares the scan methods and every backend implements them", async () => {
  assert.match(typesFile, /findByParcelCode\(companyId: string, parcelCode: string\): Promise<DeliveryRow \| null>;/);
  assert.match(typesFile, /recordScan\(input: DeliveryScanInput\): Promise<DeliveryScanRow>;/);
  assert.match(typesFile, /listScansForDelivery\(deliveryId: string, limit\?: number\): Promise<DeliveryScanRow\[\]>;/);
  for (const path of [
    "app/lib/delivery-store.postgres.ts",
    "app/lib/delivery-store.cloudflare.ts",
    "app/lib/delivery-store.memory.ts",
  ]) {
    const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
    assert.match(source, /findByParcelCode/, `${path} must implement findByParcelCode`);
    assert.match(source, /recordScan/, `${path} must implement recordScan`);
  }
  // shared-postgres.ts inherits findByParcelCode/listScansForDelivery via
  // its `...baseStore` spread (no D1 mirroring needed for reads) -- it only
  // needs its own recordScan override, for the D1 write-mirror.
  const sharedPostgresSource = await readFile(new URL("../app/lib/delivery-store.shared-postgres.ts", import.meta.url), "utf8");
  assert.match(sharedPostgresSource, /async recordScan\(input\) \{/, "shared-postgres.ts must implement recordScan");
});

test("the scan route only offers loaded/arrived, is authenticated, same-origin protected, validates the parcel code and checkpoint, and scopes an agency to its own site", () => {
  assert.match(route, /const CHECKPOINTS: DeliveryScanCheckpoint\[\] = \["loaded", "arrived"\];/);
  assert.match(route, /const session = await getCompanySession\(request\);/);
  assert.match(route, /requestIsSameOrigin\(request\)/);
  assert.match(route, /if \(!isValidParcelCode\(parcelCode\)\) return noStore\(\{ error: "invalid_parcel_code" \}, 400\);/);
  assert.match(route, /if \(!CHECKPOINTS\.includes\(checkpoint\)\) return noStore\(\{ error: "invalid_checkpoint" \}, 400\);/);
  assert.match(route, /if \(session\.role === "agency" && !agencyDeliveryIsVisible\(delivery, session\.siteId\)\)/);
});

test("the 'arrived' checkpoint reuses confirmArrivalManually directly -- the same real, customer-facing arrival confirmation (status/progress + WhatsApp) the dispatcher's 'Confirmer l'arrivée' button already uses, not a separate scan-only bookkeeping event", () => {
  assert.match(route, /import \{ confirmArrivalManually \} from "\.\.\/\.\.\/lib\/confirm-arrival-manually";/);
  assert.match(route, /if \(checkpoint === "arrived"\) \{\s*\n\s*await confirmArrivalManually\(session\.companyId, delivery\.id, delivery\.progress, new URL\(request\.url\)\.origin\);/);
  assert.match(route, /await store\.recordEvent\(delivery\.id, "SCAN_LOADED", delivery\.progress\);/);
});

test("scanning 'arrived' is refused for an already-delivered parcel, and an agency can only confirm arrival at its own destination -- same restriction as the 'Confirmer l'arrivée' button", () => {
  assert.match(route, /if \(checkpoint === "arrived" && delivery\.status === "Delivered"\) \{\s*\n\s*return noStore\(\{ error: "already_delivered" \}, 409\);/);
  assert.match(route, /if \(checkpoint === "arrived" && session\.role === "agency" && delivery\.destinationSiteId !== session\.siteId\) \{\s*\n\s*return noStore\(\{ error: "agency_destination_mismatch" \}, 403\);/);
});

test("a duplicate scan of the same checkpoint within the debounce window is reported back but not re-recorded or re-applied", () => {
  assert.match(route, /const DUPLICATE_SCAN_WINDOW_MS = 30_000;/);
  assert.match(route, /now - scan\.scannedAt\.getTime\(\) < DUPLICATE_SCAN_WINDOW_MS/);
  assert.match(route, /if \(!duplicate\) \{/);
});

test("delivery creation generates a parcel code for every new delivery", () => {
  assert.match(creationRoute, /import \{ createParcelCode \} from "\.\.\/\.\.\/lib\/parcel-code";/);
  assert.match(creationRoute, /parcelCode: createParcelCode\(\),/);
});

// Reported live: a demo delivery has its own store.create call, separate
// from the real creation route -- the first version of this feature only
// wired parcelCode into the real route, so every demo delivery (including
// the ones this app's own guide encourages showing to a prospective
// client) silently had no printable label / scannable code at all.
test("demo delivery creation also generates a parcel code -- it has its own store.create call, separate from the real creation route", () => {
  assert.match(demoCreationRoute, /import \{ createParcelCode \} from "\.\.\/\.\.\/\.\.\/lib\/parcel-code";/);
  assert.match(demoCreationRoute, /parcelCode: createParcelCode\(\),/);
});

// Reported live: the field is generated correctly at creation (confirmed
// via the create response) but vanished from the dashboard's own delivery
// list moments later. Root cause: listForCompany doesn't use the generic
// hydrate() in delivery-store.postgres.ts at all -- it's overridden to a
// separate, purpose-built "operational" read path (loadOperationalDeliveries,
// optimized for the live dashboard's active+recent-completed query shape)
// with its own field-by-field row-to-DeliveryRow mapping that this feature
// never touched, so parcel_code came back from Postgres (SELECT delivery.*)
// but was silently dropped on the way out. Every other place a delivery
// row gets reconstructed from raw SQL columns has the identical shape and
// was checked for the same gap.
test("every delivery-row hydration path (not just the primary store) carries parcel_code through -- the live dashboard's optimized read path uses a completely separate mapping function from the one create()/findByParcelCode() use", async () => {
  for (const path of [
    "app/lib/delivery-operational.postgres.ts",
    "app/lib/delivery-operational.cloudflare.ts",
    "app/lib/d1-standby-read-store.ts",
    "app/lib/d1-history-backfill.ts",
    "app/lib/d1-reconciliation.ts",
  ]) {
    const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
    assert.match(source, /parcel_code/, `${path} must read/write parcel_code, not silently drop it`);
  }
});
