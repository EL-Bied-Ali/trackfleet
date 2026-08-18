import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { readJsonObject } from "../app/lib/request-json.ts";

const routeUrls = [
  "../app/api/deliveries/assign-trip/route.ts",
  "../app/api/deliveries/create-trip/route.ts",
  "../app/api/deliveries/link-vehicle/route.ts",
  "../app/api/sites/route.ts",
];
const routes = await Promise.all(routeUrls.map((url) => readFile(new URL(url, import.meta.url), "utf8")));

test("safe JSON parser accepts only JSON objects", async () => {
  const objectRequest = new Request("https://trackfleet.example/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deliveryId: "D-1" }),
  });
  assert.deepEqual(await readJsonObject(objectRequest), { deliveryId: "D-1" });

  for (const body of ["{broken", "null", "[]", '"text"']) {
    const request = new Request("https://trackfleet.example/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    assert.equal(await readJsonObject(request), null);
  }
});

test("small authenticated mutation routes reject malformed JSON consistently", () => {
  for (const route of routes) {
    assert.match(route, /readJsonObject\(request\)/);
    assert.match(route, /invalidJsonResponse\(\)/);
    assert.doesNotMatch(route, /const payload = await request\.json\(\)/);
  }
});

test("trip and vehicle mutation identifiers are bounded before storage or provider lookup", () => {
  assert.match(routes[0], /deliveryId\.length > 100/);
  assert.match(routes[0], /tripId\.length > 100/);
  assert.match(routes[1], /deliveryId\.length > 100/);
  assert.match(routes[1], /vehicleId\.length > 160/);
  assert.match(routes[1], /manualTruck\.length > 160/);
  assert.match(routes[2], /deliveryId\.length > 100/);
  assert.match(routes[2], /vehicleId\.length > 160/);
});
