import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [sendatrackRoute, page, normalize] = await Promise.all([
  readFile(new URL("../app/api/sendatrack/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/sendatrack-normalize.ts", import.meta.url), "utf8"),
]);

test("SENDATRACK already provides a reverse-geocoded address per vehicle, so the truck popover can show a real current location instead of just coordinates", () => {
  // Confirms the underlying data exists before trusting the wiring below --
  // this isn't something TrackFleet computes itself, it's passed straight
  // through from the provider's own response.
  assert.match(normalize, /address: string;/);
  assert.match(normalize, /address: stringFrom\(record\.address, record\.Address, event\.Address, event\.address\)/);
});

test("the vehicle's address reaches the client instead of being dropped at the API boundary", () => {
  assert.match(sendatrackRoute, /vehicles: snapshot\.vehicles\.map\(\(vehicle\) => \(\{[^}]*address: vehicle\.address/);
});

test("the truck popover shows the vehicle's current address, for both an idle truck and one with an active delivery", () => {
  assert.match(page, /address\?: string/);
  // Idle-truck branch (selectedVehicle).
  assert.match(page, /selectedVehicle\.address && <div className="dl-wide"><dt>\{locale === "fr" \? "Position"/);
  // Active-delivery branch: looked up by the delivery's linked vehicle id,
  // since `selected` is a Delivery, not a live vehicle, and only carries
  // the vehicle's id, not its live telemetry.
  assert.match(page, /integration\.vehicles\.find\(\(vehicle\) => vehicle\.id === selected\.sendatrackVehicleId\)\?\.address && <div className="dl-wide">/);
});
