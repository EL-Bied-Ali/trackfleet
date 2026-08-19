import assert from "node:assert/strict";
import test from "node:test";
import { MAX_BULK_DELIVERY_ROWS, parseBulkDeliveryCsv } from "../app/lib/bulk-delivery-import.ts";

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
  assert.ok(result.errors.some((error) => error.includes("truck is required")));
  assert.ok(result.errors.some((error) => error.includes("planned_arrival_at is invalid")));
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
