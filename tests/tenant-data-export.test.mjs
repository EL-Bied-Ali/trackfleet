import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { sanitizeDeliveryForExport } from "../app/lib/tenant-data-export.ts";

const routeUrl = new URL("../app/api/operations/export/route.ts", import.meta.url);

function delivery() {
  return {
    id: "delivery-1",
    customer: "Client",
    originSiteId: null,
    originLatitude: null,
    originLongitude: null,
    destinationSiteId: null,
    destination: "Rabat",
    destinationLatitude: null,
    destinationLongitude: null,
    arrivalRadiusKm: 0.5,
    truck: "TRUCK-1",
    driver: "Driver",
    status: "Loading",
    eta: "",
    plannedArrivalAt: null,
    progress: 0,
    color: "#000000",
    contact: "+212600000000",
    whatsappOptIn: false,
    whatsappOptInAt: null,
    sendatrackVehicleId: "",
    latitude: null,
    longitude: null,
    speed: null,
    lastPositionAt: null,
    gpsSource: "simulation",
    companyId: "company-a",
    trackingToken: "SECRET_PUBLIC_LINK_TOKEN",
    tripId: null,
    createdAt: new Date("2026-08-19T12:00:00Z"),
  };
}

test("tenant export strips public tracking bearer tokens", () => {
  const safe = sanitizeDeliveryForExport(delivery());
  assert.equal("trackingToken" in safe, false);
  assert.equal(safe.contact, "+212600000000");
  assert.equal(safe.companyId, "company-a");
});

test("export endpoint is authenticated and scopes every primary read to the session company", async () => {
  const source = await readFile(routeUrl, "utf8");
  assert.match(source, /getDispatcherSession\(request\)/);
  assert.match(source, /status: 401/);
  assert.match(source, /store\.listForCompany\(session\.companyId\)/);
  assert.match(source, /siteStore\.listForCompany\(session\.companyId\)/);
  assert.match(source, /store\.listTrips\(session\.companyId/);
  assert.match(source, /store\.listEvents\(delivery\.id\)/);
});

test("export is an uncached attachment and never touches session credentials", async () => {
  const source = await readFile(routeUrl, "utf8");
  assert.match(source, /content-disposition/);
  assert.match(source, /trackfleet-export-/);
  assert.match(source, /cache-control": "no-store"/);
  assert.doesNotMatch(source, /session\.credentials/);
  assert.doesNotMatch(source, /SENDATRACK_PASSWORD/);
  assert.doesNotMatch(source, /credentialsCiphertext/);
});
