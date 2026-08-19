import { runtimeEnv } from "trackfleet-runtime-env";
import type { StoredCompanySession } from "./auth-session-store.shared-postgres";

type D1ReadStatement = {
  bind(...values: unknown[]): D1ReadStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
};

type D1ReadBinding = {
  prepare(query: string): D1ReadStatement;
};

function db() {
  const binding = (runtimeEnv as unknown as { DB?: D1ReadBinding }).DB;
  if (!binding) throw new Error("D1 database binding is missing");
  return binding;
}

export async function getStandbySessionFromD1(tokenHash: string): Promise<StoredCompanySession | null> {
  const row = await db().prepare(`SELECT token_hash AS tokenHash, company_id AS companyId,
      account_label AS accountLabel, user_label AS userLabel,
      credentials_ciphertext AS credentialsCiphertext, expires_at AS expiresAt
    FROM sessions WHERE token_hash = ? LIMIT 1`)
    .bind(tokenHash)
    .first<{
      tokenHash: string;
      companyId: string;
      accountLabel: string | null;
      userLabel: string | null;
      credentialsCiphertext: string | null;
      expiresAt: number;
    }>();

  if (!row || !row.accountLabel || !row.userLabel || !row.credentialsCiphertext) return null;
  if (row.expiresAt <= Date.now()) return null;

  return {
    tokenHash: row.tokenHash,
    companyId: row.companyId,
    accountLabel: row.accountLabel,
    userLabel: row.userLabel,
    credentialsCiphertext: row.credentialsCiphertext,
    expiresAt: new Date(row.expiresAt),
  };
}
