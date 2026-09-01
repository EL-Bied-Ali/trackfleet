import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

test("a non-uniform group's per-row journey cell now shows the delivery's own destination city, not just its status/progress/ETA -- previously the destination was never shown per row at all, only hoisted in the group header when every parcel shared one", () => {
  assert.match(page, /<td className="col-destination">\{!group\.uniformDestination && <span className="journey-destination"><i className="destination-dot" style=\{\{ background: destinationColor\(delivery\.destination\) \}\} \/>\{knownSites\.find\(\(site\) => site\.id === delivery\.destinationSiteId\)\?\.city \?\? delivery\.destination\}/);
});

test("a relay-limited destination (e.g. Tétouan, Salé) shows a \"Relais CTM\" badge inline, both per row and in the hoisted group header -- previously this note only ever appeared in the selected-delivery detail popover, never in the table itself", () => {
  const occurrences = page.match(/staticKnownSite\((?:delivery|group\.uniformDestination)\.destinationSiteId\)\?\.finalLegTrackingUnavailable && <b className="relay-badge">/g) ?? [];
  assert.equal(occurrences.length, 2, "expected the relay badge on both the per-row destination and the hoisted group-header destination");
});

test("each city's arrival checkmark and its own destination cells share the exact same color, keyed off the same raw destination string, without any hover needed to match them", () => {
  // Regression: with several destinations on one truck, the per-city arrival
  // checkmarks were all plain, unlabeled "✓" buttons -- a dispatcher had to
  // hover each one and read its tooltip to find the city a parcel arrived
  // at. destinationColor() gives a stable color per destination string, used
  // both on the checkmark button and next to the city name in each row.
  assert.match(page, /function destinationColor\(destination: string\) \{/);
  assert.match(page, /destinationColor\(subgroup\.destination\)/, "the arrival checkmark button must be colored by the same destination key its subgroup groups by");
  assert.match(page, /destinationColor\(delivery\.destination\)/, "the per-row destination dot must use the delivery's own raw destination, matching the subgroup key exactly");
  assert.match(page, /className="more-button destination-arrival-button"/);
});
