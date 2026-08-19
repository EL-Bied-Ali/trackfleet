import { neon } from "@neondatabase/serverless";

export type StoredCompanySession = {
  tokenHash: string;
  companyId: string;
  accountLabel: string;
  userLabel: string;
  credentialsCiphertext: string;
  expiresAt: Date;
};

let schemaPromise: Promise<void> | null = null;

function sqlClient() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required for server sessions");
  return neon(databaseUrl);
}

async function ensureSchema() {
  const sql = sqlClient();
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS sessions (
        token_hash text PRIMARY KEY,
        company_id text NOT NULL,
        account_label text,
        user_label text,
        credentials_ciphertext text,
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL
      )`;
      await sql`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS account_label text`;
      await sql`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_label text`;
      await sql`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS credentials_ciphertext text`;
      await sql`CREATE INDEX IF NOT EXISTS idx_sessions_company_id ON sessions(company_id)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at)`;
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
  return sql;
}

export async function createServerSession(input: StoredCompanySession) {
  const sql = await ensureSchema();
  const now = new Date().toISOString();
  await sql`INSERT INTO sessions (
      token_hash, company_id, account_label, user_label, credentials_ciphertext, expires_at, created_at
    ) VALUES (
      ${input.tokenHash}, ${input.companyId}, ${input.accountLabel}, ${input.userLabel}, ${input.credentialsCiphertext}, ${input.expiresAt.toISOString()}, ${now}
    )`;
  await sql`DELETE FROM sessions WHERE expires_at < ${now}`;
}

export async function getServerSession(tokenHash: string): Promise<StoredCompanySession | null> {
  const sql = await ensureSchema();
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
  const sql = await ensureSchema();
  await sql`DELETE FROM sessions WHERE token_hash = ${tokenHash}`;
}
