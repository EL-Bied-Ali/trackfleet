import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { requestIsSameOrigin } from "../app/lib/request-origin.ts";

const mutationRoutes = await Promise.all([
  "../app/api/deliveries/route.ts",
  "../app/api/deliveries/assign-trip/route.ts",
  "../app/api/deliveries/create-trip/route.ts",
  "../app/api/deliveries/link-vehicle/route.ts",
  "../app/api/deliveries/whatsapp-consent/route.ts",
  "../app/api/sites/route.ts",
  "../app/api/auth/session/route.ts",
].map((path) => readFile(new URL(path, import.meta.url), "utf8")));

const deliveriesRoute = mutationRoutes[0];

test("same-origin helper accepts the app origin and rejects foreign origins", () => {
  assert.equal(requestIsSameOrigin(new Request("https://trackfleet.example/api", { headers: { origin: "https://trackfleet.example" } })), true);
  assert.equal(requestIsSameOrigin(new Request("https://trackfleet.example/api", { headers: { origin: "https://evil.example" } })), false);
});

test("non-browser requests without Origin remain compatible", () => {
  assert.equal(requestIsSameOrigin(new Request("https://trackfleet.example/api")), true);
});

test("authenticated mutation routes enforce the shared same-origin guard", () => {
  for (const source of mutationRoutes) {
    assert.match(source, /requestIsSameOrigin\(request\)/);
  }
});

test("delivery API does not expose raw internal exception messages", () => {
  assert.match(deliveriesRoute, /\{ error: "internal_error" \}/);
  assert.doesNotMatch(deliveriesRoute, /Response\.json\(\{ error: message \}/);
  assert.match(deliveriesRoute, /console\.error\("\[trackfleet:deliveries\] request failed"/);
});
