import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// User request: "faudrai aussi que le hub indique pas seulement la date de
// scan mais aussi la localisation si possible". A hub scan is normally
// done from a dispatcher-paired phone (no fixed siteId), so the existing
// locationLabel logic (agency role only) always left it null there --
// only an agency's own scan ever got a location. Only the two GPS-tracked
// hubs (Casablanca, Tanger Med) carry real coordinates, so the truck's own
// live position at scan time is enough to name the hub automatically, with
// no new UI on the scanning phone.
//
// Follow-up request the same day: "le scan au chargé et au hub [devrait]
// donne[r] aussi la localisation... le scanner devra demander la loca aussi
// sur le tel" -- the scanning phone's own position (best-effort, silent if
// denied) is now tried FIRST, since it's a more direct proof of where the
// scan itself happened than the separately-tracked truck. Falls back to the
// truck-GPS-based label above if the phone didn't grant location or isn't
// near a known site -- see qr-scan-frontend.test.mjs for the client-side
// capture.
const route = await readFile(new URL("../app/api/scan/route.ts", import.meta.url), "utf8");

test("derives the hub scan's location from the scanning phone's own position when available, falling back to the delivery's own GPS position, when the scanning session has no fixed site", () => {
  assert.match(route, /const HUB_MATCH_RADIUS_KM = 5;/);
  assert.match(route, /async function nearestGeocodedSiteLabel\(companyId: string, position:/);
  assert.match(route, /const locationLabel = session\.role === "agency"\s*\n\s*\? knownSite\(session\.siteId\)\?\.label \?\? null\s*\n\s*: \(phonePosition && await nearestGeocodedSiteLabel\(session\.companyId, phonePosition\)\)\s*\n\s*\?\? await nearestGeocodedSiteLabel\(session\.companyId, \{ latitude: delivery\.latitude, longitude: delivery\.longitude \}\);/);
});

test("the phone position is parsed defensively -- non-finite or out-of-range coordinates are treated as absent, never passed through to the site-distance lookup", () => {
  assert.match(route, /const phoneLatitude = Number\(payload\.latitude\);/);
  assert.match(route, /const phoneLongitude = Number\(payload\.longitude\);/);
  assert.match(route, /const phonePosition = Number\.isFinite\(phoneLatitude\) && Number\.isFinite\(phoneLongitude\)\s*\n\s*&& phoneLatitude >= -90 && phoneLatitude <= 90 && phoneLongitude >= -180 && phoneLongitude <= 180\s*\n\s*\? \{ latitude: phoneLatitude, longitude: phoneLongitude \}\s*\n\s*: null;/);
});

test("only matches within a tight radius, so a stale or off-grid position never mislabels the scan with a confident-looking but wrong hub", () => {
  assert.match(route, /closest && closest\.distanceKm <= HUB_MATCH_RADIUS_KM \? closest\.label : null/);
});

test("still uses the agency's own known site for an agency-role scan, unchanged", () => {
  assert.match(route, /session\.role === "agency"\s*\n\s*\? knownSite\(session\.siteId\)\?\.label \?\? null/);
});
