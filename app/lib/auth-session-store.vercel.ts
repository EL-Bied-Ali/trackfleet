import { neon } from "@neondatabase/serverless";

export type StoredCompanySession = {
  tokenHash: string;
  companyId: string;
  accountLabel: string;
  userLabel: string;
  credentialsCiphertext: string;
  expiresAt: Date;
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
