import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { subscriptionGrantsAccess } from "../app/lib/subscription-store.ts";
import { REQUIRED_POSTGRES_TABLES } from "../app/lib/storage-schema-contract.ts";

test("only grandfathered/trialing/active subscriptions grant dashboard access", () => {
  assert.equal(subscriptionGrantsAccess("grandfathered"), true);
  assert.equal(subscriptionGrantsAccess("trialing"), true);
  assert.equal(subscriptionGrantsAccess("active"), true);
  assert.equal(subscriptionGrantsAccess("past_due"), false);
  assert.equal(subscriptionGrantsAccess("canceled"), false);
  // No row at all (the default for a genuinely new company that hasn't
  // subscribed yet) must NOT grant access -- this is the actual enforcement
  // point, not an edge case to relax.
  assert.equal(subscriptionGrantsAccess(null), false);
});

test("the subscriptions table is part of the production schema contract", () => {
  assert.ok(REQUIRED_POSTGRES_TABLES.includes("subscriptions"));
});

test("both the delivery list and delivery creation routes are gated on an active subscription, checked right after authentication and before any real work", async () => {
  const route = await readFile(new URL("../app/api/deliveries/route.ts", import.meta.url), "utf8");
  const gateOccurrences = [...route.matchAll(/if \(!subscriptionGrantsAccess\(subscription\?\.status \?\? null\)\) \{\s*\n\s*return Response\.json\(\{ error: "subscription_required" \}, \{ status: 402/g)];
  assert.equal(gateOccurrences.length, 2, "expected the subscription gate in both GET and POST");
  // Gate comes after the auth check, not before -- an unauthenticated
  // request should still get a plain 401, not leak subscription state.
  const authIndex = route.indexOf('if (!session) return Response.json({ error: "authentication_required"');
  const gateIndex = route.indexOf("subscriptionGrantsAccess(subscription");
  assert.ok(authIndex >= 0 && gateIndex > authIndex);
});

test("a company with no active subscription can still log in and see a dedicated screen -- the gate gets in front of dashboard data, not authentication itself", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /"loading" \| "ready" \| "error" \| "subscription_required"/);
  assert.match(page, /response\.status === 402 && !tracking/);
  assert.match(page, /dispatchDataState === "subscription_required"/);
});
