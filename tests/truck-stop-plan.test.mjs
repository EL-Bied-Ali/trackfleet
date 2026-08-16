import assert from "node:assert/strict";
import test from "node:test";
import { buildTruckStopPlans, pendingServiceMinutesBefore } from "../app/lib/truck-stop-plan.ts";

function delivery(overrides) {
  return {
    id: "TF-1",
    customer: "Client A",
    originSiteId: "brussels-abattoir-45",
    destinationSiteId: "casablanca-mohammed-vi-959",
    destination: "959 Boulevard Mohammed VI, Casablanca, Maroc",
    destinationLatitude: null,
    destinationLongitude: null,
    arrivalRadiusKm: 0.5,
    truck: "TRK-014",
    driver: "Driver",
    status: "In transit",
    eta: "",
    plannedArrivalAt: new Date("2026-08-20T10:00:00Z"),
    progress: 0,
    color: "#000000",
    contact: "",
    sendatrackVehicleId: "veh-14",
    latitude: null,
    longitude: null,
    speed: null,
    lastPositionAt: null,
    gpsSource: "sendatrack",
    companyId: "company-a",
    trackingToken: null,
    createdAt: new Date("2026-08-16T10:00:00Z"),
    ...overrides,
  };
}

test("groups multiple parcels for the same agency into one truck stop", () => {
  const plans = buildTruckStopPlans([
    delivery({ id: "TF-1", customer: "Client A" }),
    delivery({ id: "TF-2", customer: "Client B", plannedArrivalAt: new Date("2026-08-20T11:00:00Z") }),
    delivery({
      id: "TF-3",
      customer: "Client C",
      destinationSiteId: "marrakech-essaouira-12",
      destination: "12 Boulevard Essaouira, Marrakech, Maroc",
      plannedArrivalAt: new Date("2026-08-21T09:00:00Z"),
    }),
  ]);

  assert.equal(plans.length, 1);
  assert.equal(plans[0].stops.length, 2);
  assert.equal(plans[0].stops[0].siteId, "casablanca-mohammed-vi-959");
  assert.deepEqual(plans[0].stops[0].deliveryIds, ["TF-1", "TF-2"]);
  assert.deepEqual(plans[0].stops[0].customers, ["Client A", "Client B"]);
  assert.equal(plans[0].stops[1].siteId, "marrakech-essaouira-12");
});

test("orders stops by their earliest planned arrival", () => {
  const plans = buildTruckStopPlans([
    delivery({ id: "TF-1", plannedArrivalAt: new Date("2026-08-22T10:00:00Z") }),
    delivery({
      id: "TF-2",
      destinationSiteId: "tanger-ville-said-kotb-19a",
      destination: "N°19 A Résidence Jouba, Boulevard Said Kotb, Tanger, Maroc",
      plannedArrivalAt: new Date("2026-08-19T08:00:00Z"),
    }),
  ]);

  assert.deepEqual(plans[0].stops.map((stop) => stop.siteId), [
    "tanger-ville-said-kotb-19a",
    "casablanca-mohammed-vi-959",
  ]);
});

test("excludes delivered parcels and separates different trucks", () => {
  const plans = buildTruckStopPlans([
    delivery({ id: "TF-1", status: "Delivered" }),
    delivery({ id: "TF-2", truck: "TRK-014", sendatrackVehicleId: "veh-14" }),
    delivery({ id: "TF-3", truck: "TRK-007", sendatrackVehicleId: "veh-7" }),
  ]);

  assert.equal(plans.length, 2);
  assert.ok(plans.every((plan) => plan.stops.flatMap((stop) => stop.deliveryIds).every((id) => id !== "TF-1")));
});

test("adds service time only for distinct pending stops before the target", () => {
  const target = delivery({
    id: "TF-MAR",
    destinationSiteId: "marrakech-essaouira-12",
    destination: "12 Boulevard Essaouira, Marrakech, Maroc",
    plannedArrivalAt: new Date("2026-08-21T09:00:00Z"),
  });
  const rows = [
    target,
    delivery({ id: "TF-CAS-1", plannedArrivalAt: new Date("2026-08-20T10:00:00Z") }),
    delivery({ id: "TF-CAS-2", plannedArrivalAt: new Date("2026-08-20T11:00:00Z") }),
    delivery({
      id: "TF-TAN",
      destinationSiteId: "tanger-ville-said-kotb-19a",
      destination: "Tanger, Maroc",
      plannedArrivalAt: new Date("2026-08-19T08:00:00Z"),
    }),
  ];
  assert.equal(pendingServiceMinutesBefore(target, rows, 30), 60);
});

test("does not count an already delivered stop again", () => {
  const target = delivery({
    id: "TF-MAR",
    destinationSiteId: "marrakech-essaouira-12",
    plannedArrivalAt: new Date("2026-08-21T09:00:00Z"),
  });
  const rows = [
    target,
    delivery({ id: "TF-CAS", status: "Delivered", plannedArrivalAt: new Date("2026-08-20T10:00:00Z") }),
  ];
  assert.equal(pendingServiceMinutesBefore(target, rows, 30), 0);
});
