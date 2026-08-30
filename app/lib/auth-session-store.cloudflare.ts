import { runtimeEnv } from "trackfleet-runtime-env";

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

export async function renewServerSession(tokenHash: string, expiresAt: Date) {
  const db = database();
  await db.prepare("UPDATE sessions SET expires_at = ? WHERE token_hash = ?").bind(expiresAt.getTime(), tokenHash).run();
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

// This D1-only variant (no Postgres primary) never wrote a `companies` row
// in the first place -- see createServerSession above, which only tracks
// `sessions`. Branding is a display nicety, not core functionality, so this
// stays a no-op here rather than adding a companies table to a deploy
// target production doesn't actually use.
export async function getCompanyBranding(_companyId: string): Promise<CompanyBranding | null> {
  return null;
}

export async function updateCompanyBranding(_companyId: string, _input: CompanyBranding): Promise<void> {}

export async function getCompanyAutomationSettings(_companyId: string): Promise<CompanyAutomationSettings | null> {
  return null;
}

export async function updateCompanyAutomationSettings(_companyId: string, _input: CompanyAutomationSettings): Promise<void> {}
