// Pure subscription business rules, deliberately kept free of any database
// or runtimeEnv dependency (unlike the rest of subscription-store.ts, which
// needs Postgres access via pg-client.ts). Splitting these out keeps them
// directly importable and callable from plain Node -- e.g. by tests -- and
// from any other context that just needs the rule, not a live DB.

// "grandfathered" exists solely for companies that were already using
// TrackFleet before subscriptions were enforced -- assigned once, directly
// in production, for every row in `companies` at the time this shipped (see
// the PR that introduced this file). Never assigned by any code path here.
// A genuinely new company gets a "trialing" row instead, granted once on
// first login (see grantTrialIfNewCompany in subscription-store.ts) -- a
// company only has no row at all in the brief window before that first
// login completes.
export type SubscriptionStatus = "grandfathered" | "trialing" | "active" | "past_due" | "canceled";

export type Subscription = {
  companyId: string;
  status: SubscriptionStatus;
  plan: string | null;
  paddleCustomerId: string | null;
  paddleSubscriptionId: string | null;
  currentPeriodEnd: Date | null;
};

export function isSubscriptionStatus(value: unknown): value is SubscriptionStatus {
  return value === "grandfathered" || value === "trialing" || value === "active" || value === "past_due" || value === "canceled";
}

// Only these statuses grant access to the dashboard -- past_due/canceled
// (and no row at all) do not. Kept as its own function rather than inlined
// at each call site so the actual access rule lives in exactly one place.
export function subscriptionGrantsAccess(status: SubscriptionStatus | null) {
  return status === "grandfathered" || status === "trialing" || status === "active";
}

// WhatsApp is a Pro-tier feature (see app/lib/paddle-checkout.ts) --
// Standard-tier companies still get tracking and email notifications, just
// not WhatsApp pushes. "grandfathered" companies predate the Paddle
// paywall entirely and never had a plan assigned, so they keep the
// WhatsApp access they already had rather than losing it because `plan`
// happens to be null. Exported (not just used inside notification-runner.ts)
// so the dispatcher-facing UI (app/api/deliveries/route.ts's features
// payload) can tell an authenticated company whether to even show WhatsApp
// opt-in at all, instead of collecting consent for something that will
// silently never send.
export function whatsappIncludedInPlan(subscription: Subscription | null) {
  if (!subscription) return false;
  if (subscription.status === "grandfathered") return true;
  return subscriptionGrantsAccess(subscription.status) && subscription.plan === "pro";
}
