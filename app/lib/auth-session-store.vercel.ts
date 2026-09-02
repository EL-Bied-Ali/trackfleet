import { getSql } from "./pg-client.ts";

export type StoredCompanySession = {
  tokenHash: string;
  companyId: string;
  accountLabel: string;
  userLabel: string;
  credentialsCiphertext: string;
  expiresAt: Date;
};

export type CompanyBranding = {
  name: string | null;
  logoDataUrl: string | null;
  color: string | null;
};

export type CompanyAutomationSettings = {
  unloadGraceMinutes: number | null;
  ctmRelayGraceMinutes: number | null;
  ctmRelayAutoCompletionEnabled: boolean | null;
};

// Production schema is provisioned separately. Running CREATE/ALTER statements
// on every cold Worker invocation consumes Cloudflare subrequests before useful
// application work begins.
export async function createServerSession(input: StoredCompanySession) {
  const sql = getSql();
  const now = new Date().toISOString();

  await sql`INSERT INTO companies (
      id, account_label, user_label, credentials_ciphertext, created_at, updated_at
    ) VALUES (
      ${input.companyId}, ${input.accountLabel}, ${input.userLabel}, ${input.credentialsCiphertext}, ${now}, ${now}
    ) ON CONFLICT (id) DO UPDATE SET
      account_label = EXCLUDED.account_label,
      user_label = EXCLUDED.user_label,
      credentials_ciphertext = EXCLUDED.credentials_ciphertext,
      updated_at = EXCLUDED.updated_at`;

  await sql`INSERT INTO sessions (
      token_hash, company_id, account_label, user_label, credentials_ciphertext, expires_at, created_at
    ) VALUES (
      ${input.tokenHash}, ${input.companyId}, ${input.accountLabel}, ${input.userLabel}, ${input.credentialsCiphertext}, ${input.expiresAt.toISOString()}, ${now}
    )`;
  await sql`DELETE FROM sessions WHERE expires_at < ${now}`;
}

export async function renewServerSession(tokenHash: string, expiresAt: Date) {
  const sql = getSql();
  await sql`UPDATE sessions SET expires_at = ${expiresAt.toISOString()} WHERE token_hash = ${tokenHash}`;
}

export async function getServerSession(tokenHash: string): Promise<StoredCompanySession | null> {
  const sql = getSql();
  const rows = await sql`SELECT token_hash, company_id, account_label, user_label, credentials_ciphertext, expires_at
    FROM sessions
    WHERE token_hash = ${tokenHash}
    LIMIT 1` as Array<{
      token_hash: string;
      company_id: string;
      account_label: string | null;
      user_label: string | null;
      credentials_ciphertext: string | null;
      expires_at: string | Date;
    }>;
  const row = rows[0];
  if (!row || !row.account_label || !row.user_label || !row.credentials_ciphertext) return null;
  return {
    tokenHash: row.token_hash,
    companyId: row.company_id,
    accountLabel: row.account_label,
    userLabel: row.user_label,
    credentialsCiphertext: row.credentials_ciphertext,
    expiresAt: new Date(row.expires_at),
  };
}

export async function deleteServerSession(tokenHash: string) {
  const sql = getSql();
  await sql`DELETE FROM sessions WHERE token_hash = ${tokenHash}`;
}

// companies.brand_name / brand_logo_data_url / brand_color are provisioned
// the same way as the rest of this table -- see the "Production schema is
// provisioned separately" note above. They must exist in production
// Postgres (via storage-schema-contract.ts's deploy gate) before this code
// ships, not the other way around.
export async function getCompanyBranding(companyId: string): Promise<CompanyBranding | null> {
  const sql = getSql();
  const rows = await sql`SELECT brand_name, brand_logo_data_url, brand_color FROM companies WHERE id = ${companyId} LIMIT 1` as Array<{
    brand_name: string | null;
    brand_logo_data_url: string | null;
    brand_color: string | null;
  }>;
  const row = rows[0];
  if (!row) return null;
  return { name: row.brand_name, logoDataUrl: row.brand_logo_data_url, color: row.brand_color };
}

export async function updateCompanyBranding(companyId: string, input: CompanyBranding): Promise<void> {
  const sql = getSql();
  await sql`UPDATE companies SET brand_name = ${input.name}, brand_logo_data_url = ${input.logoDataUrl}, brand_color = ${input.color}, updated_at = ${new Date().toISOString()} WHERE id = ${companyId}`;
}

// companies.unload_grace_minutes / ctm_relay_grace_minutes /
// ctm_relay_auto_completion_enabled -- same provisioning note as the
// brand_* columns above: must exist in production Postgres (via
// storage-schema-contract.ts's deploy gate) before this code ships. A null
// value on any field means "use the deploy-wide default" (env var for the
// grace minutes, enabled for the toggle) -- see server-automation.ts and
// the manual-completion route for where that fallback is applied.
export async function getCompanyAutomationSettings(companyId: string): Promise<CompanyAutomationSettings | null> {
  const sql = getSql();
  const rows = await sql`SELECT unload_grace_minutes, ctm_relay_grace_minutes, ctm_relay_auto_completion_enabled FROM companies WHERE id = ${companyId} LIMIT 1` as Array<{
    unload_grace_minutes: number | null;
    ctm_relay_grace_minutes: number | null;
    ctm_relay_auto_completion_enabled: boolean | null;
  }>;
  const row = rows[0];
  if (!row) return null;
  return {
    unloadGraceMinutes: row.unload_grace_minutes,
    ctmRelayGraceMinutes: row.ctm_relay_grace_minutes,
    ctmRelayAutoCompletionEnabled: row.ctm_relay_auto_completion_enabled,
  };
}

export async function updateCompanyAutomationSettings(companyId: string, input: CompanyAutomationSettings): Promise<void> {
  const sql = getSql();
  await sql`UPDATE companies SET unload_grace_minutes = ${input.unloadGraceMinutes}, ctm_relay_grace_minutes = ${input.ctmRelayGraceMinutes}, ctm_relay_auto_completion_enabled = ${input.ctmRelayAutoCompletionEnabled}, updated_at = ${new Date().toISOString()} WHERE id = ${companyId}`;
}
