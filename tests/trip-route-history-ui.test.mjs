import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

test("dispatch dashboard consumes and renders completed route history", () => {
  assert.ok(page.includes('const [routeHistory, setRouteHistory] = useState<RouteHistoryItem[]>([]);'));
  assert.ok(page.includes('routeHistory?: RouteHistoryItem[]'));
  assert.ok(page.includes('if (!tracking) setRouteHistory(data.routeHistory ?? []);'));
  assert.ok(page.includes('routeHistory.length > 0'));
  assert.ok(page.includes('Routes fréquentes'));
  assert.ok(page.includes('route.destinations.join(" → ")'));
  assert.ok(page.includes('route.tripCount'));
});
