import { runtimeEnv } from "trackfleet-runtime-env";
import { paddleApiBase } from "./paddle-checkout";

const requestTimeoutMs = 10_000;

// Called once per referral payout (see referral-reward.ts, which claims the
// right to call this exactly once via subscription-store.ts's
// claimReferralReward). Two Paddle Billing calls: create a single-use,
// single-cycle 100%-off discount, then attach it to the referrer's own
// subscription so it applies to their next renewal automatically -- no
// coupon code for them to redeem, no manual invoice adjustment.
//
// Verified live 2026-09-01 against Paddle's sandbox API (via a temporary
// diagnostic route, since PADDLE_API_KEY isn't available locally): discount
// creation worked first try, subscription attachment needed the
// effective_from fix below.
export async function grantOneFreeInvoice(paddleSubscriptionId: string): Promise<boolean> {
  const apiKey = runtimeEnv.PADDLE_API_KEY?.trim();
  if (!apiKey) {
    console.error("[trackfleet:referral] PADDLE_API_KEY missing, cannot grant referral reward");
    return false;
  }

  const discountResponse = await fetch(`${paddleApiBase()}/discounts`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      description: "TrackFleet referral reward -- one free billing cycle",
      type: "percentage",
      amount: "100",
      recur: true,
      maximum_recurring_intervals: 1,
      usage_limit: 1,
      enabled_for_checkout: false,
    }),
    signal: AbortSignal.timeout(requestTimeoutMs),
  }).catch((error: unknown) => {
    console.error("[trackfleet:referral] discount creation request failed", { message: error instanceof Error ? error.message : "unknown_error" });
    return null;
  });
  if (!discountResponse || !discountResponse.ok) {
    console.error("[trackfleet:referral] discount creation failed", { status: discountResponse?.status ?? null });
    return false;
  }

  const discountBody = await discountResponse.json() as { data?: { id?: string } };
  const discountId = discountBody.data?.id;
  if (!discountId) {
    console.error("[trackfleet:referral] discount creation returned no id");
    return false;
  }

  // Confirmed live against Paddle's sandbox API: `discount` alone 400s --
  // Paddle requires `effective_from` alongside `id` (one of two allowed
  // shapes; the other is `discount: null`, to remove one). "next_billing_period"
  // is also exactly the right semantics here: the reward is "your next
  // invoice is free," not an immediate, mid-cycle credit.
  const applyResponse = await fetch(`${paddleApiBase()}/subscriptions/${paddleSubscriptionId}`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ discount: { id: discountId, effective_from: "next_billing_period" } }),
    signal: AbortSignal.timeout(requestTimeoutMs),
  }).catch((error: unknown) => {
    console.error("[trackfleet:referral] discount attachment request failed", { message: error instanceof Error ? error.message : "unknown_error" });
    return null;
  });
  if (!applyResponse || !applyResponse.ok) {
    const errorBody = applyResponse ? await applyResponse.text().catch(() => "") : "";
    console.error("[trackfleet:referral] discount attachment failed", { status: applyResponse?.status ?? null, discountId, errorBody });
    return false;
  }

  return true;
}
