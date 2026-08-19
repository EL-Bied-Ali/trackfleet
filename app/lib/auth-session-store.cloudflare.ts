import { runtimeEnv } from "trackfleet-runtime-env";

export type StoredCompanySession = {
  tokenHash: string;
  companyId: string;
  accountLabel: string;
  userLabel: string;
  credentialsCiphertext: string;
  expiresAt: Date;
};

function database() {
  const db = runtimeEnv.DB;
  if (!db) throw new Error("Cloudflare D1 binding `DB` is required for server sessions");
  return db;
}

export async function createServerSession(input: StoredCompanySession) {
  const db = database();
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
  const db = database();
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
  const db = database();
  await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
}
