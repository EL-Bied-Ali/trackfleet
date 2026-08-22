import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const map = fs.readFileSync("app/InteractiveFleetMap.tsx", "utf8");
const page = fs.readFileSync("app/page.tsx", "utf8");
const globalsCss = fs.readFileSync("app/globals.css", "utf8");

test("a truck marker is colored for the cargo's origin country when known, not badged with a flag emoji", () => {
  // Regression guard: an earlier version used a flag-emoji badge
  // (regional-indicator glyphs), which render as blank/tofu on Windows in
  // most browsers instead of an actual flag picture -- reproduced live as
  // empty circles next to the truck marker. Coloring the marker itself with
  // plain CSS works everywhere, since it isn't font-dependent.
  assert.match(map, /originCountry\?: "BE" \| "MA" \| null;/);
  assert.equal(map.includes("originCountryFlag"), false, "the flag-emoji lookup must be gone, not just unused");
  assert.match(map, /const originClass = delivery\.originCountry \? `origin-\$\{delivery\.originCountry\.toLowerCase\(\)\}` : "";/);
  assert.match(map, /button\.className = `maplibre-truck \$\{originClass\} \$\{delivery\.id === selectedId \? "selected" : ""\}`;/);
  // The accessible label still communicates origin even though nothing is
  // rendered as text/emoji in the marker itself.
  assert.match(map, /const originLabel = delivery\.originCountry \? ` · from \$\{originCountryLabel\[delivery\.originCountry\]\}` : "";/);
});

test("origin-country marker colors are defined in CSS and the selected state always wins over them", () => {
  assert.match(globalsCss, /\.maplibre-truck\.origin-ma \{ background: #c1272d; \}/);
  assert.match(globalsCss, /\.maplibre-truck\.origin-be \{ background: linear-gradient\(/);
  // A selected truck must always show the selection color regardless of
  // origin, even though both are single-class selectors of equal
  // specificity -- !important is the deliberate, narrow guarantee of that.
  assert.match(globalsCss, /\.maplibre-truck\.selected \{ background: #e29a34 !important;/);
});

test("origin country is resolved and passed only to the dispatcher's live fleet map, not the customer map", () => {
  // originSiteId isn't in the public tracking allowlist (public-delivery-view.ts
  // omits it by construction), so it can't reach the customer view -- and
  // showing a customer where their own parcel's own cargo run started isn't
  // something this feature is trying to expose there anyway.
  assert.match(page, /const mapDeliveriesWithOrigin = mapDeliveries\.map\(\(delivery\) => \(\{/);
  assert.match(page, /originCountry: knownSites\.find\(\(site\) => site\.id === delivery\.originSiteId\)\?\.country \?\? null,/);
  assert.match(page, /<InteractiveFleetMap deliveries=\{mapDeliveriesWithOrigin\}/);
  // The customer-facing map call must still use the plain deliveries array.
  assert.match(page, /<InteractiveFleetMap deliveries=\{deliveries\} selectedId=\{selectedId\} customerMode/);
});

test("clicking empty map area closes the truck info popover, not just its own close button", () => {
  // Regression guard: the popover previously only closed via its explicit X
  // button. onBackgroundClick is meant to fire only for clicks on empty map
  // area, which is exactly when an open popover should dismiss.
  assert.match(map, /onBackgroundClick\?: \(\) => void;/);
  assert.match(map, /map\.on\("click", \(event\) => \{/);
  assert.match(page, /onBackgroundClick=\{\(\) => setShowPopover\(false\)\}/);
});

test("clicking a truck marker does not also trigger the background-click handler on the same click", () => {
  // Regression guard, reproduced live immediately after the fix above
  // shipped: truck marker elements are DOM descendants of the map's own
  // container (siblings of the canvas, not outside it), so a click on one
  // still bubbles up into the map's click listener. Without excluding
  // marker clicks, selecting a truck opened its popover via onSelect and
  // the very same click then closed it again via onBackgroundClick --
  // the popover appeared to never show up at all.
  const clickHandler = map.slice(map.indexOf('map.on("click", (event) => {'));
  const handlerBody = clickHandler.slice(0, clickHandler.indexOf("});") + 3);
  assert.match(handlerBody, /const target = event\.originalEvent\?\.target as HTMLElement \| null;/);
  assert.match(handlerBody, /if \(target\?\.closest\("\.maplibre-truck"\)\) return;/);
});
