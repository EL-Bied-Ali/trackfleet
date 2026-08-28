import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const files = Object.fromEntries(await Promise.all([
  "app/api/deliveries/route.ts",
  "app/lib/automation-delay.ts",
  "app/lib/public-delivery-view.ts",
  "app/page.tsx",
].map(async (path) => [path, await readFile(new URL(`../${path}`, import.meta.url), "utf8")])));

test("both delay-detection call sites (interactive request and the autonomous tick) resolve the destination site's untracked-final-leg flag", () => {
  assert.match(files["app/api/deliveries/route.ts"], /finalLegTrackingUnavailable: knownSite\(row\.destinationSiteId\)\?\.finalLegTrackingUnavailable === true/);
  assert.match(files["app/lib/automation-delay.ts"], /finalLegTrackingUnavailable: knownSite\(row\.destinationSiteId\)\?\.finalLegTrackingUnavailable === true/);
});

test("both customer and dispatcher ETA displays resolve the untracked-final-leg flag from the static site catalog, not the per-company /api/sites list", () => {
  // The per-company `sites` DB table (what dynamic `knownSites` state holds,
  // fetched from /api/sites) has no column for this -- it's a hardcoded
  // business fact about the static catalog in known-sites.ts, not editable
  // per-company data, so it must be resolved via staticKnownSite(id), not
  // the dynamic `destinationSite` lookup.
  assert.match(files["app/page.tsx"], /import \{ knownSite as staticKnownSite \} from "\.\/lib\/known-sites";/);
  // The customer page resolves the destination's flag into `relayDestination`
  // (from the static catalog), then combines it with live GPS freshness into
  // `relayInEffect` -- a relay-destined delivery still gets real live GPS for
  // the Brussels-to-hub leg, so this must not be a blanket "this route always
  // relays" switch (see the dynamic-relay test below).
  assert.match(files["app/page.tsx"], /const relayDestination = staticKnownSite\(selected\.destinationSiteId\)\?\.finalLegTrackingUnavailable === true;/);
  assert.match(files["app/page.tsx"], /const relayInEffect = relayDestination && selected\.positionAgeMinutes != null && !selected\.gpsFresh;/);
  assert.match(files["app/page.tsx"], /customerEtaNote\(\{[\s\S]{0,200}finalLegTrackingUnavailable: relayInEffect,/);
  assert.match(files["app/page.tsx"], /etaExplanation\(\{ source: selected\.etaSource, confidence: selected\.etaConfidence, historyTrips: selected\.etaHistoryTrips, finalLegTrackingUnavailable: staticKnownSite\(selected\.destinationSiteId\)\?\.finalLegTrackingUnavailable === true/);
});

test("the customer tracking page replaces the live map and GPS stat cards with a CTM relay notice once the destination is past the confirmed hub", () => {
  // Recommended design (confirmed with the client): once relay begins, the
  // map/stats are actively misleading -- a frozen truck marker and a stale
  // "speed: 87 km/h" reading look like live tracking that just stopped
  // working, rather than what's actually happening (a different carrier now
  // has the parcel). Replaced outright rather than shown alongside the CTM
  // note.
  const page = files["app/page.tsx"];
  assert.match(page, /\{!relayInEffect && <div style=\{\{ display: "grid", gridTemplateColumns: "repeat\(auto-fit, minmax\(160px, 1fr\)\)"/);
  assert.match(page, /\{relayInEffect \? <div className="map customer-map relay-notice">/);
  assert.match(page, /<InteractiveFleetMap deliveries=\{deliveries\} selectedId=\{selectedId\} customerMode/);
});

test("a relay-destined delivery still shows the real live map while GPS is fresh (the Brussels-to-hub leg), only switching to the CTM notice once positions go stale", () => {
  // Reported live: the first version toggled the CTM notice purely off the
  // destination (a fixed property of the delivery), which meant a customer
  // shipping to Tétouan saw "CTM has taken over" from the moment the parcel
  // was registered -- even while the truck was still in Belgium. The
  // Brussels-to-hub leg is genuinely GPS-tracked like any other delivery, so
  // this must key off live GPS freshness, not just the destination.
  const page = files["app/page.tsx"];
  assert.match(page, /selected\.positionAgeMinutes != null && !selected\.gpsFresh/);
  // Before any GPS history exists yet (positionAgeMinutes still null -- an
  // unassigned/not-yet-departed delivery), relayInEffect must stay false
  // rather than jumping straight to the relay notice.
  assert.doesNotMatch(page, /relayInEffect = relayDestination;/);
});

test("all three delivery-enrichment call sites (list, public tracking, and just-created) thread a manual-arrival duration estimate through", () => {
  const route = files["app/api/deliveries/route.ts"];
  assert.match(route, /import \{ getManualArrivalDurationEstimates, type ManualArrivalDurationEstimate \} from "\.\.\/\.\.\/lib\/manual-arrival-duration\.postgres";/);
  assert.match(route, /getManualArrivalDurationEstimates\(session\.companyId\)/);
  assert.match(route, /getManualArrivalDurationEstimates\(row\.companyId\)/);
  assert.match(route, /manualArrivalEstimateHours: manualArrivalEstimate\?\.medianHours \?\? null/);
  assert.match(route, /manualArrivalEstimateSampleCount: manualArrivalEstimate\?\.sampleCount \?\? 0/);
});

test("the dispatcher list endpoint skips the manual-arrival estimate query entirely when nothing active needs it", () => {
  // Regression guard, reproduced live: getManualArrivalDurationEstimates
  // joins against a vehicle's entire GPS history and is real CPU-ms work
  // regardless of its own internal caps -- it was being called
  // unconditionally on every dispatcher page load even for a company with
  // zero active deliveries headed to a relay-only site, which is when its
  // result is thrown away unused. A company with everything already
  // Delivered (e.g. right after a cleanup) hit exactly this: the query ran
  // for no reason and the Worker exceeded its CPU time limit.
  const route = files["app/api/deliveries/route.ts"];
  assert.match(route, /const needsManualArrivalEstimates = rows\.some\(\(row\) => row\.status !== "Delivered"\s*\n\s*&& row\.destinationSiteId\s*\n\s*&& knownSite\(row\.destinationSiteId\)\?\.finalLegTrackingUnavailable === true\);/);
  assert.match(route, /needsManualArrivalEstimates \? getManualArrivalDurationEstimates\(session\.companyId\) : Promise\.resolve\(new Map<string, ManualArrivalDurationEstimate>\(\)\)/);
});

test("public tracking exposes destinationSiteId and the manual-arrival estimate so the customer page can render the same note as the dispatcher", () => {
  // Regression guard: the customer-facing finalLegTrackingUnavailable note
  // shipped in an earlier PR silently never fired, because destinationSiteId
  // was missing from the public allow-list that publicDeliveryView builds --
  // page.tsx resolves the flag via selected.destinationSiteId, which was
  // always undefined for a customer viewing their own tracking link.
  const publicView = files["app/lib/public-delivery-view.ts"];
  assert.match(publicView, /destinationSiteId: delivery\.destinationSiteId \?\? null/);
  assert.match(publicView, /manualArrivalEstimateHours: delivery\.manualArrivalEstimateHours \?\? null/);
  assert.match(publicView, /manualArrivalEstimateSampleCount: delivery\.manualArrivalEstimateSampleCount \?\? 0/);
});

test("both ETA displays also pass the manual-arrival estimate fields, not just the boolean flag", () => {
  const page = files["app/page.tsx"];
  assert.match(page, /manualArrivalEstimateHours: selected\.manualArrivalEstimateHours,\s*\n\s*manualArrivalEstimateSampleCount: selected\.manualArrivalEstimateSampleCount,/);
  assert.match(page, /manualArrivalEstimateHours: selected\.manualArrivalEstimateHours, manualArrivalEstimateSampleCount: selected\.manualArrivalEstimateSampleCount \}/);
});

test("an agency scoped to an untracked-final-leg site sees an expected-parcels list instead of the live fleet map", () => {
  // A live truck-tracking map is actively misleading for a destination GPS
  // coverage never reaches -- there's no confirmed vehicle to show, and the
  // relay mechanics (single truck vs handoff) aren't even confirmed yet.
  const page = files["app/page.tsx"];
  assert.match(page, /const agencyMapUnavailable = company\?\.role === "agency" && staticKnownSite\(company\.siteId\)\?\.finalLegTrackingUnavailable === true;/);
  assert.match(page, /const agencyIncomingDeliveries = agencyMapUnavailable\s*\n\s*\? deliveries\.filter\(\(delivery\) => delivery\.destinationSiteId === company\?\.siteId && delivery\.status !== "Delivered"\)/);
  // The live map/roster/truck-popover branch must be skipped entirely when
  // the map is unavailable, not merely visually hidden alongside it.
  assert.match(page, /\{agencyMapUnavailable \? \(/);
  assert.match(page, /!agencyMapUnavailable && showPopover && \(selectedVehicle \|\| deliveries\.length > 0\) && <div className="truck-popover">/);
});

test("each expected-parcel card reuses the same estimate note and arrival-confirmation action as everywhere else, keyed to that specific delivery", () => {
  const page = files["app/page.tsx"];
  assert.match(page, /const note = customerEtaNote\(\{ finalLegTrackingUnavailable: true, manualArrivalEstimateHours: delivery\.manualArrivalEstimateHours, manualArrivalEstimateSampleCount: delivery\.manualArrivalEstimateSampleCount \}, locale\);/);
  assert.match(page, /confirmArrivalForDelivery\(delivery\.id, delivery\.destinationSiteId\)/);
  // The confirm action was generalized from the old selected-only
  // confirmAgencyArrival to work per-row; the popover call site must have
  // moved to the same generalized function, not kept a second copy.
  assert.doesNotMatch(page, /function confirmAgencyArrival/);
  assert.match(page, /async function confirmArrivalForDelivery\(deliveryId: string, destinationSiteId\?: string \| null\)/);
  // The delivery-detail popover's own "Confirmer l'arrivée du camion"
  // button was later removed as redundant -- the delivery table's group
  // header now offers the same confirmation (plus WhatsApp notify) at the
  // truck-group level, so confirmArrivalForDelivery's only remaining
  // caller is this expected-parcel-card list.
  assert.doesNotMatch(page, /confirmArrivalForDelivery\(selected\.id, selected\.destinationSiteId\)/);
});
