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

test("the Livraison column leads with the friendly registration date/time, with the real TF-id as the secondary reference", () => {
  // The departure-date + origin-country label repeated across most rows
  // (many parcels naturally share a departure day/country), which read as
  // noise rather than a useful identifier -- reported live. Replaced with
  // the registration timestamp, and repetition is now handled by grouping
  // rows under their shared truck instead (see delivery-truck-grouping.test.mjs).
  // The registration date leads (bold/primary) since it reads at a glance
  // and differs row to row even within one truck's group; the real id stays
  // fully visible underneath for tracking-link/support lookups, it's just
  // not the first thing your eye lands on -- same pattern as the vehicle
  // cell (plate secondary to the friendly truck number).
  assert.match(page, /const registeredAtLabel = \(delivery: Delivery\) => delivery\.createdAt/);
  assert.match(page, /<td>\{company\?\.role === "dispatcher" && <input type="checkbox" className="label-select-checkbox".*?<strong>\{registeredAtLabel\(delivery\)\}<\/strong><span>\{delivery\.id\}<\/span>\{delivery\.shipmentId/);
  assert.doesNotMatch(page, /deliveryDisplayLabel/);
});

test("the recipient name folds into the Client cell as a secondary line instead of its own always-visible Destinataire column", () => {
  // See delivery-contact-popover.test.mjs for the click-to-reveal behavior
  // itself -- both phone numbers used to always render as visible text in
  // this column, which the client column never showed at all. The
  // Destinataire column was also empty ("—") on most rows, wasting width
  // and squeezing the Journey column -- reported live. Only rendered when
  // there actually is a recipient name, instead of always showing "—".
  assert.doesNotMatch(page, /\{locale === "fr" \? "Destinataire" : locale === "nl" \? "Ontvanger" : "Recipient"\}/);
  assert.match(page, /\{delivery\.recipientName && <div className="recipient-line">/);
  assert.match(page, /<span>→ \{delivery\.recipientName\}<\/span>/);
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
  assert.match(page, /<td className="col-actions">\{company\?\.role === "dispatcher"/);
  assert.match(page, /<button className="more-button" title=\{t\.copyTrackingFor\(delivery\.id\)\}/);
});
