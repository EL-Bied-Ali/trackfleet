import assert from "node:assert/strict";
import test from "node:test";
import { routeSignature, routeTemplateId } from "../app/lib/route-template.ts";

test("same ordered route always gets the same reusable route id", () => {
  const first = routeTemplateId("brussels-abattoir-45", ["ma-tanger-ville", "ma-casablanca", "ma-agadir"]);
  const second = routeTemplateId("brussels-abattoir-45", ["ma-tanger-ville", "ma-casablanca", "ma-agadir"]);
  assert.equal(first, second);
  assert.match(first, /^ROUTE-[A-Z0-9]{6}$/);
});

test("route id does not depend on truck or trip date", () => {
  assert.equal(
    routeSignature("brussels-abattoir-45", ["ma-tanger-ville", "ma-casablanca"]),
    "brussels-abattoir-45>ma-tanger-ville>ma-casablanca",
  );
});

test("changing stop order produces a different route template", () => {
  const a = routeTemplateId("brussels-abattoir-45", ["ma-tanger-ville", "ma-casablanca"]);
  const b = routeTemplateId("brussels-abattoir-45", ["ma-casablanca", "ma-tanger-ville"]);
  assert.notEqual(a, b);
});
