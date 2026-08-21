import assert from "node:assert/strict";
import test from "node:test";
import { MAX_BULK_DELIVERY_ROWS, parseBulkDeliveryCsv } from "../app/lib/bulk-delivery-import.ts";
import { UNASSIGNED_TRUCK } from "../app/lib/delivery-vehicle-choice.ts";

test("parses a quoted delivery CSV row", () => {
  const result = parseBulkDeliveryCsv([
    "customer,destination,planned_arrival_at,truck,contact,whatsapp_opt_in",
    '"Client, SARL","Casablanca, Maroc",2026-08-20T14:00:00+02:00,TRUCK-01,+212600000000,oui',
  ].join("\n"));
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].customer, "Client, SARL");
  assert.equal(result.rows[0].destination, "Casablanca, Maroc");
  assert.equal(result.rows[0].whatsappOptIn, true);
  assert.equal(result.rows[0].plannedArrivalAt, "2026-08-20T12:00:00.000Z");
});

test("reports invalid required fields before import", () => {
  const result = parseBulkDeliveryCsv([
    "customer,destination,planned_arrival_at,truck",
    ",Casablanca,nope,",
  ].join("\n"));
  assert.equal(result.rows.length, 0);
  assert.ok(result.errors.some((error) => error.includes("customer is required")));
  assert.ok(result.errors.some((error) => error.includes("planned_arrival_at is invalid")));
});

test("accepts a bulk parcel without a truck and queues it for assignment", () => {
  const result = parseBulkDeliveryCsv([
    "customer,destination,planned_arrival_at",
    "Client sans camion,Casablanca,2026-08-20T14:00:00Z",
  ].join("\n"));
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows[0].truck, UNASSIGNED_TRUCK);
  assert.equal(result.rows[0].sendatrackVehicleId, "");
});

test("parses optional weight without inventing missing values", () => {
  const result = parseBulkDeliveryCsv([
    "customer,destination,planned_arrival_at,truck,weight_kg",
    "Client EUR,Casa,2026-08-20T14:00:00Z,T1,12.3456",
    "Client MAD,Tanger,2026-08-21T14:00:00Z,T2,",
  ].join("\n"));
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.rows.map(({ weightKg }) => weightKg), [12.346, null]);
});

test("rejects invalid weight values", () => {
  const result = parseBulkDeliveryCsv([
    "customer,destination,planned_arrival_at,truck,weight_kg",
    "A,Casa,2026-08-20T14:00:00Z,T1,-1",
  ].join("\n"));
  assert.equal(result.rows.length, 0);
  assert.ok(result.errors.some((error) => error.includes("weight_kg")));
});

test("rejects price columns -- price is always computed from weight and origin, never imported", () => {
  const result = parseBulkDeliveryCsv([
    "customer,destination,planned_arrival_at,truck,price_amount",
    "A,Casa,2026-08-20T14:00:00Z,T1,45",
  ].join("\n"));
  assert.equal(result.rows.length, 0);
  assert.ok(result.errors.includes("Unsupported CSV header: price_amount"));
});

test("rejects unknown headers rather than silently dropping data", () => {
  const result = parseBulkDeliveryCsv([
    "customer,destination,planned_arrival_at,truck,secret_note",
    "A,Casa,2026-08-20T14:00:00Z,T1,hello",
  ].join("\n"));
  assert.equal(result.rows.length, 0);
  assert.ok(result.errors.includes("Unsupported CSV header: secret_note"));
});

test("caps a single import to the operational safety limit", () => {
  const rows = Array.from({ length: MAX_BULK_DELIVERY_ROWS + 1 }, (_, index) => `C${index},Casa,2026-08-20T14:00:00Z,T1`);
  const result = parseBulkDeliveryCsv(["customer,destination,planned_arrival_at,truck", ...rows].join("\n"));
  assert.equal(result.rows.length, 0);
  assert.ok(result.errors[0].includes(`maximum is ${MAX_BULK_DELIVERY_ROWS}`));
});
