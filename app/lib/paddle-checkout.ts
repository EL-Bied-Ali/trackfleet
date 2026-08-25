import { runtimeEnv } from "trackfleet-runtime-env";
import type { PaddleInterval, PaddlePlan } from "./paddle-plan.ts";

export type { PaddleInterval, PaddlePlan } from "./paddle-plan.ts";
export { isPaddleInterval, isPaddlePlan } from "./paddle-plan.ts";

const requestTimeoutMs = 10_000;

function paddleApiBase() {
  // Defaults to sandbox on purpose -- an unset/misconfigured environment
  // must never silently point at live and risk a real charge before this
  // has been deliberately switched over.
  return runtimeEnv.PADDLE_ENVIRONMENT?.trim() === "live"
    ? "https://api.paddle.com"
    : "https://sandbox-api.paddle.com";
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
// price id configured -- a partially configured catalog would let a
// customer pick a plan whose checkout then silently fails.
export function paddleCheckoutConfigured() {
  if (!runtimeEnv.PADDLE_API_KEY?.trim()) return false;
  const plans: PaddlePlan[] = ["standard", "pro"];
  const intervals: PaddleInterval[] = ["monthly", "yearly"];
  return plans.every((plan) => intervals.every((interval) => Boolean(priceIdFor(plan, interval))));
}

// custom_data is how the webhook later knows which TrackFleet company a
// Paddle subscription belongs to, and which plan it's on (see
// paddle-webhook.ts) -- set here, server-side, from the authenticated
// session's own companyId and the validated plan/interval, so neither can
// be spoofed by a client-supplied value.
export async function createPaddleCheckout(
  companyId: string,
  plan: PaddlePlan,
  interval: PaddleInterval,
): Promise<{ url: string } | null> {
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

  const body = await response.json() as { data?: { checkout?: { url?: string } } };
  const url = body.data?.checkout?.url;
  return url ? { url } : null;
}
