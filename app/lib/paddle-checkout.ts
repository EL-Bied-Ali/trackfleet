import { runtimeEnv } from "trackfleet-runtime-env";
import type { PaddleInterval, PaddlePlan } from "./paddle-plan.ts";

export type { PaddleInterval, PaddlePlan } from "./paddle-plan.ts";
export { isPaddleInterval, isPaddlePlan } from "./paddle-plan.ts";

const requestTimeoutMs = 10_000;

// Defaults to sandbox on purpose -- an unset/misconfigured environment must
// never silently point at live and risk a real charge before this has been
// deliberately switched over.
function paddleIsLive() {
  return runtimeEnv.PADDLE_ENVIRONMENT?.trim() === "live";
}

// Exported for paddle-referral.ts, which calls Paddle endpoints
// (Discounts, Subscriptions) this file doesn't otherwise need -- both must
// target the same environment paddleIsLive() resolves here, so this stays
// the one place that decision is made.
export function paddleApiBase() {
  return paddleIsLive() ? "https://api.paddle.com" : "https://sandbox-api.paddle.com";
}

// The frontend's Paddle.js overlay needs to know which environment to talk
// to as well -- a client-side token is only valid against the matching
// environment (sandbox tokens don't work against the live API and vice
// versa), so this must track paddleIsLive() rather than being configured
// independently.
export function paddlePublicEnvironment(): "live" | "sandbox" {
  return paddleIsLive() ? "live" : "sandbox";
}

function priceIdFor(plan: PaddlePlan, interval: PaddleInterval): string | undefined {
  if (plan === "standard") {
    return interval === "monthly"
      ? runtimeEnv.PADDLE_PRICE_ID_STANDARD_MONTHLY?.trim()
      : runtimeEnv.PADDLE_PRICE_ID_STANDARD_YEARLY?.trim();
  }
  return interval === "monthly"
    ? runtimeEnv.PADDLE_PRICE_ID_PRO_MONTHLY?.trim()
    : runtimeEnv.PADDLE_PRICE_ID_PRO_YEARLY?.trim();
}

// Checkout is only offered once every plan/interval combination has a real
// price id configured, plus a client-side token for the Paddle.js overlay --
// a partially configured catalog would let a customer pick a plan whose
// checkout then silently fails.
export function paddleCheckoutConfigured() {
  if (!runtimeEnv.PADDLE_API_KEY?.trim()) return false;
  if (!runtimeEnv.PADDLE_CLIENT_TOKEN?.trim()) return false;
  const plans: PaddlePlan[] = ["standard", "pro"];
  const intervals: PaddleInterval[] = ["monthly", "yearly"];
  return plans.every((plan) => intervals.every((interval) => Boolean(priceIdFor(plan, interval))));
}

// A client-side token is public by design (meant to be embedded in
// frontend JS, unlike PADDLE_API_KEY) -- safe to hand back to an
// authenticated company so their browser can drive the Paddle.js overlay
// checkout directly instead of a full-page redirect to a Paddle-hosted page.
export function paddleClientConfig() {
  const clientToken = runtimeEnv.PADDLE_CLIENT_TOKEN?.trim();
  if (!clientToken) return null;
  return { clientToken, environment: paddlePublicEnvironment() };
}

// custom_data is how the webhook later knows which TrackFleet company a
// Paddle subscription belongs to, and which plan it's on (see
// paddle-webhook.ts) -- set here, server-side, from the authenticated
// session's own companyId and the validated plan/interval, so neither can
// be spoofed by a client-supplied value. Returns the transaction id (not a
// hosted checkout URL): the frontend opens it in a Paddle.js overlay via
// Paddle.Checkout.open({ transactionId }), so the customer never leaves
// TrackFleet and completion can be handled in-page instead of needing a
// Paddle-approved custom domain for a post-payment redirect.
export async function createPaddleCheckout(
  companyId: string,
  plan: PaddlePlan,
  interval: PaddleInterval,
): Promise<{ transactionId: string } | null> {
  const apiKey = runtimeEnv.PADDLE_API_KEY?.trim();
  const priceId = priceIdFor(plan, interval);
  if (!apiKey || !priceId) return null;

  const response = await fetch(`${paddleApiBase()}/transactions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      items: [{ price_id: priceId, quantity: 1 }],
      custom_data: { companyId, plan },
    }),
    signal: AbortSignal.timeout(requestTimeoutMs),
  });

  if (!response.ok) {
    console.error("[trackfleet:paddle] checkout transaction creation failed", { status: response.status });
    return null;
  }

  const body = await response.json() as { data?: { id?: string } };
  const transactionId = body.data?.id;
  return transactionId ? { transactionId } : null;
}

// Paddle cancellation is permanent -- a canceled subscription has no
// reactivate API and the only way back is a brand-new one (createPaddleCheckout
// above is already correct for that case). past_due is different: the
// subscription itself is still alive in Paddle, just failing to collect
// payment, and Paddle exposes a dedicated transaction for updating payment
// details against that SAME subscription. Reusing createPaddleCheckout for
// past_due would create a second, redundant subscription instead of
// recovering the existing one. Returns the same { transactionId } shape as
// createPaddleCheckout so the frontend's existing
// Paddle.Checkout.open({ transactionId }) call needs no changes.
export async function createPaddlePaymentMethodUpdateTransaction(
  paddleSubscriptionId: string,
): Promise<{ transactionId: string } | null> {
  const apiKey = runtimeEnv.PADDLE_API_KEY?.trim();
  if (!apiKey) return null;

  const response = await fetch(`${paddleApiBase()}/subscriptions/${paddleSubscriptionId}/update-payment-method-transaction`, {
    method: "GET",
    headers: { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(requestTimeoutMs),
  });

  if (!response.ok) {
    console.error("[trackfleet:paddle] payment method update transaction failed", { status: response.status });
    return null;
  }

  const body = await response.json() as { data?: { id?: string } };
  const transactionId = body.data?.id;
  return transactionId ? { transactionId } : null;
}
