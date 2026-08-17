import assert from "node:assert/strict";
import test from "node:test";
import { UNASSIGNED_TRUCK } from "../app/lib/delivery-vehicle-choice.ts";
import { suggestPlannedTrip } from "../app/lib/trip-suggestion.ts";

const parcel = {
  originSiteId: "brussels",
  destinationSiteId: "casablanca",
  truck: UNASSIGNED_TRUCK,
  sendatrackVehicleId: "",
};

const trips = [
  {
    id: "TRIP-LATE",
    routeTemplateId: "ROUTE-A",
    truck: "TRK-2",
    sendatrackVehicleId: "gps-2",
    originSiteId: "brussels",
    status: "planned",
    stops: [{ siteId: "casablanca", sequence: 2, plannedArrivalAt: "2026-08-21T12:00:00Z" }],
  },
  {
    id: "TRIP-EARLY",
    routeTemplateId: "ROUTE-B",
    truck: "TRK-1",
    sendatrackVehicleId: "gps-1",
    originSiteId: "brussels",
    status: "planned",
    stops: [{ siteId: "casablanca", sequence: 1, plannedArrivalAt: "2026-08-20T12:00:00Z" }],
  },
];

test("suggests the earliest compatible planned trip", () => {
  assert.equal(suggestPlannedTrip(parcel, trips)?.tripId, "TRIP-EARLY");
});

test("never suggests an active trip", () => {
  const activeOnly = [{ ...trips[0], id: "TRIP-ACTIVE", status: "active" }];
  assert.equal(suggestPlannedTrip(parcel, activeOnly), null);
});

test("requires matching origin and destination", () => {
  assert.equal(suggestPlannedTrip({ ...parcel, originSiteId: "sale" }, trips), null);
  assert.equal(suggestPlannedTrip({ ...parcel, destinationSiteId: "agadir" }, trips), null);
});

test("does not suggest a trip for an already assigned parcel", () => {
  assert.equal(suggestPlannedTrip({ ...parcel, truck: "TRK-9", sendatrackVehicleId: "gps-9" }, trips), null);
});
