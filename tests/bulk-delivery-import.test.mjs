import assert from "node:assert/strict";
import test from "node:test";
import { MAX_BULK_DELIVERY_ROWS, parseBulkDeliveryCsv } from "../app/lib/bulk-delivery-import.ts";
import { UNASSIGNED_TRUCK } from "../app/lib/delivery-vehicle-choice.ts";

test("parses a quoted delivery CSV row", () => {
  const result = parseBulkDeliveryCsv([
    "customer,destination,planned_arrival_at,next_truck_departure_at,origin_site_id,truck,contact,whatsapp_opt_in",
    '"Client, SARL","Casablanca, Maroc",2026-08-20T14:00:00+02:00,2026-08-19T09:00:00+02:00,brussels-abattoir-45,TRUCK-01,+212600000000,oui',
  ].join("\n"));
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].customer, "Client, SARL");
  assert.equal(result.rows[0].destination, "Casablanca, Maroc");
  assert.equal(result.rows[0].whatsappOptIn, true);
  assert.equal(result.rows[0].plannedArrivalAt, "2026-08-20T12:00:00.000Z");
  assert.equal(result.rows[0].nextTruckDepartureAt, "2026-08-19T07:00:00.000Z");
});

test("reports invalid required fields before import", () => {
  const result = parseBulkDeliveryCsv([
    "customer,destination,planned_arrival_at,next_truck_departure_at,origin_site_id,truck",
    ",Casablanca,nope,2026-08-19T09:00:00Z,brussels-abattoir-45,",
  ].join("\n"));
  assert.equal(result.rows.length, 0);
  assert.ok(result.errors.some((error) => error.includes("customer is required")));
  assert.ok(result.errors.some((error) => error.includes("planned_arrival_at is invalid")));
});

test("planned_arrival_at and next_truck_departure_at are optional -- like single-delivery creation, a dispatcher doesn't need to know either date up front", () => {
  // Business-loop audit finding: the single-delivery creation form and its
  // backend validation dropped this requirement earlier (both dates are now
  // editable afterward from the delivery table), but the bulk CSV importer
  // was never updated to match -- it still hard-rejected an entire file for
  // lacking either column, and every row lacking a value. Reported live as
  // exactly the kind of redundant up-front data entry the table-editing
  // work was meant to eliminate, just re-appearing in the one path that
  // wasn't touched.
  const missingHeaders = parseBulkDeliveryCsv([
    "customer,destination,origin_site_id",
    "Client sans dates,Casablanca,brussels-abattoir-45",
  ].join("\n"));
  assert.deepEqual(missingHeaders.errors, []);
  assert.equal(missingHeaders.rows[0].plannedArrivalAt, null);
  assert.equal(missingHeaders.rows[0].nextTruckDepartureAt, null);

  const blankValues = parseBulkDeliveryCsv([
    "customer,destination,planned_arrival_at,next_truck_departure_at,origin_site_id",
    "Client sans dates,Casablanca,,,brussels-abattoir-45",
  ].join("\n"));
  assert.deepEqual(blankValues.errors, []);
  assert.equal(blankValues.rows[0].plannedArrivalAt, null);
  assert.equal(blankValues.rows[0].nextTruckDepartureAt, null);
});

test("planned_arrival_at and next_truck_departure_at are still validated when a value is actually supplied", () => {
  const result = parseBulkDeliveryCsv([
    "customer,destination,planned_arrival_at,next_truck_departure_at,origin_site_id",
    "Client dates invalides,Casablanca,nope,also-nope,brussels-abattoir-45",
  ].join("\n"));
  assert.equal(result.rows.length, 0);
  assert.ok(result.errors.some((error) => error.includes("planned_arrival_at is invalid")));
  assert.ok(result.errors.some((error) => error.includes("next_truck_departure_at is invalid")));
});

