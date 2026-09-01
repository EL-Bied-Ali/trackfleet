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
// This is the first code in this repo to call Paddle's Discounts endpoint
// or PATCH a subscription's `discount` field -- worth a live sandbox
// smoke-test after this ships, since it's untested against Paddle's real
// API from this environment (no PADDLE_API_KEY available locally).
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

  const applyResponse = await fetch(`${paddleApiBase()}/subscriptions/${paddleSubscriptionId}`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ discount: { id: discountId } }),
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
