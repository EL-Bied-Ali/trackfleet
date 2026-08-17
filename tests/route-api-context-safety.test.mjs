import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../app/api/deliveries/route.ts", import.meta.url), "utf8");

test("public tracking never references the authenticated stable context cache", () => {
  const publicStart = source.indexOf("if (tracking) {");
  const authStart = source.indexOf("const session = await getCompanySession(request);");
  assert.ok(publicStart >= 0 && authStart > publicStart);
  const publicBranch = source.slice(publicStart, authStart);
  assert.equal(publicBranch.includes("stableContexts.set("), false);
});

test("authenticated enrichment records stable contexts and returns trip instance ids", () => {
  assert.match(source, /stableContexts\.set\(row\.id, routeContext\)/);
  assert.match(source, /tripInstanceId: currentTripInstanceId/);
});
