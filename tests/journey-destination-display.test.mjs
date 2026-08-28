import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

test("a non-uniform group's per-row journey cell now shows the delivery's own destination city, not just its status/progress/ETA -- previously the destination was never shown per row at all, only hoisted in the group header when every parcel shared one", () => {
  assert.match(page, /<td className="col-journey">\{!group\.uniformDestination && <span className="journey-destination">\{knownSites\.find\(\(site\) => site\.id === delivery\.destinationSiteId\)\?\.city \?\? delivery\.destination\}/);
});

test("a relay-limited destination (e.g. Tétouan, Salé) shows a \"Relais CTM\" badge inline, both per row and in the hoisted group header -- previously this note only ever appeared in the selected-delivery detail popover, never in the table itself", () => {
  const occurrences = page.match(/staticKnownSite\((?:delivery|group\.uniformDestination)\.destinationSiteId\)\?\.finalLegTrackingUnavailable && <b className="relay-badge">/g) ?? [];
  assert.equal(occurrences.length, 2, "expected the relay badge on both the per-row destination and the hoisted group-header destination");
});
