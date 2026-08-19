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
      await sql`CREATE TABLE IF NOT EXISTS companies (
        id text PRIMARY KEY,
        account_label text NOT NULL,
        user_label text NOT NULL,
        credentials_ciphertext text NOT NULL,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL
      )`;
      await sql`CREATE TABLE IF NOT EXISTS sessions (
        token_hash text PRIMARY KEY,
        company_id text NOT NULL,
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL
      )`;
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
  await sql`INSERT INTO companies (id, account_label, user_label, credentials_ciphertext, created_at, updated_at)
    VALUES (${input.companyId}, ${input.accountLabel}, ${input.userLabel}, ${input.credentialsCiphertext}, ${now}, ${now})
    ON CONFLICT (id) DO UPDATE SET
      account_label = EXCLUDED.account_label,
      user_label = EXCLUDED.user_label,
      credentials_ciphertext = EXCLUDED.credentials_ciphertext,
      updated_at = EXCLUDED.updated_at`;
  await sql`INSERT INTO sessions (token_hash, company_id, expires_at, created_at)
    VALUES (${input.tokenHash}, ${input.companyId}, ${input.expiresAt.toISOString()}, ${now})`;
  await sql`DELETE FROM sessions WHERE expires_at < ${now}`;
}

export async function getServerSession(tokenHash: string): Promise<StoredCompanySession | null> {
  const sql = await ensureSchema();
  const rows = await sql`SELECT s.token_hash, s.company_id, s.expires_at, c.account_label, c.user_label, c.credentials_ciphertext
    FROM sessions s
    JOIN companies c ON c.id = s.company_id
    WHERE s.token_hash = ${tokenHash}
    LIMIT 1` as Array<{
      token_hash: string;
      company_id: string;
      expires_at: string | Date;
      account_label: string;
      user_label: string;
      credentials_ciphertext: string;
    }>;
  const row = rows[0];
  if (!row) return null;
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
