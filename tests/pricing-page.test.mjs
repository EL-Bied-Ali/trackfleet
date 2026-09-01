import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// User asked for a public pricing page prospects can see before logging in
// ("close_shutdown_the_pc" session, 2026-09-02). Prices must stay in sync
// with SubscribeScreen's own numbers in app/page.tsx -- that's the actual
// in-app checkout a logged-in company sees, so a mismatch here would be a
// prospect-facing lie about what they'll actually be charged.
const pricing = await readFile(new URL("../app/pricing/page.tsx", import.meta.url), "utf8");
const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

test("the pricing page is public -- no session/AppShellLayout gate, no client-only data fetch", () => {
  assert.doesNotMatch(pricing, /AppShellLayout/);
  assert.doesNotMatch(pricing, /fetch\(/);
});

test("pricing page shows both tiers with prices matching the in-app SubscribeScreen exactly", () => {
  assert.match(pricing, /standard: \{ monthly: "€45", yearly: "€400" \}/);
  assert.match(pricing, /pro: \{ monthly: "€90", yearly: "€800" \}/);
  const subscribeScreenPrices = pageSource.match(/const prices = \{\s*standard: \{ monthly: "€45", yearly: "€400" \},\s*pro: \{ monthly: "€90", yearly: "€800" \},/);
  assert.ok(subscribeScreenPrices, "SubscribeScreen's own prices must still be €45/€400 (Standard) and €90/€800 (Pro) for this test's assumption to hold");
});

test("pricing page is honest about the SENDATRACK prerequisite and free trial, and links back to login rather than a fake signup form", () => {
  assert.match(pricing, /SENDATRACK/);
  assert.match(pricing, /14/);
  assert.match(pricing, /<Link href="\/" className=\{styles\.cta\}>/);
});

test("pricing page is offered in all three locales, matching the rest of the app", () => {
  assert.match(pricing, /fr: \{/);
  assert.match(pricing, /en: \{/);
  assert.match(pricing, /nl: \{/);
});

test("the login page links to /pricing so a prospect without an account yet can actually find it", () => {
  assert.match(pageSource, /href=\{`\/pricing\?lang=\$\{locale\}`\}/);
});
