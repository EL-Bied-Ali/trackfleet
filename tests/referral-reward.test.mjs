import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { REQUIRED_POSTGRES_COLUMNS } from "../app/lib/storage-schema-contract.ts";

// Like subscription-store.ts's other DB-touching functions, the referral
// functions here need a real Postgres connection to execute -- and, like
// paddle-checkout.ts, grantOneFreeInvoice needs trackfleet-runtime-env
// (only resolvable under Vite/vinext), so this whole feature is exercised
// via source-text assertions, matching paddle-checkout.test.mjs and
// subscription-gate.test.mjs's established pattern for this codebase.
const [subscriptionStore, paddleReferral, referralReward, webhookRoute, adminReferralRoute, adminPage] = await Promise.all([
  readFile(new URL("../app/lib/subscription-store.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/paddle-referral.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/referral-reward.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/webhooks/paddle/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/companies/referral/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/admin/page.tsx", import.meta.url), "utf8"),
]);

test("the referral columns are part of the production schema contract", () => {
  assert.ok(REQUIRED_POSTGRES_COLUMNS.some((entry) => entry.table === "companies" && entry.column === "referred_by_company_id"));
  assert.ok(REQUIRED_POSTGRES_COLUMNS.some((entry) => entry.table === "subscriptions" && entry.column === "referral_reward_granted_at"));
});

test("claiming a referral reward is a single atomic UPDATE ... WHERE referral_reward_granted_at IS NULL -- the only thing standing between a duplicate webhook delivery and a double-paid reward", () => {
  assert.match(subscriptionStore, /export async function claimReferralReward\(companyId: string\): Promise<boolean> \{/);
  assert.match(subscriptionStore, /UPDATE subscriptions SET referral_reward_granted_at = \$\{new Date\(\)\.toISOString\(\)\}\s*\n\s*WHERE company_id = \$\{companyId\} AND referral_reward_granted_at IS NULL/);
  assert.match(subscriptionStore, /return claimed\.length > 0;/);
});

test("setting a referral is a plain admin-only write, and the admin company list resolves it to a human-readable label via a self-join", () => {
  assert.match(subscriptionStore, /export async function setReferredByCompanyId\(companyId: string, referredByCompanyId: string \| null\): Promise<void> \{/);
  assert.match(subscriptionStore, /export async function getReferredByCompanyId\(companyId: string\): Promise<string \| null> \{/);
  assert.match(subscriptionStore, /LEFT JOIN companies ref ON ref\.id = c\.referred_by_company_id/);
  assert.match(subscriptionStore, /referred_by_account_label: string \| null;/);
});

test("grantOneFreeInvoice creates a single-use, single-cycle 100% discount and attaches it to the referrer's subscription, never throwing on a Paddle-side failure", () => {
  assert.match(paddleReferral, /export async function grantOneFreeInvoice\(paddleSubscriptionId: string\): Promise<boolean> \{/);
  assert.match(paddleReferral, /type: "percentage",\s*\n\s*amount: "100",\s*\n\s*recur: true,\s*\n\s*maximum_recurring_intervals: 1,\s*\n\s*usage_limit: 1,/);
  assert.match(paddleReferral, /method: "PATCH",/);
  assert.match(paddleReferral, /body: JSON\.stringify\(\{ discount: \{ id: discountId, effective_from: "next_billing_period" \} \}\)/);
  assert.match(paddleReferral, /AbortSignal\.timeout\(requestTimeoutMs\)/g);
  assert.doesNotMatch(paddleReferral, /\bthrow\b/);
});

test("maybeGrantReferralReward checks for a referrer before claiming, claims before spending a Paddle call, and never throws on failure to reach Paddle", () => {
  const referredByIndex = referralReward.indexOf("getReferredByCompanyId(companyId)");
  const claimIndex = referralReward.indexOf("claimReferralReward(companyId)");
  const grantIndex = referralReward.indexOf("grantOneFreeInvoice(referrerPaddleSubscriptionId)");
  assert.ok(referredByIndex >= 0 && claimIndex > referredByIndex && grantIndex > claimIndex, "expected lookup-referrer, then claim, then spend-the-Paddle-call, in that order");
  assert.match(referralReward, /if \(!referredByCompanyId\) return;/);
  assert.match(referralReward, /if \(!claimed\) return;/);
  assert.doesNotMatch(referralReward, /\bthrow\b/);
});

test("the webhook only checks for a referral reward once, right after a subscription's first-ever transition to active -- not on every lifecycle event -- and never lets a Paddle failure there fail the webhook's own response", () => {
  assert.match(webhookRoute, /const previousStatus = \(await getSubscription\(event\.companyId\)\)\?\.status \?\? null;/);
  const upsertIndex = webhookRoute.indexOf("await upsertSubscription({");
  const previousStatusIndex = webhookRoute.indexOf("const previousStatus =");
  assert.ok(previousStatusIndex >= 0 && upsertIndex > previousStatusIndex, "previous status must be read BEFORE the upsert overwrites it");
  assert.match(webhookRoute, /if \(event\.status === "active" && previousStatus !== "active"\) \{/);
  assert.match(webhookRoute, /await maybeGrantReferralReward\(event\.companyId\)\.catch\(\(error: unknown\) => \{/);
});

test("the admin referral-set route requires same-origin, admin auth, rejects a company referring itself, and audit-logs the change", () => {
  assert.match(adminReferralRoute, /requestIsSameOrigin\(request\)/);
  assert.match(adminReferralRoute, /const email = await getAdminEmail\(request\);/);
  assert.match(adminReferralRoute, /referredByCompanyId === companyId/);
  assert.match(adminReferralRoute, /logAdminAction\(\{ adminEmail: email, action: "referral_set"/);
});

test("the admin panel lets an operator pick any OTHER company as the referrer from a dropdown, and shows whether the reward has actually been granted yet", () => {
  assert.match(adminPage, /companies\.filter\(\(candidate\) => candidate\.companyId !== company\.companyId\)/);
  assert.match(adminPage, /fetch\("\/api\/admin\/companies\/referral", \{/);
  assert.match(adminPage, /company\.referralRewardGrantedAt/);
  assert.match(adminPage, /"pending first payment"/);
});
