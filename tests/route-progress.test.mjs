import assert from "node:assert/strict";
import test from "node:test";
import { calculateRouteMetrics, deriveDeliveryState, rebaseRouteMetrics } from "../app/lib/route-progress.ts";

test("calculates Morocco-bound progress along the shared corridor", () => {
  const start = calculateRouteMetrics(50.8503, 4.3517, "Casablanca, MA");
  const middle = calculateRouteMetrics(40.4168, -3.7038, "Casablanca, MA");
  const end = calculateRouteMetrics(33.5731, -7.5898, "Casablanca, MA");
  assert.equal(start.progress, 0);
  assert.ok(middle.progress > 35 && middle.progress < 75, `middle progress was ${middle.progress}`);
  assert.equal(end.progress, 100);
  assert.ok(end.distanceToDestinationKm < 0.1);
});

test("reverses progress for Belgium-bound deliveries", () => {
  const start = calculateRouteMetrics(33.5731, -7.5898, "Brussels, BE");
  const end = calculateRouteMetrics(50.8503, 4.3517, "Brussels, BE");
  assert.equal(start.progress, 0);
  assert.equal(end.progress, 100);
});

test("recognizes a full Belgian address as a Belgium-bound destination", () => {
  const start = calculateRouteMetrics(33.5731, -7.5898, "45 Boulevard de l'Abattoir, 1000 Bruxelles, Belgique");
  const end = calculateRouteMetrics(50.8503, 4.3517, "45 Boulevard de l'Abattoir, 1000 Bruxelles, Belgique");
  assert.equal(start.progress, 0);
  assert.equal(end.progress, 100);
});

test("stops the Morocco route at Tangier instead of continuing to Casablanca", () => {
  const tangier = calculateRouteMetrics(35.7673, -5.8128, "Tangier, MA");
  assert.equal(tangier.progress, 100);
  assert.ok(tangier.distanceToDestinationKm < 0.1);
  const casablanca = calculateRouteMetrics(33.5731, -7.5898, "Tangier, MA");
  assert.ok(casablanca.distanceToDestinationKm > 250);
});

test("extends Belgium-bound route from Brussels to Antwerp", () => {
  const brussels = calculateRouteMetrics(50.8503, 4.3517, "Antwerp, BE");
  const antwerp = calculateRouteMetrics(51.2194, 4.4025, "Antwerp, BE");
  assert.ok(brussels.progress < 100);
  assert.equal(antwerp.progress, 100);
  assert.ok(antwerp.distanceToDestinationKm < 0.1);
});

test("uses the correct Morocco city fallback instead of Casablanca for agency stops", () => {
  const marrakech = calculateRouteMetrics(31.6295, -7.9811, "12 Boulevard Essaouira, Marrakech, Maroc");
  assert.equal(marrakech.progress, 100);
  assert.ok(marrakech.distanceToDestinationKm < 0.1);

  const agadir = calculateRouteMetrics(30.4278, -9.5981, "Lot 103/A Zaitoune Tikiouine, Agadir, Maroc");
  assert.equal(agadir.progress, 100);
  assert.ok(agadir.distanceToDestinationKm < 0.1);

  const tetouan = calculateRouteMetrics(35.5889, -5.3626, "146 Avenue Cortoba, Tétouan, Maroc");
  assert.equal(tetouan.progress, 100);
  assert.ok(tetouan.distanceToDestinationKm < 0.1);
});

test("uses an exact customer site instead of the city fallback when provided", () => {
  const exactSite = [-7.62, 33.55];
  const atCityFallback = calculateRouteMetrics(33.5731, -7.5898, "Casablanca, MA", exactSite);
  assert.ok(atCityFallback.distanceToDestinationKm > 2);

  const atExactSite = calculateRouteMetrics(33.55, -7.62, "Casablanca, MA", exactSite);
  assert.ok(atExactSite.distanceToDestinationKm < 0.1);
  assert.equal(atExactSite.progress, 100);
});

