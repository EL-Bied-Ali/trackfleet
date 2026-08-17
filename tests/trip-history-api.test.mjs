import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const route = fs.readFileSync(new URL("../app/api/deliveries/route.ts", import.meta.url), "utf8");
const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

test("dashboard trip history omits tenant id and keeps completed trips visible", () => {
  assert.match(route, /trips: tripHistory/);
  assert.doesNotMatch(route, /companyId: trip\.companyId,[\s\S]{0,250}trips: tripHistory/);
  assert.match(page, /trip\.status === "completed"/);
  assert.match(page, /Voyages récents/);
});
