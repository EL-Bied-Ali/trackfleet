import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isPaddleInterval, isPaddlePlan } from "../app/lib/paddle-plan.ts";

// paddle-checkout.ts imports trackfleet-runtime-env, whose bare specifier
// only resolves under Vite/vinext's aliasing -- unresolvable from plain
// Node (matching this repo's established pattern for every other
// runtimeEnv-dependent module), so most of its behavior is exercised via
// source-text assertions. isPaddlePlan/isPaddleInterval live in their own
// runtimeEnv-free module (paddle-plan.ts) specifically so they -- and
// anything else that needs them, like paddle-webhook.ts -- can be imported
// and exercised directly instead.
const [checkoutLib, checkoutRoute, page] = await Promise.all([
  readFile(new URL("../app/lib/paddle-checkout.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/subscription/checkout/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
]);

test("only the two real plans and two real intervals are accepted -- anything else (including a client-supplied garbage value) is rejected", () => {
  assert.equal(isPaddlePlan("standard"), true);
  assert.equal(isPaddlePlan("pro"), true);
  assert.equal(isPaddlePlan("enterprise"), false);
  assert.equal(isPaddlePlan(null), false);
  assert.equal(isPaddleInterval("monthly"), true);
  assert.equal(isPaddleInterval("yearly"), true);
  assert.equal(isPaddleInterval("weekly"), false);
});

test("the checkout transaction's custom_data.companyId comes from the authenticated session and plan/interval from validated input, never a client-spoofable companyId", () => {
  assert.match(checkoutLib, /export async function createPaddleCheckout\(\s*\n\s*companyId: string,\s*\n\s*plan: PaddlePlan,\s*\n\s*interval: PaddleInterval,\s*\n\)/);
  assert.match(checkoutLib, /custom_data: \{ companyId, plan \}/);
  assert.match(checkoutRoute, /const session = await getCompanySession\(request\);/);
  assert.match(checkoutRoute, /createPaddleCheckout\(session\.companyId, plan, interval\)/);
  // plan/interval are read from the body and validated with isPaddlePlan/
  // isPaddleInterval -- companyId itself is never read from the body, which
  // is the client-spoofable path this design avoids.
  assert.match(checkoutRoute, /if \(!isPaddlePlan\(plan\) \|\| !isPaddleInterval\(interval\)\) return json\(\{ error: "invalid_plan" \}, 400\);/);
  assert.doesNotMatch(checkoutRoute, /payload\.companyId/);
});

test("checkout is only offered once every plan/interval price id is configured, so a customer can never pick a plan whose checkout silently fails", () => {
  assert.match(checkoutLib, /export function paddleCheckoutConfigured\(\)/);
  assert.match(checkoutLib, /plans\.every\(\(plan\) => intervals\.every\(\(interval\) => Boolean\(priceIdFor\(plan, interval\)\)\)\)/);
});

test("defaults to Paddle's sandbox API, never live, unless PADDLE_ENVIRONMENT is explicitly set to \"live\" -- an unset/misconfigured environment must not risk a real charge", () => {
  assert.match(checkoutLib, /runtimeEnv\.PADDLE_ENVIRONMENT\?\.trim\(\) === "live"/);
  assert.match(checkoutLib, /https:\/\/api\.paddle\.com/);
  assert.match(checkoutLib, /https:\/\/sandbox-api\.paddle\.com/);
});

test("the Paddle API call has a bounded request timeout, matching the existing WhatsApp/Google/SENDATRACK call pattern", () => {
  assert.match(checkoutLib, /AbortSignal\.timeout\(requestTimeoutMs\)/);
});

test("the checkout route requires authentication and same-origin, and degrades to a clear 'not configured' response instead of a raw provider error when Paddle credentials aren't set yet", () => {
  assert.match(checkoutRoute, /requestIsSameOrigin\(request\)/);
  assert.match(checkoutRoute, /if \(!session\) return json\(\{ error: "authentication_required" \}, 401\);/);
  assert.match(checkoutRoute, /if \(!paddleCheckoutConfigured\(\)\) return json\(\{ error: "not_configured" \}, 503\);/);
});

test("the subscribe screen lets a company pick a plan and interval, calls the checkout endpoint with both, and redirects to the returned URL with a graceful fallback message when checkout isn't available yet", () => {
  assert.match(page, /async function startSubscriptionCheckout\(plan: "standard" \| "pro"\) \{/);
  assert.match(page, /body: JSON\.stringify\(\{ plan, interval: checkoutInterval \}\)/);
  assert.match(page, /window\.location\.href = data\.url;/);
  assert.match(page, /checkoutUnavailable/);
  assert.match(page, /function SubscribeScreen\(/);
});
