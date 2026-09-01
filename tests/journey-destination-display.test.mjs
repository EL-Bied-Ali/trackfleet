import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

test("a non-uniform group's per-row journey cell now shows the delivery's own destination city, not just its status/progress/ETA -- previously the destination was never shown per row at all, only hoisted in the group header when every parcel shared one", () => {
  assert.match(page, /<td className="col-destination">\{!group\.uniformDestination && <span className="journey-destination"><i className="destination-dot" style=\{\{ background: destinationColors\.get\(delivery\.destination\) \?\? truckBadgeColors\[0\] \}\} \/>\{knownSites\.find\(\(site\) => site\.id === delivery\.destinationSiteId\)\?\.city \?\? delivery\.destination\}/);
});

test("a relay-limited destination (e.g. Tétouan, Salé) shows a \"Relais CTM\" badge inline, both per row and in the hoisted group header -- previously this note only ever appeared in the selected-delivery detail popover, never in the table itself", () => {
  const occurrences = page.match(/staticKnownSite\((?:delivery|group\.uniformDestination)\.destinationSiteId\)\?\.finalLegTrackingUnavailable && <b className="relay-badge">/g) ?? [];
  assert.equal(occurrences.length, 2, "expected the relay badge on both the per-row destination and the hoisted group-header destination");
});

test("each city's arrival checkmark and its own destination cells share the exact same color, keyed off the same raw destination string, without any hover needed to match them", () => {
  // Regression: with several destinations on one truck, the per-city arrival
  // checkmarks were all plain, unlabeled "✓" buttons -- a dispatcher had to
  // hover each one and read its tooltip to find the city a parcel arrived
  // at. destinationColors gives a stable color per destination string, used
  // both on the checkmark button and next to the city name in each row.
  assert.match(page, /destinationColors\.get\(subgroup\.destination\)/, "the arrival checkmark button must be colored by the same destination key its subgroup groups by");
  assert.match(page, /destinationColors\.get\(delivery\.destination\)/, "the per-row destination dot must use the delivery's own raw destination, matching the subgroup key exactly");
  assert.match(page, /className="more-button destination-arrival-button"/);
});

test("destination colors are assigned by index over every distinct destination on screen, not hashed independently per string", () => {
  // Regression: an independent per-string hash into a 10-color palette
  // collides far more often than it looks like it should -- with only 5
  // destinations visible at once, there's already a ~70% chance two of them
  // land on the same color by pure chance (birthday-paradox math). Reported
  // live: Khouribga and Tanger Med rendered as the same shade of pink.
  // Indexing over the sorted set of distinct destinations currently on
  // screen guarantees every one gets its own color as long as there are no
  // more distinct destinations on screen than palette colors (10).
  assert.match(page, /const destinationColors = useMemo\(\(\) => \{/);
  assert.match(page, /const distinct = Array\.from\(new Set\(visibleDeliveries\.map\(\(delivery\) => delivery\.destination\)\)\)\.sort\(\);/);
  assert.match(page, /return new Map\(distinct\.map\(\(destination, index\) => \[destination, truckBadgeColors\[index % truckBadgeColors\.length\]\]\)\);/);
  assert.doesNotMatch(page, /function destinationColor\(destination: string\)/, "the old per-string hash function must be fully removed, not left dead alongside the new index-based map");
});
