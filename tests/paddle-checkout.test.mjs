import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// paddle-checkout.ts imports trackfleet-runtime-env, whose bare specifier
// only resolves under Vite/vinext's aliasing -- unresolvable from plain
// Node (matching this repo's established pattern for every other
// runtimeEnv-dependent module), so exercised via source-text assertions.
const [checkoutLib, checkoutRoute, page] = await Promise.all([
  readFile(new URL("../app/lib/paddle-checkout.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/subscription/checkout/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
]);

test("the checkout transaction's custom_data.companyId comes from the authenticated session, never from client input", () => {
  assert.match(checkoutLib, /export async function createPaddleCheckout\(companyId: string\)/);
  assert.match(checkoutLib, /custom_data: \{ companyId \}/);
  assert.match(checkoutRoute, /const session = await getCompanySession\(request\);/);
  assert.match(checkoutRoute, /createPaddleCheckout\(session\.companyId\)/);
  // The route never reads a companyId out of the request body/payload --
  // if it did, that'd be the client-spoofable path this design avoids.
  assert.doesNotMatch(checkoutRoute, /readJsonObject/);
});

test("the checkout route requires authentication and same-origin, and degrades to a clear 'not configured' response instead of a raw provider error when Paddle credentials aren't set yet", () => {
  assert.match(checkoutRoute, /requestIsSameOrigin\(request\)/);
  assert.match(checkoutRoute, /if \(!session\) return json\(\{ error: "authentication_required" \}, 401\);/);
  assert.match(checkoutRoute, /if \(!paddleCheckoutConfigured\(\)\) return json\(\{ error: "not_configured" \}, 503\);/);
});

test("defaults to Paddle's sandbox API, never live, unless PADDLE_ENVIRONMENT is explicitly set to \"live\" -- an unset/misconfigured environment must not risk a real charge", () => {
  assert.match(checkoutLib, /runtimeEnv\.PADDLE_ENVIRONMENT\?\.trim\(\) === "live"/);
  assert.match(checkoutLib, /https:\/\/api\.paddle\.com/);
  assert.match(checkoutLib, /https:\/\/sandbox-api\.paddle\.com/);
});

test("the Paddle API call has a bounded request timeout, matching the existing WhatsApp/Google/SENDATRACK call pattern", () => {
  assert.match(checkoutLib, /AbortSignal\.timeout\(requestTimeoutMs\)/);
});

test("the subscription-required screen calls the checkout endpoint and redirects to the returned URL, with a graceful fallback message when checkout isn't available yet", () => {
  assert.match(page, /async function startSubscriptionCheckout\(\) \{/);
  assert.match(page, /fetch\("\/api\/subscription\/checkout", \{ method: "POST" \}\)/);
  assert.match(page, /window\.location\.href = data\.url;/);
  assert.match(page, /checkoutUnavailable/);
});
