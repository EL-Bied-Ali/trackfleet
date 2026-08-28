import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [page, createRoute] = await Promise.all([
  readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/deliveries/route.ts", import.meta.url), "utf8"),
]);

// Requested live, after confirming the old table-editor dates never
// triggered any WhatsApp message: reintroduce a departure date at creation
// (once per shipment submission, not once per parcel, so it doesn't
// reintroduce the original per-parcel redundancy that got both dates
// removed from creation in the first place), with the arrival estimated
// automatically from the destination agency's CTM relay window instead of
// being typed in directly.
test("the creation form has a controlled destination select and departure input feeding a live-computed, read-only arrival estimate", () => {
  assert.match(page, /const \[creationDestinationSiteId, setCreationDestinationSiteId\] = useState\(""\);/);
  assert.match(page, /const \[creationDepartureAt, setCreationDepartureAt\] = useState\(""\);/);
  assert.match(page, /const creationEstimatedArrival = creationDepartureDate && !Number\.isNaN\(creationDepartureDate\.getTime\(\)\)\s*\n\s*\? estimateRelayArrival\(creationDestinationSiteId, creationDepartureDate, departureArrivalEstimates\[creationDestinationSiteId\]\)\s*\n\s*: null;/);
  assert.match(page, /<select name="destinationSiteId" required value=\{creationDestinationSiteId\} onChange=\{\(event\) => setCreationDestinationSiteId\(event\.target\.value\)\}>/);
  assert.match(page, /<input type="datetime-local" name="nextTruckDepartureAt" value=\{creationDepartureAt\} onChange=\{\(event\) => setCreationDepartureAt\(event\.target\.value\)\} \/>/);
});

test("the creation form never lets the dispatcher type an arrival date directly -- only the departure date is submitted, matching how price is never a raw trusted field either", () => {
  const nextTruckDepartureRawIndex = page.indexOf('const nextTruckDepartureRaw = String(form.get("nextTruckDepartureAt")');
  assert.ok(nextTruckDepartureRawIndex > -1, "expected createDelivery to read nextTruckDepartureAt from the form");
  assert.doesNotMatch(page, /form\.get\("plannedArrivalAt"\)/);
});

// Same trusted-server-computation pattern computeDeliveryPrice already uses:
// the client-submitted value (if any) is never trusted outright, the server
// derives its own authoritative figure.
test("POST /api/deliveries derives plannedArrivalAt server-side from the destination's relay window and the submitted departure date, not from a client-submitted arrival date", () => {
  assert.match(createRoute, /import \{ estimateRelayArrival \} from "\.\.\/\.\.\/lib\/relay-eta-estimate";/);
  assert.match(createRoute, /const plannedArrivalAt = estimateRelayArrival\(destinationSiteId, nextTruckDepartureAt, learnedTransitEstimate\) \?\? submittedPlannedArrivalAt;/);
});

// Requested live: the fixed 6d/12d hub windows are a starting point, not the
// final word -- once real deliveries to a specific agency have confirmed
// arrivals, that agency's own actual median duration should win instead.
test("POST /api/deliveries looks up the learned per-agency transit duration for a relay destination and passes it into estimateRelayArrival", () => {
  assert.match(createRoute, /import \{ getDepartureArrivalDurationEstimates \} from "\.\.\/\.\.\/lib\/departure-arrival-duration\.postgres";/);
  assert.match(createRoute, /const learnedTransitEstimate = knownSite\(destinationSiteId\)\?\.finalLegTrackingUnavailable === true\s*\n\s*\? \(await getDepartureArrivalDurationEstimates\(session\.companyId\)\)\.get\(destinationSiteId\) \?\? null\s*\n\s*: null;/);
});

test("the GET /api/deliveries response exposes the learned per-agency estimates so the creation form and schedule editor can preview the real value", () => {
  assert.match(createRoute, /getDepartureArrivalDurationEstimates\(session\.companyId\),/);
  assert.match(createRoute, /departureArrivalEstimates: Object\.fromEntries\(departureArrivalEstimates\),/);
});

// Requested live: the agency should be picked before anything else in the
// form, not buried after the customer/recipient/parcel fields -- both so
// the workflow reads naturally (route first, then who it's for) and so the
// live arrival-estimate preview has a destination to work with as early as
// possible.
test("the origin/destination row is the first thing in the creation form, before the customer and recipient sections", () => {
  const formStart = page.indexOf("onSubmit={createDelivery}>") + "onSubmit={createDelivery}>".length;
  const destinationSelectIndex = page.indexOf('name="destinationSiteId"', formStart);
  const customerSectionIndex = page.indexOf("Expéditeur / client", formStart);
  assert.ok(destinationSelectIndex > -1 && customerSectionIndex > -1, "expected both the destination select and the customer section to be found");
  assert.ok(destinationSelectIndex < customerSectionIndex, "expected the destination select to come before the customer section");
});

test("creation form and edit resets both clear the destination/departure selection so the next delivery starts blank", () => {
  const resetOccurrences = page.match(/setCreationDestinationSiteId\(""\); setCreationDepartureAt\(""\);/g) ?? [];
  assert.ok(resetOccurrences.length >= 1, "expected at least the post-creation success reset");
  assert.match(page, /setModalOpen\(false\); setParcelDrafts\(\[\{ key: "0", weightKg: "", manualPriceAmount: "", itemDescription: "" \}\]\); setCreationDestinationSiteId\(""\); setCreationDepartureAt\(""\);/);
});
