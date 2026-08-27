import { neon } from "@neondatabase/serverless";

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

function sqlClient() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required for server sessions");
  return neon(databaseUrl);
}

// Production schema is provisioned separately. Running CREATE/ALTER statements
// on every cold Worker invocation consumes Cloudflare subrequests before useful
// application work begins.
export async function createServerSession(input: StoredCompanySession) {
  const sql = sqlClient();
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
  const sql = sqlClient();
  await sql`UPDATE sessions SET expires_at = ${expiresAt.toISOString()} WHERE token_hash = ${tokenHash}`;
}

export async function getServerSession(tokenHash: string): Promise<StoredCompanySession | null> {
  const sql = sqlClient();
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
  const sql = sqlClient();
  await sql`DELETE FROM sessions WHERE token_hash = ${tokenHash}`;
}

// companies.brand_name / brand_logo_data_url / brand_color are provisioned
// the same way as the rest of this table -- see the "Production schema is
// provisioned separately" note above. They must exist in production
// Postgres (via storage-schema-contract.ts's deploy gate) before this code
// ships, not the other way around.
export async function getCompanyBranding(companyId: string): Promise<CompanyBranding | null> {
  const sql = sqlClient();
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
  const sql = sqlClient();
  await sql`UPDATE companies SET brand_name = ${input.name}, brand_logo_data_url = ${input.logoDataUrl}, brand_color = ${input.color}, updated_at = ${new Date().toISOString()} WHERE id = ${companyId}`;
}
