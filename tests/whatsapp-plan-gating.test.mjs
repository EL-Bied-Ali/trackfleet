import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// notification-runner.ts imports trackfleet-runtime-env, whose bare
// specifier only resolves under Vite/vinext's aliasing -- unresolvable from
// plain Node (matching this repo's established pattern, see
// notification-runner-bounded.test.mjs), so exercised via source-text
// assertions.
const runnerSource = await readFile(new URL("../app/lib/notification-runner.ts", import.meta.url), "utf8");

test("WhatsApp is a Pro-tier feature: a company without an active, Pro-plan (or grandfathered) subscription keeps notifications pending instead of sending", () => {
  assert.match(runnerSource, /import \{ getSubscription, subscriptionGrantsAccess, type Subscription \} from "\.\/subscription-store";/);
  assert.match(runnerSource, /const subscription = await getSubscription\(companyId\);/);
  assert.match(runnerSource, /if \(!whatsappIncludedInPlan\(subscription\)\) \{\s*\n\s*return \{ pending: pending\.length, sent, failed, suppressed \};/);
});

test("grandfathered companies (pre-Paddle, no plan ever assigned) keep WhatsApp access rather than losing it because plan is null", () => {
  const fn = runnerSource.slice(runnerSource.indexOf("function whatsappIncludedInPlan"), runnerSource.indexOf("function whatsappIncludedInPlan") + 400);
  assert.match(fn, /if \(subscription\.status === "grandfathered"\) return true;/);
});

test("a paying company only gets WhatsApp on the Pro plan, and only while the subscription actually grants access", () => {
  const fn = runnerSource.slice(runnerSource.indexOf("function whatsappIncludedInPlan"), runnerSource.indexOf("function whatsappIncludedInPlan") + 400);
  assert.match(fn, /return subscriptionGrantsAccess\(subscription\.status\) && subscription\.plan === "pro";/);
});
