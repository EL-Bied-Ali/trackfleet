import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const files = Object.fromEntries(await Promise.all([
  "app/api/deliveries/route.ts",
  "app/lib/automation-delay.ts",
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
  assert.match(files["app/page.tsx"], /etaExplanation\(\{ source: selected\.etaSource, confidence: selected\.etaConfidence, historyTrips: selected\.etaHistoryTrips, finalLegTrackingUnavailable: staticKnownSite\(selected\.destinationSiteId\)\?\.finalLegTrackingUnavailable === true \}/);
});
