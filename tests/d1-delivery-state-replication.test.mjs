import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync("app/lib/delivery-store.shared-postgres.ts", "utf8");

test("GPS snapshot results mirror returned delivery state without rereading Postgres", () => {
  assert.match(source, /const transitions = await baseStore\.applySendatrackSnapshot\(snapshot, companyId\);\s*for \(const transition of transitions\) await mirrorDelivery\(transition\.delivery\);\s*return transitions;/s);
});

test("vehicle linking mirrors the updated delivery returned by Postgres", () => {
  assert.match(source, /const delivery = await baseStore\.linkVehicle\(deliveryId, companyId, vehicle\);\s*if \(delivery\) await mirrorDelivery\(delivery\);\s*return delivery;/s);
});

test("trip assignments mirror only after the primary mutation succeeds", () => {
  assert.match(source, /const assigned = await baseStore\.assignDeliveryTrip\(deliveryId, companyId, tripId\);\s*if \(assigned\) await mirrorTripAssignment\(deliveryId, companyId, tripId\);/s);
  assert.match(source, /const delivery = await baseStore\.assignDeliveryToPlannedTrip\(deliveryId, companyId, tripId, truck, sendatrackVehicleId\);\s*if \(delivery\) await mirrorDelivery\(delivery\);/s);
});

test("state replication does not add a second Neon read for mirroring", () => {
  assert.doesNotMatch(source, /baseStore\.getPublic/);
  assert.doesNotMatch(source, /baseStore\.listForCompany/);
});
