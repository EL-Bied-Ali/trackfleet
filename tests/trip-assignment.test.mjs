import assert from "node:assert/strict";
import test from "node:test";
import { UNASSIGNED_TRUCK } from "../app/lib/delivery-vehicle-choice.ts";
import { validatePlannedTripAssignment } from "../app/lib/trip-assignment.ts";

const delivery = { id: "D1", originSiteId: "brussels", destinationSiteId: "casablanca", truck: UNASSIGNED_TRUCK, sendatrackVehicleId: "", tripId: null };
const trip = { id: "T1", companyId: "c1", routeTemplateId: "R1", vehicleKey: "v1", truck: "TRK-1", sendatrackVehicleId: "gps-1", originSiteId: "brussels", stops: [{ siteId: "casablanca", destination: "Casablanca", sequence: 1, plannedArrivalAt: null }], status: "planned", createdAt: new Date(), updatedAt: new Date() };

test("accepts only a compatible planned trip for an unassigned parcel", () => {
  assert.equal(validatePlannedTripAssignment(delivery, trip), null);
  assert.equal(validatePlannedTripAssignment({ ...delivery, tripId: "OTHER" }, trip), "delivery_not_unassigned");
  assert.equal(validatePlannedTripAssignment(delivery, { ...trip, status: "active" }), "trip_not_planned");
  assert.equal(validatePlannedTripAssignment({ ...delivery, originSiteId: "sale" }, trip), "origin_mismatch");
  assert.equal(validatePlannedTripAssignment({ ...delivery, destinationSiteId: "agadir" }, trip), "destination_not_on_trip");
});
