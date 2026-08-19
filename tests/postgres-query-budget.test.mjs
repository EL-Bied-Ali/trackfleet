import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync("app/lib/delivery-store.postgres.ts", "utf8");

function block(start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `missing block start: ${start}`);
  assert.ok(endIndex > startIndex, `missing block end: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("trip upsert uses one Postgres round trip", () => {
  const body = block("async upsertTrip(input)", "async getTrip(companyId, tripId)");
  assert.match(body, /ON CONFLICT \(company_id, id\) DO UPDATE SET/);
  assert.match(body, /RETURNING \*/);
  assert.doesNotMatch(body, /this\.getTrip/);
  assert.doesNotMatch(body, /SELECT \* FROM trips/);
});

test("trip listing hydrates one query instead of N plus one", () => {
  const body = block("async listTrips(companyId, limit = 100)", "async assignDeliveryTrip(deliveryId, companyId, tripId)");
  assert.match(body, /SELECT \* FROM trips/);
  assert.match(body, /rows\.map\(hydrateTrip\)/);
  assert.doesNotMatch(body, /this\.getTrip/);
  assert.doesNotMatch(body, /Promise\.all/);
});

test("pending notifications fetch delivery and event in one query", () => {
  const body = block("async listPendingNotifications(companyId)", "async claimNotification(deliveryId, type)");
  assert.match(body, /SELECT d\.\*/);
  assert.match(body, /event_delivery_id/);
  assert.doesNotMatch(body, /SELECT \* FROM deliveries WHERE id/);
  assert.doesNotMatch(body, /for \(const raw of rows\)/);
});
