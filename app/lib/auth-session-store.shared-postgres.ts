import "./postgres-runtime-bootstrap";
import { runtimeEnv } from "trackfleet-runtime-env";
import {
  createServerSession as createPrimarySession,
  deleteServerSession as deletePrimarySession,
  renewServerSession as renewPrimarySession,
  getServerSession,
  getCompanyBranding,
  updateCompanyBranding as updatePrimaryCompanyBranding,
  getCompanyAutomationSettings,
  updateCompanyAutomationSettings as updatePrimaryCompanyAutomationSettings,
  type StoredCompanySession,
  type CompanyBranding,
  type CompanyAutomationSettings,
} from "./auth-session-store.vercel";

type D1MirrorStatement = {
  bind(...values: unknown[]): D1MirrorStatement;
  run(): Promise<unknown>;
};

type D1MirrorBinding = {
  prepare(query: string): D1MirrorStatement;
  batch(statements: D1MirrorStatement[]): Promise<unknown>;
};

function d1() {
  return (runtimeEnv as unknown as { DB?: D1MirrorBinding }).DB ?? null;
}

async function mirrorCreate(input: StoredCompanySession) {
  const db = d1();
  if (!db) return;
  const now = Date.now();
  try {
    await db.batch([
      db.prepare(`INSERT INTO companies (
        id, account_label, user_label, credentials_ciphertext, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        account_label = excluded.account_label,
        user_label = excluded.user_label,
        credentials_ciphertext = excluded.credentials_ciphertext,
        updated_at = excluded.updated_at`)
        .bind(input.companyId, input.accountLabel, input.userLabel, input.credentialsCiphertext, now, now),
      db.prepare(`INSERT INTO sessions (
        token_hash, company_id, account_label, user_label, credentials_ciphertext, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(token_hash) DO UPDATE SET
        company_id = excluded.company_id,
        account_label = excluded.account_label,
        user_label = excluded.user_label,
        credentials_ciphertext = excluded.credentials_ciphertext,
        expires_at = excluded.expires_at`)
        .bind(input.tokenHash, input.companyId, input.accountLabel, input.userLabel, input.credentialsCiphertext, input.expiresAt.getTime(), now),
      db.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now),
    ]);
  } catch (error) {
    console.error("[trackfleet:replication] D1 session mirror failed", {
      message: error instanceof Error ? error.message : "unknown_error",
    });
  }
}

async function mirrorDelete(tokenHash: string) {
  const db = d1();
  if (!db) return;
  try {
    await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
  } catch (error) {
    console.error("[trackfleet:replication] D1 session delete mirror failed", {
      message: error instanceof Error ? error.message : "unknown_error",
    });
  }
}

async function mirrorRenew(tokenHash: string, expiresAt: Date) {
  const db = d1();
  if (!db) return;
  try {
    await db.prepare("UPDATE sessions SET expires_at = ? WHERE token_hash = ?").bind(expiresAt.getTime(), tokenHash).run();
  } catch (error) {
    console.error("[trackfleet:replication] D1 session renewal mirror failed", {
      message: error instanceof Error ? error.message : "unknown_error",
    });
  }
}

export async function createServerSession(input: StoredCompanySession) {
  await createPrimarySession(input);
  await mirrorCreate(input);
}

export async function deleteServerSession(tokenHash: string) {
  await deletePrimarySession(tokenHash);
  await mirrorDelete(tokenHash);
}

export async function renewServerSession(tokenHash: string, expiresAt: Date) {
  await renewPrimarySession(tokenHash, expiresAt);
  await mirrorRenew(tokenHash, expiresAt);
}

async function mirrorBranding(companyId: string, input: CompanyBranding) {
  const db = d1();
  if (!db) return;
  try {
    await db.prepare(`UPDATE companies SET brand_name = ?, brand_logo_data_url = ?, brand_color = ?, updated_at = ? WHERE id = ?`)
      .bind(input.name, input.logoDataUrl, input.color, Date.now(), companyId)
      .run();
  } catch (error) {
    console.error("[trackfleet:replication] D1 company branding mirror failed", {
      message: error instanceof Error ? error.message : "unknown_error",
    });
  }
}

export async function updateCompanyBranding(companyId: string, input: CompanyBranding) {
  await updatePrimaryCompanyBranding(companyId, input);
  await mirrorBranding(companyId, input);
}

function tristateToD1(value: boolean | null): number | null {
  return value === null ? null : (value ? 1 : 0);
}

async function mirrorAutomationSettings(companyId: string, input: CompanyAutomationSettings) {
  const db = d1();
  if (!db) return;
  try {
    await db.prepare(`UPDATE companies SET unload_grace_minutes = ?, ctm_relay_grace_minutes = ?, ctm_relay_auto_completion_enabled = ?, updated_at = ? WHERE id = ?`)
      .bind(input.unloadGraceMinutes, input.ctmRelayGraceMinutes, tristateToD1(input.ctmRelayAutoCompletionEnabled), Date.now(), companyId)
      .run();
  } catch (error) {
    console.error("[trackfleet:replication] D1 company automation settings mirror failed", {
      message: error instanceof Error ? error.message : "unknown_error",
    });
  }
}

export async function updateCompanyAutomationSettings(companyId: string, input: CompanyAutomationSettings) {
  await updatePrimaryCompanyAutomationSettings(companyId, input);
  await mirrorAutomationSettings(companyId, input);
}

export { getServerSession, getCompanyBranding, getCompanyAutomationSettings };
export type { StoredCompanySession, CompanyBranding, CompanyAutomationSettings };
