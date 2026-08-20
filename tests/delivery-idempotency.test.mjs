import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  deliveryIdempotencyPayloadMatches,
  deliveryIdempotencyTrackingToken,
  validDeliveryIdempotencyKey,
} from "../app/lib/delivery-idempotency.ts";

const routeUrl = new URL("../app/api/deliveries/route.ts", import.meta.url);
const importPageUrl = new URL("../app/import/page.tsx", import.meta.url);

function sampleDelivery(overrides = {}) {
  return {
    id: "TF-1",
    customer: "Client A",
    originSiteId: null,
    originLatitude: null,
    originLongitude: null,
    destinationSiteId: null,
    destination: "Brussels",
    destinationLatitude: null,
    destinationLongitude: null,
    arrivalRadiusKm: 0.5,
    truck: "TRK-1",
    driver: "Driver",
    status: "Loading",
    eta: "15:30",
    plannedArrivalAt: new Date("2026-08-19T15:30:00.000Z"),
    progress: 0,
    color: "#000000",
    contact: "+32123456789",
    weightKg: 12.5,
    priceAmount: 45,
    priceCurrency: "EUR",
    sendatrackVehicleId: "",
    latitude: null,
    longitude: null,
    speed: null,
    lastPositionAt: null,
    gpsSource: "simulation",
    companyId: "company-a",
    trackingToken: "abcdefghijklmnopqrstuvwx",
    createdAt: new Date("2026-08-19T12:00:00.000Z"),
    ...overrides,
  };
}

test("idempotency keys are strictly bounded and safe for headers", () => {
  for (const valid of ["12345678", "import:row-1", "550e8400-e29b-41d4-a716-446655440000", "a".repeat(128)]) {
    assert.equal(validDeliveryIdempotencyKey(valid), true);
  }
  for (const invalid of ["short", "a".repeat(129), "contains space", "contains/slash", "éééééééé"]) {
    assert.equal(validDeliveryIdempotencyKey(invalid), false);
  }
});

test("derived tracking token is deterministic, tenant scoped and public-token compatible", async () => {
  const first = await deliveryIdempotencyTrackingToken("company-a", "550e8400-e29b-41d4-a716-446655440000");
  const same = await deliveryIdempotencyTrackingToken("company-a", "550e8400-e29b-41d4-a716-446655440000");
  const otherCompany = await deliveryIdempotencyTrackingToken("company-b", "550e8400-e29b-41d4-a716-446655440000");
  const otherKey = await deliveryIdempotencyTrackingToken("company-a", "550e8400-e29b-41d4-a716-446655440001");
  assert.equal(first, same);
  assert.match(first, /^[A-Za-z0-9_-]{24}$/);
  assert.notEqual(first, otherCompany);
  assert.notEqual(first, otherKey);
});

test("payload replay requires the normalized identity fields and ETA to match", () => {
  const delivery = sampleDelivery();
  const same = {
    customer: "Client A",
    destination: "Brussels",
    contact: "+32123456789",
    eta: "15:30",
    plannedArrivalAt: new Date("2026-08-19T15:30:00.000Z"),
    weightKg: 12.5,
    priceAmount: 45,
    priceCurrency: "EUR",
  };
  assert.equal(deliveryIdempotencyPayloadMatches(delivery, same), true);
  assert.equal(deliveryIdempotencyPayloadMatches(delivery, { ...same, customer: "Client B" }), false);
  assert.equal(deliveryIdempotencyPayloadMatches(delivery, { ...same, eta: "15:31" }), false);
  assert.equal(deliveryIdempotencyPayloadMatches(delivery, { ...same, weightKg: 13 }), false);
  assert.equal(deliveryIdempotencyPayloadMatches(delivery, { ...same, priceAmount: 46 }), false);
  assert.equal(deliveryIdempotencyPayloadMatches(delivery, { ...same, priceCurrency: "MAD" }), false);
  assert.equal(deliveryIdempotencyPayloadMatches(delivery, { ...same, plannedArrivalAt: new Date("2026-08-19T15:31:00.000Z") }), false);
});

test("delivery POST validates, replays and race-recovers idempotency before duplicate side effects", async () => {
  const source = await readFile(routeUrl, "utf8");
  assert.match(source, /request\.headers\.get\("idempotency-key"\)/);
  assert.match(source, /validDeliveryIdempotencyKey\(idempotencyKey\)/);
  assert.match(source, /deliveryIdempotencyTrackingToken\(session\.companyId, idempotencyKey\)/);
  assert.match(source, /store\.getPublic\(idempotencyTrackingToken\)/);
  assert.match(source, /idempotency_key_conflict/);
  assert.match(source, /trackingToken: idempotencyTrackingToken \?\? createTrackingToken\(\)/);
  assert.match(source, /idempotentReplay: true/);
  assert.match(source, /idempotentReplay: false/);

  const replayCheck = source.indexOf("if (idempotencyTrackingToken) {");
  const snapshot = source.indexOf("const snapshot = await getSendatrackSnapshot", replayCheck);
  assert.ok(replayCheck >= 0 && snapshot > replayCheck, "replay lookup must happen before SENDATRACK work");

  const createCatch = source.indexOf("catch (error) {", source.indexOf("delivery = await store.create"));
  assert.ok(createCatch >= 0);
  assert.ok(source.indexOf("store.getPublic(idempotencyTrackingToken)", createCatch) > createCatch, "create race must recover by re-reading the deterministic token");
});

test("CSV retries retain one generated idempotency key per parsed row", async () => {
  const source = await readFile(importPageUrl, "utf8");
  assert.match(source, /idempotencyKey: crypto\.randomUUID\(\)/);
  assert.match(source, /"idempotency-key": row\.idempotencyKey/);
  assert.match(source, /filter\(\(\{ row \}\) => row\.status !== "success"\)/);
  const failureMutation = source.match(/setRows\(\(existing\) => existing\.map\(\(row, index\) => index === current\.index \? (\{[^\n]+status: "failed"[^\n]+\}) : row\)\)/)?.[1] ?? "";
  assert.match(failureMutation, /\.\.\.row/);
  assert.doesNotMatch(failureMutation, /idempotencyKey/);
  assert.doesNotMatch(failureMutation, /randomUUID/);
});
