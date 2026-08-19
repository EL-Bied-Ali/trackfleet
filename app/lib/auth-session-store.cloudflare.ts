import { runtimeEnv } from "trackfleet-runtime-env";

export type StoredCompanySession = {
  tokenHash: string;
  companyId: string;
  accountLabel: string;
  userLabel: string;
  credentialsCiphertext: string;
  expiresAt: Date;
};

async function ensureSessionColumns(db: D1Database) {
  const result = await db.prepare("PRAGMA table_info(sessions)").all<{ name: string }>();
  const columns = new Set((result.results ?? []).map((column) => column.name));
  if (!columns.has("account_label")) await db.prepare("ALTER TABLE sessions ADD COLUMN account_label text").run();
  if (!columns.has("user_label")) await db.prepare("ALTER TABLE sessions ADD COLUMN user_label text").run();
  if (!columns.has("credentials_ciphertext")) await db.prepare("ALTER TABLE sessions ADD COLUMN credentials_ciphertext text").run();
}

async function ensureSchema() {
  const db = runtimeEnv.DB;
  if (!db) throw new Error("Cloudflare D1 binding `DB` is required for server sessions");
  await db.prepare(`CREATE TABLE IF NOT EXISTS sessions (
    token_hash text PRIMARY KEY NOT NULL,
    company_id text NOT NULL,
    account_label text,
    user_label text,
    credentials_ciphertext text,
    expires_at integer NOT NULL,
    created_at integer NOT NULL
  )`).run();
  await ensureSessionColumns(db);
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_sessions_company_id ON sessions(company_id)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at)").run();
  return db;
}

export async function createServerSession(input: StoredCompanySession) {
  const db = await ensureSchema();
  const now = Date.now();
  await db.batch([
    db.prepare(`INSERT INTO sessions (
      token_hash, company_id, account_label, user_label, credentials_ciphertext, expires_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(input.tokenHash, input.companyId, input.accountLabel, input.userLabel, input.credentialsCiphertext, input.expiresAt.getTime(), now),
    db.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now),
  ]);
}

export async function getServerSession(tokenHash: string): Promise<StoredCompanySession | null> {
  const db = await ensureSchema();
  const row = await db.prepare(`SELECT token_hash AS tokenHash, company_id AS companyId, expires_at AS expiresAt,
      account_label AS accountLabel, user_label AS userLabel, credentials_ciphertext AS credentialsCiphertext
    FROM sessions WHERE token_hash = ? LIMIT 1`)
    .bind(tokenHash)
    .first<{
      tokenHash: string;
      companyId: string;
      expiresAt: number;
      accountLabel: string | null;
      userLabel: string | null;
      credentialsCiphertext: string | null;
    }>();
  if (!row || !row.accountLabel || !row.userLabel || !row.credentialsCiphertext) return null;
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
