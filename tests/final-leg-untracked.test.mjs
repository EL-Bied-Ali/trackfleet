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
  assert.match(files["app/page.tsx"], /import \{ knownSite as staticKnownSite, suggestShortCodePrefix \} from "\.\/lib\/known-sites";/);
  // The customer page resolves the destination's flag into `relayDestination`
  // (from the static catalog), then combines it with live GPS freshness into
  // `relayInEffect` -- a relay-destined delivery still gets real live GPS for
  // the Brussels-to-hub leg, so this must not be a blanket "this route always
  // relays" switch (see the dynamic-relay test below).
  assert.match(files["app/page.tsx"], /const relayDestination = staticKnownSite\(selected\.destinationSiteId\)\?\.finalLegTrackingUnavailable === true;/);
  assert.match(files["app/page.tsx"], /const relayInEffect = relayDestination && \(hubArrived \|\| \(selected\.positionAgeMinutes != null && !selected\.gpsFresh\)\);/);
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

// Reported live: the headline "estimated arrival" on the customer tracking
// page was showing estimatedArrivalAt, a GPS-based ETA to the confirmed hub
// (route/progress math is capped there for a relay destination -- see
// delivery-progress-destination.ts), not to the parcel's actual destination.
// Once real GPS pace existed this silently won over plannedArrivalAt (the
// destination-aware CTM relay estimate), understating the real arrival date
// by however long the onward relay leg itself takes -- confirmed live on a
// real Tétouan delivery: headline showed an ETA a full week earlier than
// plannedArrivalAt. plannedArrivalAt now wins for any relay destination
// (not gated on relayInEffect -- the hub ETA is never the right headline for
// a relay destination, even while GPS is still fresh on the way there).
test("the customer tracking page's headline ETA prefers plannedArrivalAt over the GPS-based estimatedArrivalAt for any relay destination", () => {
  const page = files["app/page.tsx"];
  assert.match(page, /const displayedEta = relayDestination && selected\.plannedArrivalAt\s*\n\s*\? new Date\(selected\.plannedArrivalAt\)\.toLocaleString\(dateLocale, \{ day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" \}\)\s*\n\s*: selected\.estimatedArrivalAt/);
  // displayedEta must be computed after relayDestination is defined, not
  // before -- it depends on it now.
  const relayDestinationIndex = page.indexOf("const relayDestination = staticKnownSite(selected.destinationSiteId)");
  const displayedEtaIndex = page.indexOf("const displayedEta = relayDestination");
  assert.ok(relayDestinationIndex > -1 && displayedEtaIndex > relayDestinationIndex, "expected relayDestination to be defined before displayedEta uses it");
});

test("a non-relay destination still prefers the real GPS-based estimatedArrivalAt over the static plannedArrivalAt, since it's the more accurate live figure there", () => {
  const page = files["app/page.tsx"];
  assert.match(page, /: selected\.estimatedArrivalAt\s*\n\s*\? new Date\(selected\.estimatedArrivalAt\)\.toLocaleString\(dateLocale, \{ day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" \}\)\s*\n\s*: selected\.plannedArrivalAt/);
});

// Reported live ("est-ce que le tracking inclut la phase CTM ?"): once
// relayInEffect kicks in, the timeline's "active" step still said "Position
// actuelle · X% du trajet effectue" -- implying live GPS tracking that has
// actually stopped, with no mention that CTM has taken over at all. Every
// other relay-aware element on this page (map, stat cards, ETA note) already
// branches on relayInEffect; this was the one spot that didn't.
test("the timeline's active step switches to CTM-relay wording once relayInEffect kicks in, instead of implying live GPS tracking that has actually stopped", () => {
  const page = files["app/page.tsx"];
  assert.match(page, /relayCurrent: "Relais CTM en cours"/);
  assert.match(page, /relayCurrentDetail: "Notre partenaire local achemine le colis vers l.agence"/);
  assert.match(page, /<strong>\{relayInEffect \? copy\.relayCurrent : copy\.current\}<\/strong><span>\{relayInEffect \? copy\.relayCurrentDetail : copy\.currentDetail\(selected\.progress\)\}<\/span>/);
});

// Reported live on a real Tétouan delivery: the truck (a shared fleet
// vehicle) dropped off at the Tanger Med hub and immediately started another
// unrelated run, so its GPS kept reporting fresh positions the whole time --
// staleness never arrived, so relayInEffect never triggered, and the
// customer page kept showing the live map plus "Position actuelle · 99%"
// long after this parcel's truck leg had actually ended.
test("hub arrival (ARRIVED_AT_SITE) forces relay mode immediately, regardless of whether the truck's GPS stays fresh afterward", () => {
  const page = files["app/page.tsx"];
  assert.match(page, /const hubArrived = deliveryEvents\.some\(\(event\) => event\.type === "ARRIVED_AT_SITE"\);/);
  assert.match(page, /relayDestination && \(hubArrived \|\|/);
});

// Companion fix: "Camion arrivé à l'agence" on the ARRIVED_AT_SITE timeline
// step implied the parcel had reached its actual destination agency, when
// for a relay destination it had only reached the hub -- the CTM leg from
// hub to agency hadn't started yet. Reported live alongside the stale-GPS
// issue above ("faudrai que sa soit plus clair que y'a un trajet entre le
// hub et les agences").
test("the ARRIVED_AT_SITE timeline step uses relay-hub wording for a relay destination instead of implying the parcel reached its actual agency", () => {
  const page = files["app/page.tsx"];
  assert.match(page, /arrivedAtRelayHub: "Camion arrivé au point de relais CTM"/);
  assert.match(page, /arrivedAtRelayHub: "Truck arrived at the CTM relay point"/);
  assert.match(page, /arrivedAtRelayHub: "Vrachtwagen aangekomen op het CTM-overslagpunt"/);
  assert.match(page, /<strong>\{event\.type === "ARRIVED_AT_SITE" && relayDestination \? copy\.arrivedAtRelayHub : copy\.events\[event\.type\]\}<\/strong>/);
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
  // confirmArrivalForDelivery (this card's own bespoke, agency-only, no
  // notify, no bypass implementation) was unified onto confirmSingleArrival
  // -- the same standalone single-parcel function the main dashboard
  // popover uses (see arrival-scan-gate.test.mjs).
  assert.doesNotMatch(page, /function confirmAgencyArrival/);
  assert.doesNotMatch(page, /async function confirmArrivalForDelivery/);
  assert.match(page, /confirmSingleArrival\(delivery\.id\)/);
  // Live follow-up request: "il faudrai ajouter un mecanism d'arriver par
  // colis en plus de celui par agence" -- a standalone single-parcel
  // confirm was explicitly re-requested (in addition to, not instead of,
  // the group/truck-level one), reversing the earlier "redundant, removed"
  // call for this exact popover button. It's back on purpose this time,
  // and now notifies + supports an explicit bypass the old one never had.
  assert.match(page, /confirmSingleArrival\(selected\.id\)/);
});
