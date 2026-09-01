import { grantOneFreeInvoice } from "./paddle-referral";
import { claimReferralReward, getReferredByCompanyId, getSubscription } from "./subscription-store";

// Called from the Paddle webhook the moment a company's subscription
// first becomes "active" (see app/api/webhooks/paddle/route.ts) -- a
// no-op for the vast majority of companies (no referrer set), and
// best-effort by design: a Paddle hiccup here must never fail the
// webhook's own response to Paddle, since the actual subscription state
// (upsertSubscription) already succeeded by the time this runs.
export async function maybeGrantReferralReward(companyId: string): Promise<void> {
  const referredByCompanyId = await getReferredByCompanyId(companyId);
  if (!referredByCompanyId) return;

  // Atomic claim first: guarantees a referral is ever rewarded at most
  // once, even if this fires twice (Paddle retries, or two lifecycle
  // events land close together) -- see claimReferralReward's own comment.
  const claimed = await claimReferralReward(companyId);
  if (!claimed) return;

  const referrerSubscription = await getSubscription(referredByCompanyId);
  const referrerPaddleSubscriptionId = referrerSubscription?.paddleSubscriptionId;
  if (!referrerPaddleSubscriptionId) {
    console.error("[trackfleet:referral] referrer has no Paddle subscription to reward", { companyId, referredByCompanyId });
    return;
  }

  const granted = await grantOneFreeInvoice(referrerPaddleSubscriptionId);
  if (granted) {
    console.info("[trackfleet:referral] granted one free invoice to referrer", { referredByCompanyId, companyId });
  } else {
    console.error("[trackfleet:referral] referral claimed but Paddle reward failed -- needs manual follow-up", { referredByCompanyId, companyId });
  }
}
