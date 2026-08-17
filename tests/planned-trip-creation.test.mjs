import assert from "node:assert/strict";
import test from "node:test";
import { UNASSIGNED_TRUCK } from "../app/lib/delivery-vehicle-choice.ts";
import { firstStopRouteTemplateId, manualTripVehicleKey, validateNewPlannedTrip } from "../app/lib/planned-trip-creation.ts";
const delivery = { id: "D1", status: "Loading", tripId: null, truck: UNASSIGNED_TRUCK, sendatrackVehicleId: "", originSiteId: "brussels", destinationSiteId: "casablanca" };
test("validates new planned trips", () => { assert.equal(validateNewPlannedTrip(delivery, "TRK-01"), null); assert.equal(validateNewPlannedTrip({ ...delivery, tripId: "T1" }, "TRK-01"), "delivery_not_unassigned"); assert.equal(validateNewPlannedTrip({ ...delivery, originSiteId: null }, "TRK-01"), "origin_required"); assert.equal(validateNewPlannedTrip({ ...delivery, destinationSiteId: null }, "TRK-01"), "destination_required"); assert.equal(validateNewPlannedTrip(delivery, ""), "truck_required"); });
test("route and manual vehicle identities are deterministic", () => { assert.equal(firstStopRouteTemplateId(delivery), firstStopRouteTemplateId({ ...delivery })); assert.equal(manualTripVehicleKey(" TRK 001 "), "manual:trk-001"); });
