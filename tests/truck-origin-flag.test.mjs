import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const map = fs.readFileSync("app/InteractiveFleetMap.tsx", "utf8");
const page = fs.readFileSync("app/page.tsx", "utf8");
const globalsCss = fs.readFileSync("app/globals.css", "utf8");

test("a truck marker shows a flag badge for the cargo's origin country when known", () => {
  assert.match(map, /originCountry\?: "BE" \| "MA" \| null;/);
  assert.match(map, /const originCountryFlag: Record<"BE" \| "MA", string> = \{ BE: "🇧🇪", MA: "🇲🇦" \};/);
  assert.match(map, /class="truck-origin-flag"/);
  // Falls back to no badge, not a broken/empty one, when the origin isn't known.
  assert.match(map, /const originFlag = delivery\.originCountry \? originCountryFlag\[delivery\.originCountry\] : null;/);
  assert.match(map, /\$\{originFlag \? `<span class="truck-origin-flag" aria-hidden="true">\$\{originFlag\}<\/span>` : ""\}/);
});

test("the flag badge has CSS so it renders as a corner badge, not inline text", () => {
  assert.match(globalsCss, /\.truck-origin-flag \{ position: absolute;/);
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
