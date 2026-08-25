import { neon } from "@neondatabase/serverless";

// "grandfathered" exists solely for companies that were already using
// TrackFleet before subscriptions were enforced -- assigned once, directly
// in production, for every row in `companies` at the time this shipped (see
// the PR that introduced this file). Never assigned by any code path here;
// a company with no row at all (the default for anyone new) is NOT active
// and must actually subscribe.
export type SubscriptionStatus = "grandfathered" | "trialing" | "active" | "past_due" | "canceled";

export type Subscription = {
  companyId: string;
  status: SubscriptionStatus;
  plan: string | null;
  paddleCustomerId: string | null;
  paddleSubscriptionId: string | null;
  currentPeriodEnd: Date | null;
};

function sqlClient() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required for subscriptions");
  return neon(databaseUrl);
}

function isSubscriptionStatus(value: unknown): value is SubscriptionStatus {
  return value === "grandfathered" || value === "trialing" || value === "active" || value === "past_due" || value === "canceled";
}

// Only these statuses grant access to the dashboard -- past_due/canceled
// (and no row at all) do not. Kept as its own function rather than inlined
// at each call site so the actual access rule lives in exactly one place.
export function subscriptionGrantsAccess(status: SubscriptionStatus | null) {
  return status === "grandfathered" || status === "trialing" || status === "active";
}

export async function getSubscription(companyId: string): Promise<Subscription | null> {
  const sql = sqlClient();
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
};

// Admin-only (see app/api/admin/companies/route.ts) -- every company, not
// scoped to one tenant, which is exactly what makes this admin-only rather
// than something any dispatcher session could call.
export async function listCompaniesWithSubscriptions(): Promise<CompanyWithSubscription[]> {
  const sql = sqlClient();
  const rows = await sql`
    SELECT c.id AS company_id, c.account_label, c.user_label, c.created_at,
           s.status, s.plan, s.current_period_end
    FROM companies c
    LEFT JOIN subscriptions s ON s.company_id = c.id
    ORDER BY c.created_at DESC
  ` as Array<{
    company_id: string;
    account_label: string;
    user_label: string;
    created_at: string | Date;
    status: string | null;
    plan: string | null;
    current_period_end: string | Date | null;
  }>;
  return rows.map((row) => ({
    companyId: row.company_id,
    accountLabel: row.account_label,
    userLabel: row.user_label,
    createdAt: new Date(row.created_at),
    subscriptionStatus: isSubscriptionStatus(row.status) ? row.status : null,
    plan: row.plan,
    currentPeriodEnd: row.current_period_end ? new Date(row.current_period_end) : null,
  }));
}

// Admin-only: fetches a company's stored, encrypted SENDATRACK credentials
// so an admin can mint a normal session on that company's behalf (see
// app/api/admin/companies/impersonate/route.ts) without ever seeing the
// plaintext password themselves -- decryption happens inside
// createCompanySession's own call chain, same as a normal login.
export async function getCompanyCredentialsCiphertext(companyId: string): Promise<string | null> {
  const sql = sqlClient();
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
  const sql = sqlClient();
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
