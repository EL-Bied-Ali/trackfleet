import assert from "node:assert/strict";
import test from "node:test";
import { calculateRouteMetrics } from "../app/lib/route-progress.ts";
import { buildTruckStopPlans, pendingServiceMinutesBefore } from "../app/lib/truck-stop-plan.ts";

const base = {
  originSiteId: "be-brussels-abattoir-45",
  originLatitude: 50.8503,
  originLongitude: 4.3517,
  destinationLatitude: null,
  destinationLongitude: null,
  arrivalRadiusKm: 0.5,
  truck: "TRK-014",
  driver: "Driver",
  status: "In transit",
  eta: "12:00",
  progress: 0,
  color: "#000",
  contact: "",
  sendatrackVehicleId: "veh-14",
  latitude: 34.0337,
  longitude: -6.7985,
  speed: 70,
  lastPositionAt: new Date("2026-08-17T10:00:00Z"),
  gpsSource: "sendatrack",
  companyId: "company-a",
  trackingToken: "token",
  createdAt: new Date("2026-08-16T08:00:00Z"),
};

function delivery(id, customer, destinationSiteId, destination, plannedArrivalAt, status = "In transit") {
  return { ...base, id, customer, destinationSiteId, destination, plannedArrivalAt: new Date(plannedArrivalAt), status };
}

test("models one outbound truck tour without mixing customer destinations", () => {
  const rows = [
    delivery("TF-1", "Client Tanger", "ma-tanger-ville", "N°19 A Résidence Jouba, Boulevard Said Kotb, Tanger, Maroc", "2026-08-17T08:00:00Z", "Delivered"),
    delivery("TF-2", "Client Casa A", "ma-casablanca-mohammed-vi-959", "959 Boulevard Mohammed VI, Casablanca, Maroc", "2026-08-17T12:00:00Z"),
    delivery("TF-3", "Client Casa B", "ma-casablanca-mohammed-vi-959", "959 Boulevard Mohammed VI, Casablanca, Maroc", "2026-08-17T12:15:00Z"),
    delivery("TF-4", "Client Marrakech", "ma-marrakech-essaouira-12", "12 Boulevard Essaouira, Marrakech, Maroc", "2026-08-17T17:00:00Z"),
    delivery("TF-5", "Client Agadir", "ma-agadir-tikiouine-103a", "Lot 103/A Zaitoune Tikiouine, Agadir, Maroc", "2026-08-17T22:00:00Z"),
  ];

  const plans = buildTruckStopPlans(rows);
  assert.equal(plans.length, 1);
  assert.deepEqual(plans[0].stops.map((stop) => stop.siteId), [
    "ma-casablanca-mohammed-vi-959",
    "ma-marrakech-essaouira-12",
    "ma-agadir-tikiouine-103a",
  ]);
  assert.equal(plans[0].stops[0].deliveryIds.length, 2, "two Casablanca parcels must remain one truck stop");

  const casa = rows[1];
  const marrakech = rows[3];
  const agadir = rows[4];
  assert.equal(pendingServiceMinutesBefore(casa, rows, 30), 0);
  assert.equal(pendingServiceMinutesBefore(marrakech, rows, 30), 30);
  assert.equal(pendingServiceMinutesBefore(agadir, rows, 30), 60);

  const current = { latitude: 34.0337, longitude: -6.7985 }; // Rabat/Salé area
  const casaMetrics = calculateRouteMetrics(current.latitude, current.longitude, casa.destination, null, [base.originLongitude, base.originLatitude]);
  const marrakechMetrics = calculateRouteMetrics(current.latitude, current.longitude, marrakech.destination, null, [base.originLongitude, base.originLatitude]);
  const agadirMetrics = calculateRouteMetrics(current.latitude, current.longitude, agadir.destination, null, [base.originLongitude, base.originLatitude]);

  assert.ok(casaMetrics.remainingDistanceKm < marrakechMetrics.remainingDistanceKm);
  assert.ok(marrakechMetrics.remainingDistanceKm < agadirMetrics.remainingDistanceKm);
  assert.ok(casaMetrics.progress > marrakechMetrics.progress, "a Casablanca customer should be further through their own trip than an Agadir customer at the same GPS fix");
});

test("keeps return parcels loaded in southern Morocco trackable to Brussels", () => {
  const origin = [-9.5981, 30.4278]; // Agadir
  const start = calculateRouteMetrics(30.4278, -9.5981, "45 Boulevard de l'Abattoir, 1000 Bruxelles, Belgique", null, origin);
  const casablanca = calculateRouteMetrics(33.5731, -7.5898, "45 Boulevard de l'Abattoir, 1000 Bruxelles, Belgique", null, origin);
  const madrid = calculateRouteMetrics(40.4168, -3.7038, "45 Boulevard de l'Abattoir, 1000 Bruxelles, Belgique", null, origin);
  const brussels = calculateRouteMetrics(50.8503, 4.3517, "45 Boulevard de l'Abattoir, 1000 Bruxelles, Belgique", null, origin);

  assert.equal(start.progress, 0);
  assert.ok(casablanca.progress > 0);
  assert.ok(madrid.progress > casablanca.progress);
  assert.equal(brussels.progress, 100);
  assert.ok(start.remainingDistanceKm > casablanca.remainingDistanceKm);
  assert.ok(casablanca.remainingDistanceKm > madrid.remainingDistanceKm);
});
