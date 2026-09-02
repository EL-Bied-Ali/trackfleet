import { getSql } from "./pg-client.ts";
import { isSubscriptionStatus } from "./subscription-rules.ts";
import type { Subscription, SubscriptionStatus } from "./subscription-rules.ts";

export type { Subscription, SubscriptionStatus } from "./subscription-rules.ts";
export { subscriptionGrantsAccess, whatsappIncludedInPlan } from "./subscription-rules.ts";

export async function getSubscription(companyId: string): Promise<Subscription | null> {
  const sql = getSql();
  const rows = await sql`
    SELECT company_id, status, plan, paddle_customer_id, paddle_subscription_id, current_period_end
    FROM subscriptions
    WHERE company_id = ${companyId}
    LIMIT 1
  ` as Array<{
    company_id: string;
    status: string;
    plan: string | null;
    paddle_customer_id: string | null;
    paddle_subscription_id: string | null;
    current_period_end: string | Date | null;
  }>;
  const row = rows[0];
  if (!row || !isSubscriptionStatus(row.status)) return null;
  return {
    companyId: row.company_id,
    status: row.status,
    plan: row.plan,
    paddleCustomerId: row.paddle_customer_id,
    paddleSubscriptionId: row.paddle_subscription_id,
    currentPeriodEnd: row.current_period_end ? new Date(row.current_period_end) : null,
  };
}

export type CompanyWithSubscription = {
  companyId: string;
  accountLabel: string;
  userLabel: string;
  createdAt: Date;
  subscriptionStatus: SubscriptionStatus | null;
  plan: string | null;
  currentPeriodEnd: Date | null;
  referredByCompanyId: string | null;
  referredByAccountLabel: string | null;
  referralRewardGrantedAt: Date | null;
};

// Admin-only (see app/api/admin/companies/route.ts) -- every company, not
// scoped to one tenant, which is exactly what makes this admin-only rather
// than something any dispatcher session could call. The self-join resolves
// referred_by_company_id to a human-readable account label so the admin
// panel doesn't have to cross-reference the same list twice.
export async function listCompaniesWithSubscriptions(): Promise<CompanyWithSubscription[]> {
  const sql = getSql();
  const rows = await sql`
    SELECT c.id AS company_id, c.account_label, c.user_label, c.created_at,
           c.referred_by_company_id, ref.account_label AS referred_by_account_label,
           s.status, s.plan, s.current_period_end, s.referral_reward_granted_at
    FROM companies c
    LEFT JOIN subscriptions s ON s.company_id = c.id
    LEFT JOIN companies ref ON ref.id = c.referred_by_company_id
    ORDER BY c.created_at DESC
  ` as Array<{
    company_id: string;
    account_label: string;
    user_label: string;
    created_at: string | Date;
    referred_by_company_id: string | null;
    referred_by_account_label: string | null;
    status: string | null;
    plan: string | null;
    current_period_end: string | Date | null;
    referral_reward_granted_at: string | Date | null;
  }>;
  return rows.map((row) => ({
    companyId: row.company_id,
    accountLabel: row.account_label,
    userLabel: row.user_label,
    createdAt: new Date(row.created_at),
    subscriptionStatus: isSubscriptionStatus(row.status) ? row.status : null,
    plan: row.plan,
    currentPeriodEnd: row.current_period_end ? new Date(row.current_period_end) : null,
    referredByCompanyId: row.referred_by_company_id,
    referredByAccountLabel: row.referred_by_account_label,
    referralRewardGrantedAt: row.referral_reward_granted_at ? new Date(row.referral_reward_granted_at) : null,
  }));
}

// Admin-only write (see app/api/admin/companies/referral/route.ts) -- null
// clears a mistakenly-set referral. Deliberately does not validate that
// referredByCompanyId refers to a real company: the admin UI only ever
// offers a dropdown of real companies, and a dangling id would just mean
// referral-reward.ts's later lookup finds no Paddle subscription to reward
// (logged, not thrown) rather than corrupting anything.
export async function setReferredByCompanyId(companyId: string, referredByCompanyId: string | null): Promise<void> {
  const sql = getSql();
  await sql`UPDATE companies SET referred_by_company_id = ${referredByCompanyId}, updated_at = ${new Date().toISOString()} WHERE id = ${companyId}`;
}

