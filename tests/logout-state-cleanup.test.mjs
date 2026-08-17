import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const start = page.indexOf("async function logout()");
const end = page.indexOf("async function linkSelectedVehicle", start);
const logout = page.slice(start, end);

test("logout clears tenant-scoped dashboard state", () => {
  for (const statement of [
    "setDeliveries([])",
    "setStopPlans([])",
    "setTrips([])",
    "setRouteHistory([])",
    "setDeliveryEvents([])",
    "setKnownSites([])",
    "setIntegration({ configured: false, connected: false, vehicleCount: 0, error: null, vehicles: [] })",
  ]) assert.ok(logout.includes(statement), statement);
});
