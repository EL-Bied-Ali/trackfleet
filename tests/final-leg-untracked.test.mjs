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
  assert.match(files["app/page.tsx"], /customerEtaNote\(\{[\s\S]{0,200}finalLegTrackingUnavailable: staticKnownSite\(selected\.destinationSiteId\)\?\.finalLegTrackingUnavailable === true/);
  assert.match(files["app/page.tsx"], /etaExplanation\(\{ source: selected\.etaSource, confidence: selected\.etaConfidence, historyTrips: selected\.etaHistoryTrips, finalLegTrackingUnavailable: staticKnownSite\(selected\.destinationSiteId\)\?\.finalLegTrackingUnavailable === true/);
});

test("all three delivery-enrichment call sites (list, public tracking, and just-created) thread a manual-arrival duration estimate through", () => {
  const route = files["app/api/deliveries/route.ts"];
  assert.match(route, /import \{ getManualArrivalDurationEstimates, type ManualArrivalDurationEstimate \} from "\.\.\/\.\.\/lib\/manual-arrival-duration\.postgres";/);
  assert.match(route, /getManualArrivalDurationEstimates\(session\.companyId\)/);
  assert.match(route, /getManualArrivalDurationEstimates\(row\.companyId\)/);
  assert.match(route, /manualArrivalEstimateHours: manualArrivalEstimate\?\.medianHours \?\? null/);
  assert.match(route, /manualArrivalEstimateSampleCount: manualArrivalEstimate\?\.sampleCount \?\? 0/);
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
