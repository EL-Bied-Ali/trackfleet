import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { memoryStore } from "../app/lib/delivery-store.memory.ts";
import { createParcelCode, isValidParcelCode, parcelScanUrl } from "../app/lib/parcel-code.ts";
import { customerFacingEvent } from "../app/lib/delivery-events.ts";

const route = await readFile(new URL("../app/api/scan/route.ts", import.meta.url), "utf8");
const typesFile = await readFile(new URL("../app/lib/delivery-store.types.ts", import.meta.url), "utf8");
const creationRoute = await readFile(new URL("../app/api/deliveries/route.ts", import.meta.url), "utf8");

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
  assert.equal(parcelScanUrl("https://trackfleet.example", code), `https://trackfleet.example/scan/${code}`);
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

test("SCAN_LOADED/SCAN_DEPARTED/SCAN_ARRIVED are internal bookkeeping, excluded from the customer-facing timeline like MANUAL_ARRIVAL_CONFIRMED", () => {
  assert.equal(customerFacingEvent("SCAN_LOADED"), false);
  assert.equal(customerFacingEvent("SCAN_DEPARTED"), false);
  assert.equal(customerFacingEvent("SCAN_ARRIVED"), false);
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

test("the scan route is authenticated, same-origin protected, validates the parcel code and checkpoint, and scopes an agency to its own site", () => {
  assert.match(route, /const session = await getCompanySession\(request\);/);
  assert.match(route, /requestIsSameOrigin\(request\)/);
  assert.match(route, /if \(!isValidParcelCode\(parcelCode\)\) return noStore\(\{ error: "invalid_parcel_code" \}, 400\);/);
  assert.match(route, /if \(!CHECKPOINTS\.includes\(checkpoint\)\) return noStore\(\{ error: "invalid_checkpoint" \}, 400\);/);
  assert.match(route, /if \(session\.role === "agency" && !agencyDeliveryIsVisible\(delivery, session\.siteId\)\)/);
});

test("the 'delivered' checkpoint reuses completeDeliveryManually directly, and CHECKPOINT_EVENT has no entry for it -- no separate scan-only event type exists for delivered", () => {
  assert.match(route, /import \{ completeDeliveryManually \} from "trackfleet-delivery-completion";/);
  assert.match(route, /if \(checkpoint === "delivered"\) \{\s*\n\s*await completeDeliveryManually\(session\.companyId, delivery\.id\);/);
  assert.match(route, /const CHECKPOINT_EVENT: Partial<Record<DeliveryScanCheckpoint, "SCAN_LOADED" \| "SCAN_DEPARTED" \| "SCAN_ARRIVED">>/);
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