test("origin_site_id is required, both as a header and a per-row value -- price depends on it (EUR vs MAD)", () => {
  const missingHeader = parseBulkDeliveryCsv([
    "customer,destination,planned_arrival_at,next_truck_departure_at",
    "Client sans origine,Casablanca,2026-08-20T14:00:00Z,2026-08-19T09:00:00Z",
  ].join("\n"));
  assert.ok(missingHeader.errors.includes("Missing required CSV header: origin_site_id"));

  const blankValue = parseBulkDeliveryCsv([
    "customer,destination,planned_arrival_at,next_truck_departure_at,origin_site_id",
    "Client sans origine,Casablanca,2026-08-20T14:00:00Z,2026-08-19T09:00:00Z,",
  ].join("\n"));
  assert.equal(blankValue.rows.length, 0);
  assert.ok(blankValue.errors.some((error) => error.includes("origin_site_id is required")));
});

test("accepts a bulk parcel without a truck and queues it for assignment", () => {
  const result = parseBulkDeliveryCsv([
    "customer,destination,planned_arrival_at,next_truck_departure_at,origin_site_id",
    "Client sans camion,Casablanca,2026-08-20T14:00:00Z,2026-08-19T09:00:00Z,brussels-abattoir-45",
  ].join("\n"));
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows[0].truck, UNASSIGNED_TRUCK);
  assert.equal(result.rows[0].sendatrackVehicleId, "");
  assert.equal(result.rows[0].originSiteId, "brussels-abattoir-45");
});

test("parses optional weight without inventing missing values", () => {
  const result = parseBulkDeliveryCsv([
    "customer,destination,planned_arrival_at,next_truck_departure_at,origin_site_id,truck,weight_kg",
    "Client EUR,Casa,2026-08-20T14:00:00Z,2026-08-19T09:00:00Z,brussels-abattoir-45,T1,12.3456",
    "Client MAD,Tanger,2026-08-21T14:00:00Z,2026-08-19T09:00:00Z,brussels-abattoir-45,T2,",
  ].join("\n"));
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.rows.map(({ weightKg }) => weightKg), [12.346, null]);
});

test("rejects invalid weight values", () => {
  const result = parseBulkDeliveryCsv([
    "customer,destination,planned_arrival_at,next_truck_departure_at,origin_site_id,truck,weight_kg",
    "A,Casa,2026-08-20T14:00:00Z,2026-08-19T09:00:00Z,brussels-abattoir-45,T1,-1",
  ].join("\n"));
  assert.equal(result.rows.length, 0);
  assert.ok(result.errors.some((error) => error.includes("weight_kg")));
});

test("rejects price columns -- price is always computed from weight and origin, never imported", () => {
  const result = parseBulkDeliveryCsv([
    "customer,destination,planned_arrival_at,next_truck_departure_at,origin_site_id,truck,price_amount",
    "A,Casa,2026-08-20T14:00:00Z,2026-08-19T09:00:00Z,brussels-abattoir-45,T1,45",
  ].join("\n"));
  assert.equal(result.rows.length, 0);
  assert.ok(result.errors.includes("Unsupported CSV header: price_amount"));
});

test("rejects unknown headers rather than silently dropping data", () => {
  const result = parseBulkDeliveryCsv([
    "customer,destination,planned_arrival_at,next_truck_departure_at,origin_site_id,truck,secret_note",
    "A,Casa,2026-08-20T14:00:00Z,2026-08-19T09:00:00Z,brussels-abattoir-45,T1,hello",
  ].join("\n"));
  assert.equal(result.rows.length, 0);
  assert.ok(result.errors.includes("Unsupported CSV header: secret_note"));
});

test("caps a single import to the operational safety limit", () => {
  const rows = Array.from({ length: MAX_BULK_DELIVERY_ROWS + 1 }, (_, index) => `C${index},Casa,2026-08-20T14:00:00Z,2026-08-19T09:00:00Z,brussels-abattoir-45,T1`);
  const result = parseBulkDeliveryCsv(["customer,destination,planned_arrival_at,next_truck_departure_at,origin_site_id,truck", ...rows].join("\n"));
  assert.equal(result.rows.length, 0);
  assert.ok(result.errors[0].includes(`maximum is ${MAX_BULK_DELIVERY_ROWS}`));
});