test("honours a configurable arrival geofence radius", () => {
  const metrics = {
    progress: 99,
    routeDistanceKm: 100,
    completedDistanceKm: 99,
    remainingDistanceKm: 1,
    distanceFromOriginKm: 99,
    distanceToDestinationKm: 0.8,
  };
  assert.equal(deriveDeliveryState("In transit", metrics, 0, 99, 0.5).status, "In transit");
  assert.equal(deriveDeliveryState("In transit", metrics, 0, 99, 1).status, "Delivered");
});

test("rebases a delivery created mid-corridor to zero percent", () => {
  const creationFix = calculateRouteMetrics(35.7673, -5.8128, "Casablanca, MA");
  assert.ok(creationFix.progress > 0);
  const atCreation = rebaseRouteMetrics(creationFix, creationFix.progress);
  assert.ok(atCreation.progress <= 1, `rebased start was ${atCreation.progress}%`);

  const destinationFix = calculateRouteMetrics(33.5731, -7.5898, "Casablanca, MA");
  const atDestination = rebaseRouteMetrics(destinationFix, creationFix.progress);
  assert.equal(atDestination.progress, 100);
  assert.ok(atDestination.routeDistanceKm < destinationFix.routeDistanceKm);
});

test("derives loading, in-transit and delivered states from GPS", () => {
  const atOrigin = calculateRouteMetrics(50.8503, 4.3517, "Casablanca, MA");
  assert.deepEqual(deriveDeliveryState("Loading", atOrigin, 0), { status: "Loading", progress: 0 });
  assert.deepEqual(deriveDeliveryState("Loading", atOrigin, 15), { status: "Loading", progress: 0 });
  const madrid = calculateRouteMetrics(40.4168, -3.7038, "Casablanca, MA");
  const moving = deriveDeliveryState("Loading", madrid, 70);
  assert.equal(moving.status, "In transit");
  assert.ok(moving.progress > 0);
  const destination = calculateRouteMetrics(33.5731, -7.5898, "Casablanca, MA");
  assert.deepEqual(deriveDeliveryState("In transit", destination, 0), { status: "Delivered", progress: 100 });
  assert.equal(deriveDeliveryState("In transit", destination, 50).status, "In transit");
});

test("does not mark departure from a stale GPS position", () => {
  const moved = {
    progress: 3, routeDistanceKm: 1000, completedDistanceKm: 30, remainingDistanceKm: 970,
    distanceFromOriginKm: 30, distanceToDestinationKm: 970,
  };
  const state = deriveDeliveryState("Loading", moved, 60, 0, 0.5, 45);
  assert.equal(state.status, "Loading");
});

test("does not mark departure from GPS displacement while the truck is stopped", () => {
  const moved = {
    progress: 3, routeDistanceKm: 1000, completedDistanceKm: 30, remainingDistanceKm: 970,
    distanceFromOriginKm: 30, distanceToDestinationKm: 970,
  };
  const state = deriveDeliveryState("Loading", moved, 0, 0, 0.5, 2);
  assert.equal(state.status, "Loading");
});

test("marks departure only after fresh movement beyond the departure zone", () => {
  const moved = {
    progress: 2, routeDistanceKm: 1000, completedDistanceKm: 20, remainingDistanceKm: 980,
    distanceFromOriginKm: 20, distanceToDestinationKm: 980,
  };
  const state = deriveDeliveryState("Loading", moved, 35, 0, 0.5, 2);
  assert.equal(state.status, "In transit");
});

test("does not move customer progress backwards after a noisier GPS fix", () => {
  const previousProgress = 55;
  const noisierFixMetrics = {
    progress: 52, routeDistanceKm: 2200, completedDistanceKm: 1144, remainingDistanceKm: 1056,
    distanceFromOriginKm: 1200, distanceToDestinationKm: 1000,
  };
  const state = deriveDeliveryState("In transit", noisierFixMetrics, 60, previousProgress);
  assert.equal(state.progress, previousProgress);
  assert.equal(state.status, "In transit");
});