export async function getReferredByCompanyId(companyId: string): Promise<string | null> {
  const sql = getSql();
  const rows = await sql`SELECT referred_by_company_id FROM companies WHERE id = ${companyId} LIMIT 1` as Array<{ referred_by_company_id: string | null }>;
  return rows[0]?.referred_by_company_id ?? null;
}

// Atomically claims the right to grant this company's referral reward --
// the UPDATE only touches a row that hasn't been claimed yet, so two
// concurrent/retried webhook deliveries for the same company can race here
// and only one will get `true` back, no separate locking needed. Returns
// false both when a row exists but was already claimed AND when no
// subscription row exists at all for this company (nothing to claim).
export async function claimReferralReward(companyId: string): Promise<boolean> {
  const sql = getSql();
  const claimed = await sql`
    UPDATE subscriptions SET referral_reward_granted_at = ${new Date().toISOString()}
    WHERE company_id = ${companyId} AND referral_reward_granted_at IS NULL
    RETURNING company_id
  ` as Array<{ company_id: string }>;
  return claimed.length > 0;
}

// Admin-only: fetches a company's stored, encrypted SENDATRACK credentials
// so an admin can mint a normal session on that company's behalf (see
// app/api/admin/companies/impersonate/route.ts) without ever seeing the
// plaintext password themselves -- decryption happens inside
// createCompanySession's own call chain, same as a normal login.
export async function getCompanyCredentialsCiphertext(companyId: string): Promise<string | null> {
  const sql = getSql();
  const rows = await sql`SELECT credentials_ciphertext FROM companies WHERE id = ${companyId} LIMIT 1` as Array<{ credentials_ciphertext: string }>;
  return rows[0]?.credentials_ciphertext ?? null;
}

// Called from the Paddle webhook handler once that's wired up -- upserts by
// companyId, so a re-delivered webhook event (Paddle retries on a non-2xx
// response) is naturally idempotent rather than needing separate dedup.
export async function upsertSubscription(input: {
  companyId: string;
  status: SubscriptionStatus;
  plan?: string | null;
  paddleCustomerId?: string | null;
  paddleSubscriptionId?: string | null;
  currentPeriodEnd?: Date | null;
}) {
  const sql = getSql();
  const now = new Date().toISOString();
  await sql`
    INSERT INTO subscriptions (
      company_id, status, plan, paddle_customer_id, paddle_subscription_id, current_period_end, created_at, updated_at
    ) VALUES (
      ${input.companyId}, ${input.status}, ${input.plan ?? null}, ${input.paddleCustomerId ?? null},
      ${input.paddleSubscriptionId ?? null}, ${input.currentPeriodEnd?.toISOString() ?? null}, ${now}, ${now}
    )
    ON CONFLICT (company_id) DO UPDATE SET
      status = EXCLUDED.status,
      plan = EXCLUDED.plan,
      paddle_customer_id = EXCLUDED.paddle_customer_id,
      paddle_subscription_id = EXCLUDED.paddle_subscription_id,
      current_period_end = EXCLUDED.current_period_end,
      updated_at = EXCLUDED.updated_at
  `;
}

const trialDays = 14;

// Called from createCompanySession (app/lib/company-auth.ts) on every
// successful login/link/impersonation -- ON CONFLICT DO NOTHING makes this
// safe to call unconditionally every time rather than needing to first
// detect "is this genuinely a brand-new company": a company that already
// has a subscription row (grandfathered, already trialing/active, or
// lapsed) is left completely untouched, so this can never reset an
// existing customer's plan or period back to a fresh trial. Only a company
// with no row at all -- true first login -- gets one inserted. Granted at
// the Pro plan (not Standard) so the trial shows the full product,
// including WhatsApp, rather than undersell it before the customer picks a
// tier.
export async function grantTrialIfNewCompany(companyId: string): Promise<void> {
  const sql = getSql();
  const now = new Date();
  const periodEnd = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000);
  await sql`
    INSERT INTO subscriptions (
      company_id, status, plan, current_period_end, created_at, updated_at
    ) VALUES (
      ${companyId}, 'trialing', 'pro', ${periodEnd.toISOString()}, ${now.toISOString()}, ${now.toISOString()}
    )
    ON CONFLICT (company_id) DO NOTHING
  `;
}
