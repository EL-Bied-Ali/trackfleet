import { runtimeEnv } from "trackfleet-runtime-env";

export type StoredCompanySession = {
  tokenHash: string;
  companyId: string;
  accountLabel: string;
  userLabel: string;
  credentialsCiphertext: string;
  expiresAt: Date;
};

async function ensureSchema() {
  const db = runtimeEnv.DB;
  if (!db) throw new Error("Cloudflare D1 binding `DB` is required for server sessions");
  await db.prepare(`CREATE TABLE IF NOT EXISTS companies (
    id text PRIMARY KEY NOT NULL,
    account_label text NOT NULL,
    user_label text NOT NULL,
    credentials_ciphertext text NOT NULL,
    created_at integer NOT NULL,
    updated_at integer NOT NULL
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS sessions (
    token_hash text PRIMARY KEY NOT NULL,
    company_id text NOT NULL,
    expires_at integer NOT NULL,
    created_at integer NOT NULL
  )`).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_sessions_company_id ON sessions(company_id)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at)").run();
  return db;
}

export async function createServerSession(input: StoredCompanySession) {
  const db = await ensureSchema();
  const now = Date.now();
  await db.batch([
    db.prepare(`INSERT INTO companies (id, account_label, user_label, credentials_ciphertext, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        account_label = excluded.account_label,
        user_label = excluded.user_label,
        credentials_ciphertext = excluded.credentials_ciphertext,
        updated_at = excluded.updated_at`)
      .bind(input.companyId, input.accountLabel, input.userLabel, input.credentialsCiphertext, now, now),
    db.prepare("INSERT INTO sessions (token_hash, company_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
      .bind(input.tokenHash, input.companyId, input.expiresAt.getTime(), now),
    db.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now),
  ]);
}

export async function getServerSession(tokenHash: string): Promise<StoredCompanySession | null> {
  const db = await ensureSchema();
  const row = await db.prepare(`SELECT s.token_hash AS tokenHash, s.company_id AS companyId, s.expires_at AS expiresAt,
      c.account_label AS accountLabel, c.user_label AS userLabel, c.credentials_ciphertext AS credentialsCiphertext
    FROM sessions s JOIN companies c ON c.id = s.company_id
    WHERE s.token_hash = ? LIMIT 1`)
    .bind(tokenHash)
    .first<{
      tokenHash: string;
      companyId: string;
      expiresAt: number;
      accountLabel: string;
      userLabel: string;
      credentialsCiphertext: string;
    }>();
  if (!row) return null;
  return {
    tokenHash: row.tokenHash,
    companyId: row.companyId,
    accountLabel: row.accountLabel,
    userLabel: row.userLabel,
    credentialsCiphertext: row.credentialsCiphertext,
    expiresAt: new Date(row.expiresAt),
  };
}

export async function deleteServerSession(tokenHash: string) {
  const db = await ensureSchema();
  await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
}
