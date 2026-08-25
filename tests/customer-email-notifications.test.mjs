import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const files = Object.fromEntries(await Promise.all([
  "app/api/deliveries/route.ts",
  "app/lib/delivery-store.postgres.ts",
  "app/lib/delivery-store.shared-postgres.ts",
  "app/lib/delivery-store.cloudflare.ts",
  "app/lib/delivery-operational.postgres.ts",
  "app/lib/delivery-operational.cloudflare.ts",
  "app/lib/d1-standby-read-store.ts",
  "app/lib/d1-history-backfill.ts",
  "app/lib/d1-reconciliation.ts",
  "app/lib/delivery-history.postgres.ts",
  "app/lib/storage-schema-contract.ts",
  "app/lib/public-delivery-view.ts",
  "scripts/prepare-d1-schema.mjs",
  "app/page.tsx",
].map(async (path) => [path, await readFile(new URL(`../${path}`, import.meta.url), "utf8")])));

test("customerEmail is validated at intake with the same optional-field contract as contact/recipientContact, and rejects malformed (not merely empty) input", () => {
  const route = files["app/api/deliveries/route.ts"];
  assert.match(route, /const customerEmailInput = String\(payload\.customerEmail \?\? ""\)\.trim\(\);/);
  assert.match(route, /customerEmailInput\.length > 254/);
  assert.match(route, /const customerEmail = normalizeCustomerEmail\(customerEmailInput\);/);
  assert.match(route, /if \(customerEmail === null\) \{\s*\n\s*return Response\.json\(\{ error: "customerEmail must be a valid email address" \}, \{ status: 400 \}\);/);
});

test("customerEmail flows into store.create() and both idempotency-payload comparisons, exactly like the other identity fields", () => {
  const route = files["app/api/deliveries/route.ts"];
  assert.match(route, /customerEmail: customerEmail \|\| null,/);
  const matches = [...route.matchAll(/deliveryIdempotencyPayloadMatches\(existing, \{[^}]*customerEmail: customerEmail \|\| null[^}]*\}\)/g)];
  assert.equal(matches.length, 2, "expected customerEmail in both the replay check and the create-race recovery check");
});

test("customer_email exists everywhere item_description does across the Postgres/D1 dual-write system, following the exact same column-addition pattern", () => {
  for (const [path, source] of Object.entries(files)) {
    if (path === "app/api/deliveries/route.ts" || path === "app/page.tsx" || path === "app/lib/public-delivery-view.ts") continue;
    const hasItemDescription = /item_description|itemDescription/.test(source);
    const hasCustomerEmail = /customer_email|customerEmail/.test(source);
    assert.ok(hasItemDescription, `expected ${path} to reference item_description as the template field`);
    assert.ok(hasCustomerEmail, `expected ${path} to also handle customer_email/customerEmail alongside item_description`);
  }
});

test("customer_email is part of the gated production schema contract, so a deploy fails closed if the column were ever missing", () => {
  assert.match(files["app/lib/storage-schema-contract.ts"], /\{ table: "deliveries", column: "customer_email" \}/);
});

test("a customer's own email is deliberately NOT echoed back on the public tracking page, unlike item_description -- it's not something the customer needs to see about their own submission, and public-delivery-view.ts should stay minimal", () => {
  assert.doesNotMatch(files["app/lib/public-delivery-view.ts"], /customerEmail|customer_email/);
});

test("the new-delivery form has a customer email input, separate from the phone field, with no separate opt-in checkbox required (unlike WhatsApp)", () => {
  const page = files["app/page.tsx"];
  assert.match(page, /name="customerEmail" type="email"/);
  assert.match(page, /customerEmail: String\(form\.get\("customerEmail"\) \?\? ""\)\.trim\(\),/);
});
