import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync("app/page.tsx", "utf8");
const css = fs.readFileSync("app/globals.css", "utf8");

test("the deliveries table has a search box that filters by customer, recipient and both phone numbers", () => {
  assert.match(page, /const \[searchQuery, setSearchQuery\] = useState\(""\);/);
  assert.match(page, /className="table-search"/);
  assert.match(page, /\.some\(\(field\) => field && field\.toLowerCase\(\)\.replace\(\/\[\^a-z0-9\]\/g, ""\)\.includes\(query\)\)/);
  assert.match(page, /\[delivery\.id, delivery\.customer, delivery\.recipientName, delivery\.contact, delivery\.recipientContact, delivery\.destination\]/);
});

test("a friendly display label (departure date + origin country) sits alongside the real TF-id, which stays the actual key everywhere", () => {
  // The real id must never be replaced -- it's still the tracking-link key,
  // the database primary key and what support looks records up by. This
  // label is purely a readable hint shown next to it.
  assert.match(page, /const deliveryDisplayLabel = \(delivery: Delivery\) => \{/);
  assert.match(page, /delivery\.nextTruckDepartureAt \?\? delivery\.plannedArrivalAt/);
  assert.match(page, /<td><strong>\{deliveryDisplayLabel\(delivery\)\}<\/strong><span>\{delivery\.id\}<\/span><\/td>/);
});

test("the table shows a Destinataire column with the recipient name and both phone numbers", () => {
  assert.match(page, /\{locale === "fr" \? "Destinataire" : locale === "nl" \? "Ontvanger" : "Recipient"\}/);
  assert.match(page, /<td><strong>\{delivery\.recipientName \|\| "—"\}<\/strong><span>\{\[delivery\.contact, delivery\.recipientContact\]\.filter\(Boolean\)\.join\(" · "\) \|\| "—"\}<\/span><\/td>/);
});

test("mobile card layout hides the actions column via a stable class, not a positional nth-child index", () => {
  // Regression guard: nth-child(7) assumed a fixed column count/order. The
  // dispatcher's Agence column (added separately) already made this wrong
  // for that role -- nth-child(7) hit Progression instead of Actions,
  // hiding the wrong thing on mobile. Adding Destinataire here would have
  // made it wrong for agency too. A class on the actual actions cell is
  // correct regardless of how many conditional columns exist per role.
  assert.doesNotMatch(css, /td:nth-child\(7\) \{ display: none; \}/);
  assert.match(css, /\.col-actions \{ display: none; \}/);
  assert.match(page, /<th className="col-actions"><span className="sr-only">/);
  assert.match(page, /<td className="col-actions"><button className="more-button"/);
});
