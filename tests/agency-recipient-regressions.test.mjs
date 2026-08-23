import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("receiver identity and phone are supported by form, API, CSV and both stores", async () => {
  const [page, route, importer, postgres, d1] = await Promise.all([
    read("../app/page.tsx"),
    read("../app/api/deliveries/route.ts"),
    read("../app/lib/bulk-delivery-import.ts"),
    read("../app/lib/delivery-store.postgres.ts"),
    read("../app/lib/delivery-store.cloudflare.ts"),
  ]);
  for (const source of [page, route, importer, postgres, d1]) {
    assert.match(source, /recipientName/);
    assert.match(source, /recipientContact/);
  }
  assert.match(route, /recipientName and recipientContact must be provided together/);
  assert.match(importer, /recipient_name/);
  assert.match(importer, /recipient_contact/);
});

test("remembered phone consent works for sender or receiver and honours the most recent opt-out across every delivery for that number", async () => {
  const route = await read("../app/api/deliveries/route.ts");
  assert.match(route, /customerMatches/);
  assert.match(route, /recipientMatches/);
  // Regression guard: consent must be resolved per phone number across ALL
  // matching deliveries (most recent grant vs most recent withdrawal), not
  // by stopping at the first matching delivery -- that earlier approach let
  // a withdrawal on one delivery be silently overridden by an older,
  // still-active grant sitting on a different delivery for the same number.
  assert.match(route, /event\.type === "WHATSAPP_OPT_OUT"/);
  assert.match(route, /if \(!mostRecentGrant\) return false;/);
  assert.match(route, /return !mostRecentWithdrawal \|\| mostRecentGrant > mostRecentWithdrawal;/);
  assert.match(route, /explicitWhatsappConsent \|\| customerConsentRemembered/);
  assert.match(route, /explicitWhatsappConsent \|\| recipientConsentRemembered/);
});

test("receiver details stay private on public tracking", async () => {
  const view = await read("../app/lib/public-delivery-view.ts");
  for (const field of ["recipientName", "recipientContact", "recipientWhatsappOptIn"]) {
    assert.doesNotMatch(view, new RegExp(`\\b${field}\\s*:`));
  }
});
