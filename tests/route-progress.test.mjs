import assert from "node:assert/strict";
import test from "node:test";
import { calculateRouteMetrics, deriveDeliveryState } from "../app/lib/route-progress.ts";

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

test("derives loading, in-transit and delivered states from GPS", () => {
  const atOrigin = calculateRouteMetrics(50.8503, 4.3517, "Casablanca, MA");
  assert.deepEqual(deriveDeliveryState("Loading", atOrigin, 0), { status: "Loading", progress: 0 });

  const madrid = calculateRouteMetrics(40.4168, -3.7038, "Casablanca, MA");
  const moving = deriveDeliveryState("Loading", madrid, 70);
  assert.equal(moving.status, "In transit");
  assert.ok(moving.progress > 0);

  const destination = calculateRouteMetrics(33.5731, -7.5898, "Casablanca, MA");
  assert.deepEqual(deriveDeliveryState("In transit", destination, 0), { status: "Delivered", progress: 100 });
});
