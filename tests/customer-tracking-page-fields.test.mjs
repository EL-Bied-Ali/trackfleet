import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync("app/page.tsx", "utf8");

// Product decision (2026-08-27): the raw GPS speed (km/h) stat card was
// removed from the customer tracking page -- a technical number that means
// nothing to a customer, and the status text underneath it duplicated what
// the page's headline already states prominently (see customerStatus in
// i18n.ts, e.g. "Votre livraison a du retard"). Progress/remaining
// distance/GPS freshness stay: those are genuinely useful trust signals.
test("the customer tracking page does not show a raw GPS speed number -- it's noise, and the status text under it duplicated the page's own headline", () => {
  assert.doesNotMatch(page, /speed: "Vitesse GPS"/);
  assert.doesNotMatch(page, /speed: "GPS speed"/);
  assert.doesNotMatch(page, /speed: "GPS-snelheid"/);
  assert.doesNotMatch(page, /\{copy\.speed\}/);
  assert.doesNotMatch(page, /selected\.speed == null \? "—" : `\$\{Math\.round\(selected\.speed\)\} km\/h`/);
});

test("the customer tracking page still shows progress, remaining distance, and GPS freshness -- those stay useful", () => {
  assert.match(page, /\{copy\.progress\}/);
  assert.match(page, /\{copy\.remaining\}/);
  assert.match(page, /\{copy\.gps\}/);
});
