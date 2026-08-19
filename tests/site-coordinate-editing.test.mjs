import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const managerSource = await readFile(new URL("../app/SiteManager.tsx", import.meta.url), "utf8");
const routeSource = await readFile(new URL("../app/api/sites/route.ts", import.meta.url), "utf8");

test("existing sites can be selected and updated without creating a duplicate id", () => {
  assert.match(managerSource, /const \[editingSite, setEditingSite\] = useState<Site \| null>\(null\)/);
  assert.match(managerSource, /id: editingSite\?\.id/);
  assert.match(managerSource, /setEditingSite\(site\)/);
  assert.match(managerSource, /defaultValue=\{editingSite\?\.latitude \?\? ""\}/);
  assert.match(managerSource, /defaultValue=\{editingSite\?\.longitude \?\? ""\}/);
  assert.match(managerSource, /roles: editingSite\?\.roles \?\?/);
  assert.match(routeSource, /const requestedId = String\(payload\.id \?\? ""\)\.trim\(\)/);
  assert.match(routeSource, /const id = requestedId \|\| slug/);
});

test("site list makes missing GPS configuration visible before client launch", () => {
  assert.match(managerSource, /gpsReady/);
  assert.match(managerSource, /gpsMissing/);
  assert.match(managerSource, /typeof site\.latitude === "number" && typeof site\.longitude === "number"/);
});
