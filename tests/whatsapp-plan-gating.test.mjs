import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { whatsappIncludedInPlan } from "../app/lib/subscription-store.ts";

// notification-runner.ts imports trackfleet-runtime-env, whose bare
// specifier only resolves under Vite/vinext's aliasing -- unresolvable from
// plain Node (matching this repo's established pattern, see
// notification-runner-bounded.test.mjs), so its wiring is exercised via
// source-text assertions. whatsappIncludedInPlan itself lives in
// subscription-store.ts (no runtimeEnv dependency, like every other export
// there) specifically so it -- and anything else that needs to know
// whether WhatsApp is available, like the dispatcher-facing features
// payload -- can be imported and exercised directly instead.
const runnerSource = await readFile(new URL("../app/lib/notification-runner.ts", import.meta.url), "utf8");
const deliveriesRoute = await readFile(new URL("../app/api/deliveries/route.ts", import.meta.url), "utf8");
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

test("processPendingNotifications computes whatsappEligible from whatsappIncludedInPlan, but this must NOT gate the whole pipeline -- email (every plan) still has to reach the send loop for a Standard-tier company", () => {
  assert.match(runnerSource, /import \{ getSubscription, whatsappIncludedInPlan \} from "\.\/subscription-store";/);
  assert.match(runnerSource, /const subscription = await getSubscription\(companyId\);/);
  assert.match(runnerSource, /const whatsappEligible = whatsappIncludedInPlan\(subscription\);/);
  // Regression guard: whatsappEligible must be a plain local computed once,
  // never something the function returns early on -- that was the actual
  // bug (Standard-tier companies got literally zero notifications, not just
  // no WhatsApp, because the whole function bailed out before the send
  // loop). Confirmed by checking there's no `if (!whatsappEligible)` early
  // return anywhere, and that the send loop is still reached afterward.
  const declarationIndex = runnerSource.indexOf("const whatsappEligible = whatsappIncludedInPlan(subscription);");
  const nextLoop = runnerSource.indexOf("for (const item of actionable", declarationIndex);
  assert.ok(declarationIndex >= 0 && nextLoop > declarationIndex);
  assert.doesNotMatch(runnerSource, /if \(!whatsappEligible\)/);
});

test("the dispatcher-facing features payload exposes whatsappAvailable (computed via the same whatsappIncludedInPlan rule), so the new-delivery form can hide -- not just silently no-op -- WhatsApp opt-in for a Standard-tier company", () => {
  assert.match(deliveriesRoute, /import \{ getSubscription, subscriptionGrantsAccess, whatsappIncludedInPlan \} from "\.\.\/\.\.\/lib\/subscription-store";/);
  assert.match(deliveriesRoute, /whatsappAvailable: whatsappIncludedInPlan\(subscription\),/);
});

test("the new-delivery form only shows the WhatsApp consent checkbox when whatsappAvailable is true, and only nudges for missed consent in that case -- a Standard-tier dispatcher never collects consent for a channel that will silently never send", () => {
  assert.match(page, /\{features\.whatsappAvailable && <label className="consent-choice">/);
  assert.match(page, /if \(features\.whatsappAvailable && !whatsappOptIn && \(contactRaw \|\| recipientContactRaw\)\) \{/);
  assert.match(page, /type FeatureState = \{ whatsappDemoEnabled: boolean; whatsappAvailable: boolean \};/);
});

test("no subscription row at all (a company that somehow has none) never gets WhatsApp", () => {
  assert.equal(whatsappIncludedInPlan(null), false);
});

test("grandfathered companies (pre-Paddle, no plan ever assigned) keep WhatsApp access rather than losing it because plan is null", () => {
  assert.equal(whatsappIncludedInPlan({ companyId: "c1", status: "grandfathered", plan: null, paddleCustomerId: null, paddleSubscriptionId: null, currentPeriodEnd: null }), true);
});

test("a paying company only gets WhatsApp on the Pro plan", () => {
  const base = { companyId: "c1", paddleCustomerId: null, paddleSubscriptionId: null, currentPeriodEnd: null };
  assert.equal(whatsappIncludedInPlan({ ...base, status: "active", plan: "pro" }), true);
  assert.equal(whatsappIncludedInPlan({ ...base, status: "active", plan: "standard" }), false);
  assert.equal(whatsappIncludedInPlan({ ...base, status: "trialing", plan: "pro" }), true);
});

test("a Pro-plan company only gets WhatsApp while the subscription actually grants access -- past_due/canceled loses it even on the Pro plan", () => {
  const base = { companyId: "c1", plan: "pro", paddleCustomerId: null, paddleSubscriptionId: null, currentPeriodEnd: null };
  assert.equal(whatsappIncludedInPlan({ ...base, status: "past_due" }), false);
  assert.equal(whatsappIncludedInPlan({ ...base, status: "canceled" }), false);
});
