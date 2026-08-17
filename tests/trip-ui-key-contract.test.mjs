import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

test("active trip cards use trip-aware React keys", () => {
  assert.match(page, /key=\{activeTourKey\(plan\)\}/);
  assert.doesNotMatch(page, /key=\{plan\.vehicleKey\}/);
});
