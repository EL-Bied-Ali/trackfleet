import assert from "node:assert/strict";
import test from "node:test";
import { progressRouteDestination } from "../app/lib/delivery-progress-destination.ts";

test("a relay-limited destination (Tétouan) is substituted with its confirmed GPS hub (Tanger Med) for route/progress purposes", () => {
  const result = progressRouteDestination({
    destination: "146 Avenue Cortoba, 93000 Tétouan, Maroc",
    destinationSiteId: "tetouan-cortoba-146",
    explicitDestination: null,
  });
  assert.match(result.destination, /Tanger Med/);
  assert.doesNotMatch(result.destination, /Tétouan/);
});

test("a relay-limited destination on the Casablanca hub (Salé) is substituted with Casablanca", () => {
  const result = progressRouteDestination({
    destination: "12 Bis, Hay Nasser rue N°1, Route de Kénitra, sortie Akkari, Salé, Maroc",
    destinationSiteId: "sale-hay-nasser-12bis",
    explicitDestination: null,
  });
  assert.match(result.destination, /Casablanca/);
});

test("a confirmed GPS hub itself (Tanger Med, Casablanca) is left untouched -- it's not finalLegTrackingUnavailable", () => {
  const result = progressRouteDestination({
    destination: "Oued Ghlala, Ksar Al Majaz, 93000 Tanger Med, Maroc",
    destinationSiteId: "tanger-med-ksar-al-majaz",
    explicitDestination: null,
  });
  assert.match(result.destination, /Tanger Med/);
});

test("a destination with no known site (unrecognized id, or a manually-typed one with no destinationSiteId) is left untouched", () => {
  const result = progressRouteDestination({
    destination: "Somewhere, BE",
    destinationSiteId: null,
    explicitDestination: null,
  });
  assert.equal(result.destination, "Somewhere, BE");
});

test("any explicit coordinates passed in are dropped once the destination is substituted to the hub -- the hub's own coordinates (or none) apply instead", () => {
  const result = progressRouteDestination({
    destination: "146 Avenue Cortoba, 93000 Tétouan, Maroc",
    destinationSiteId: "tetouan-cortoba-146",
    explicitDestination: [-5.3626, 35.5889],
  });
  assert.notDeepEqual(result.explicitDestination, [-5.3626, 35.5889]);
});
