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

test("checkout returns a transaction id, not a hosted checkout URL -- the frontend opens it in a Paddle.js overlay so the customer never leaves TrackFleet", () => {
  assert.match(checkoutLib, /Promise<\{ transactionId: string \} \| null>/);
  assert.match(checkoutLib, /const transactionId = body\.data\?\.id;/);
  assert.doesNotMatch(checkoutLib, /checkout\?\.url/);
  assert.match(checkoutRoute, /return json\(\{ transactionId: checkout\.transactionId \}, 200\);/);
});

test("checkout is only offered once every plan/interval price id AND a Paddle.js client-side token are configured, so a customer can never pick a plan whose checkout silently fails or reach a screen that can't even open the overlay", () => {
  assert.match(checkoutLib, /export function paddleCheckoutConfigured\(\)/);
  assert.match(checkoutLib, /if \(!runtimeEnv\.PADDLE_CLIENT_TOKEN\?\.trim\(\)\) return false;/);
  assert.match(checkoutLib, /plans\.every\(\(plan\) => intervals\.every\(\(interval\) => Boolean\(priceIdFor\(plan, interval\)\)\)\)/);
});

test("the client-side token and environment are exposed as public config (not a secret like PADDLE_API_KEY), and the sandbox/live choice tracks the same PADDLE_ENVIRONMENT flag checkout uses", () => {
  assert.match(checkoutLib, /export function paddleClientConfig\(\)/);
  assert.match(checkoutLib, /export function paddlePublicEnvironment\(\): "live" \| "sandbox"/);
  assert.match(checkoutLib, /paddleIsLive\(\) \? "live" : "sandbox"/);
});

test("defaults to Paddle's sandbox API, never live, unless PADDLE_ENVIRONMENT is explicitly set to \"live\" -- an unset/misconfigured environment must not risk a real charge", () => {
  assert.match(checkoutLib, /runtimeEnv\.PADDLE_ENVIRONMENT\?\.trim\(\) === "live"/);
  assert.match(checkoutLib, /https:\/\/api\.paddle\.com/);
  assert.match(checkoutLib, /https:\/\/sandbox-api\.paddle\.com/);
});

test("the Paddle API call has a bounded request timeout, matching the existing WhatsApp/Google/SENDATRACK call pattern", () => {
  assert.match(checkoutLib, /AbortSignal\.timeout\(requestTimeoutMs\)/);
});

test("a past_due subscription (still alive in Paddle, just failing to collect payment) is recovered in place via a payment-method-update transaction on the SAME subscription instead of createPaddleCheckout creating a redundant second one -- Paddle cancellation is permanent with no reactivate API, so createPaddleCheckout stays correct for canceled/no-subscription/plan-change cases", () => {
  assert.match(checkoutLib, /export async function createPaddlePaymentMethodUpdateTransaction\(\s*\n\s*paddleSubscriptionId: string,\s*\n\): Promise<\{ transactionId: string \} \| null>/);
  assert.match(checkoutLib, /\/subscriptions\/\$\{paddleSubscriptionId\}\/update-payment-method-transaction/);
  assert.match(checkoutLib, /method: "GET"/);
  assert.match(checkoutRoute, /import \{ getSubscription \} from "\.\.\/\.\.\/\.\.\/lib\/subscription-store";/);
  assert.match(checkoutRoute, /const existing = await getSubscription\(session\.companyId\);/);
  assert.match(checkoutRoute, /existing\?\.status === "past_due" && existing\.plan === plan/);
  assert.match(checkoutRoute, /createPaddlePaymentMethodUpdateTransaction\(pastDueSubscriptionId\)/);
});

test("the checkout POST route requires authentication and same-origin, and degrades to a clear 'not configured' response instead of a raw provider error when Paddle credentials aren't set yet", () => {
  assert.match(checkoutRoute, /requestIsSameOrigin\(request\)/);
  assert.match(checkoutRoute, /if \(!session\) return json\(\{ error: "authentication_required" \}, 401\);/);
  assert.match(checkoutRoute, /if \(!paddleCheckoutConfigured\(\)\) return json\(\{ error: "not_configured" \}, 503\);/);
});

test("the checkout GET route (client config for Paddle.js) also requires authentication, and never returns without a real client token", () => {
  const getFnIndex = checkoutRoute.indexOf("export async function GET");
  const postFnIndex = checkoutRoute.indexOf("export async function POST");
  assert.ok(getFnIndex >= 0 && postFnIndex > getFnIndex);
  const getFn = checkoutRoute.slice(getFnIndex, postFnIndex);
  assert.match(getFn, /if \(!session\) return json\(\{ error: "authentication_required" \}, 401\);/);
  assert.match(getFn, /if \(!clientConfig\) return json\(\{ error: "not_configured" \}, 503\);/);
  assert.match(getFn, /return json\(clientConfig, 200\);/);
});

test("the subscribe screen lets a company pick a plan and interval, opens a Paddle.js overlay checkout with the returned transaction id instead of navigating away, and waits for the webhook-driven activation before reloading", () => {
  assert.match(page, /async function startSubscriptionCheckout\(plan: "standard" \| "pro"\) \{/);
  assert.match(page, /const ready = await ensurePaddleReady\(handlePaddleEvent\);/);
  assert.match(page, /body: JSON\.stringify\(\{ plan, interval: checkoutInterval \}\)/);
  assert.match(page, /window\.Paddle\.Checkout\.open\(\{ transactionId: data\.transactionId \}\);/);
  assert.doesNotMatch(page, /window\.location\.href = data\.url/);
  assert.match(page, /checkoutUnavailable/);
  assert.match(page, /function SubscribeScreen\(/);
});

test("Paddle.js is loaded and initialized at most once (module-level guards, not component state) -- remounting the subscribe screen must not re-register the event callback or re-inject the script", () => {
  assert.match(page, /let paddleScriptPromise: Promise<void> \| null = null;/);
  assert.match(page, /let paddleInitialized = false;/);
  assert.match(page, /if \(window\.Paddle\) return Promise\.resolve\(\);/);
  assert.match(page, /if \(!paddleInitialized\) \{/);
});

test("checkout.completed triggers polling for subscription activation, and only reloads once the dashboard actually stops returning 402 -- reloading immediately would flash the paywall again before the webhook lands", () => {
  assert.match(page, /if \(event\.name === "checkout\.completed"\) void waitForSubscriptionActivation\(\);/);
  assert.match(page, /async function waitForSubscriptionActivation\(\) \{/);
  assert.match(page, /if \(response\.status !== 402\) \{ window\.location\.reload\(\); return; \}/);
});
