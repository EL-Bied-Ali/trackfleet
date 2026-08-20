import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  agencyBrowserLocationIsAcceptable,
  agencyDeliveryIsVisible,
  agencySiteIdFromUserLabel,
  maximumAgencyLocationAccuracyMeters,
} from "../app/lib/agency-access.ts";
import { knownSites } from "../app/lib/known-sites.ts";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("each known agency receives a distinct restricted identity", () => {
  assert.equal(knownSites.length, 10);
  for (const site of knownSites) assert.equal(agencySiteIdFromUserLabel(`agency:${site.id}`), site.id);
  assert.equal(agencySiteIdFromUserLabel("dispatcher"), null);
  assert.equal(agencySiteIdFromUserLabel("agency:unknown-site"), null);
  assert.equal(agencySiteIdFromUserLabel("agency:"), null);
});

test("browser coordinates must be valid and accurate to at most 100 metres", () => {
  assert.equal(maximumAgencyLocationAccuracyMeters, 100);
  assert.equal(agencyBrowserLocationIsAcceptable({ latitude: 50.8503, longitude: 4.3517, accuracyMeters: 12 }), true);
  assert.equal(agencyBrowserLocationIsAcceptable({ latitude: 33.5731, longitude: -7.5898, accuracyMeters: 100 }), true);
  assert.equal(agencyBrowserLocationIsAcceptable({ latitude: 33.5731, longitude: -7.5898, accuracyMeters: 100.01 }), false);
  assert.equal(agencyBrowserLocationIsAcceptable({ latitude: 91, longitude: 4, accuracyMeters: 5 }), false);
  assert.equal(agencyBrowserLocationIsAcceptable({ latitude: 45, longitude: 181, accuracyMeters: 5 }), false);
  assert.equal(agencyBrowserLocationIsAcceptable({ latitude: Number.NaN, longitude: 4, accuracyMeters: 5 }), false);
  assert.equal(agencyBrowserLocationIsAcceptable({ latitude: 45, longitude: 4, accuracyMeters: 0 }), false);
});

test("agency parcel visibility includes parcels sent from or arriving at that agency only", () => {
  assert.equal(agencyDeliveryIsVisible({ originSiteId: "agency-a", destinationSiteId: "agency-b" }, "agency-a"), true);
  assert.equal(agencyDeliveryIsVisible({ originSiteId: "agency-a", destinationSiteId: "agency-b" }, "agency-b"), true);
  assert.equal(agencyDeliveryIsVisible({ originSiteId: "agency-a", destinationSiteId: "agency-b" }, "agency-c"), false);
});

test("agency enrollment is same-origin, signed, short-lived, and keeps its token out of the request URL", async () => {
  const [route, auth, enrollmentPage] = await Promise.all([
    read("../app/api/auth/agency-enrollment/route.ts"),
    read("../app/lib/company-auth.ts"),
    read("../app/agency/enroll/page.tsx"),
  ]);
  assert.match(route, /requestIsSameOrigin\(request\)/);
  assert.match(route, /getDispatcherSession\(request\)/);
  assert.match(route, /url\.hash = `token=/);
  assert.match(route, /expiresInMinutes: 30/);
  assert.match(auth, /HMAC/);
  assert.match(auth, /agencyEnrollmentDurationMs = 30 \* 60 \* 1000/);
  assert.match(auth, /payload\.expiresAt < Date\.now\(\)/);
  assert.match(auth, /HttpOnly; Secure; SameSite=Lax/);
  assert.match(enrollmentPage, /window\.location\.hash/);
  assert.match(enrollmentPage, /history\.replaceState/);
});

test("an agency can list the network but can update only its measured site coordinates", async () => {
  const route = await read("../app/api/sites/route.ts");
  assert.match(route, /session\.role === "agency"/);
  assert.match(route, /companySites\.map\(siteJson\)/);
  assert.match(route, /requestedId !== session\.siteId/);
  assert.match(route, /payload\.coordinateSource !== "browser"/);
  assert.match(route, /agencyBrowserLocationIsAcceptable/);
  assert.match(route, /siteStore\.upsert\(\{\s*\.\.\.site,\s*latitude,\s*longitude,/s);
});

test("agency location capture requests high accuracy, shows a map, and requires human confirmation", async () => {
  const ui = await read("../app/AgencyLocationSetup.tsx");
  assert.match(ui, /geolocation\.watchPosition/);
  assert.match(ui, /enableHighAccuracy: true/);
  assert.match(ui, /maximumAgencyLocationAccuracyMeters/);
  assert.match(ui, /openstreetmap\.org\/export\/embed\.html/);
  assert.match(ui, /window\.confirm\(copy\.warning\)/);
  assert.match(ui, /coordinateSource: "browser"/);
});

test("agency sessions can use parcel, fleet, and arrival APIs while administration remains dispatcher-only", async () => {
  const [deliveries, sendatrack, completion, history] = await Promise.all([
    read("../app/api/deliveries/route.ts"),
    read("../app/api/sendatrack/route.ts"),
    read("../app/api/deliveries/manual-completion/route.ts"),
    read("../app/api/operations/history/route.ts"),
  ]);
  assert.match(deliveries, /getCompanySession\(request\)/);
  assert.match(deliveries, /agencyDeliveryIsVisible/);
  assert.match(deliveries, /session\.role === "agency" \? session\.siteId/);
  assert.match(deliveries, /session\.role === "agency" && !agencyDeliveryIsVisible\(existing, session\.siteId\)/);
  assert.match(sendatrack, /getCompanySession\(request\)/);
  assert.match(completion, /delivery\.destinationSiteId !== session\.siteId/);
  assert.match(completion, /dispatcher_confirmation_required/);
  assert.match(history, /getCompanySession\(request\)/);
  assert.match(history, /session\.role === "agency" \? session\.siteId : null/);

  const dispatcherOnlyRoutes = [
    "../app/api/whatsapp/route.ts",
    "../app/api/whatsapp/preview/route.ts",
    "../app/api/fleet/history/route.ts",
    "../app/api/whatsapp/readiness/route.ts",
    "../app/api/whatsapp/preflight/route.ts",
    "../app/api/deliveries/create-trip/route.ts",
    "../app/api/deliveries/assign-trip/route.ts",
    "../app/api/deliveries/whatsapp-consent/route.ts",
    "../app/api/deliveries/link-vehicle/route.ts",
    "../app/api/operations/export/route.ts",
    "../app/api/operations/storage/route.ts",
  ];
  for (const path of dispatcherOnlyRoutes) {
    const source = await read(path);
    assert.match(source, /getDispatcherSession\(request\)/, `${path} must require a dispatcher session`);
    assert.doesNotMatch(source, /getCompanySession/, `${path} must not accept an agency session`);
  }
});
