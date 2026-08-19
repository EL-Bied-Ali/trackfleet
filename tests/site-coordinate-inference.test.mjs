import assert from "node:assert/strict";
import test from "node:test";
import { inferSiteCoordinateSuggestions } from "../app/lib/site-coordinate-inference.ts";

function points({ address, baseLat, baseLon, vehicles = ["A-1", "B-2"], count = 12 }) {
  return Array.from({ length: count }, (_, index) => ({
    vehicleName: vehicles[index % vehicles.length],
    latitude: baseLat + (index % 3) * 0.00003,
    longitude: baseLon + (index % 2) * 0.00003,
    speed: 0,
    address,
    positionAt: new Date(Date.UTC(2026, 7, 18, 10, index)),
  }));
}

test("specific address evidence plus repeated compact stops produces high confidence", () => {
  const [suggestion] = inferSiteCoordinateSuggestions([
    { id: "tanger-med", label: "Port Tanger Med · Ksar Al Majaz", city: "Tanger Med", address: "Oued Ghlala, Ksar Al Majaz, Maroc", country: "MA" },
  ], points({ address: "RN16, Ksar El Majaz, Maroc", baseLat: 35.859, baseLon: -5.533 }));
  assert.equal(suggestion.confidence, "high");
  assert.ok(suggestion.addressEvidence.includes("ksar") || suggestion.addressEvidence.includes("majaz"));
  assert.equal(suggestion.vehicleCount, 2);
  assert.ok(suggestion.latitude && suggestion.longitude);
});

test("city-only evidence remains medium even with many trucks", () => {
  const [suggestion] = inferSiteCoordinateSuggestions([
    { id: "casa", label: "Casablanca · Boulevard Mohammed VI", city: "Casablanca", address: "959 Boulevard Mohammed VI, Casablanca, Maroc", country: "MA" },
  ], points({ address: "Rue 26, Ben M'sick, Casablanca, Maroc", baseLat: 33.556, baseLon: -7.592, vehicles: ["A-1", "B-2", "C-3"] }));
  assert.equal(suggestion.confidence, "medium");
  assert.equal(suggestion.vehicleCount, 3);
});

test("unrelated stationary clusters are never proposed for a site", () => {
  const [suggestion] = inferSiteCoordinateSuggestions([
    { id: "agadir", label: "Agadir · Zaitoune Tikiouine", city: "Agadir", address: "Lot 103/A Zaitoune Tikiouine, Agadir, Maroc", country: "MA" },
  ], points({ address: "Parking Express, Algeciras, Espagne", baseLat: 36.13, baseLon: -5.441 }));
  assert.equal(suggestion.confidence, "low");
  assert.equal(suggestion.latitude, null);
  assert.equal(suggestion.longitude, null);
});

test("moving observations do not qualify as site stops", () => {
  const moving = points({ address: "Ksar El Majaz, Maroc", baseLat: 35.859, baseLon: -5.533 }).map((point) => ({ ...point, speed: 50 }));
  const [suggestion] = inferSiteCoordinateSuggestions([
    { id: "tanger-med", label: "Port Tanger Med · Ksar Al Majaz", city: "Tanger Med", address: "Ksar Al Majaz, Maroc", country: "MA" },
  ], moving);
  assert.equal(suggestion.latitude, null);
});
