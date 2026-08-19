import { neon } from "@neondatabase/serverless";
import { runtimeEnv } from "trackfleet-runtime-env";
import { reconcileD1Standby, type D1ReconciliationResult } from "./d1-reconciliation";

// Keep these equal to the bounded reconciliation limits. The contract test
// intentionally checks both files so a future limit change cannot silently
// make readiness claim more coverage than the repair pass actually provides.
export const D1_RECONCILIATION_MAX_COMPANIES = 5;
export const D1_RECONCILIATION_MAX_ACTIVE_SESSIONS = 200;

type D1Statement = {
  bind(...values: unknown[]): D1Statement;
  run(): Promise<unknown>;
};

type D1Binding = {
  prepare(query: string): D1Statement;
};

type CoverageRow = {
  company_count: number | string;
  active_session_count: number | string;
};

function d1() {
  return (runtimeEnv as unknown as { DB?: D1Binding }).DB ?? null;
}

function databaseUrl() {
  return runtimeEnv.DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim() || "";
}

async function recordCoverageFailure(db: D1Binding, attemptedAt: number) {
  await db.prepare(`INSERT INTO automation_runtime_state (id, last_attempt_at, last_failure_at)
    VALUES ('d1_reconciliation', ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      last_attempt_at = excluded.last_attempt_at,
      last_failure_at = excluded.last_failure_at`)
    .bind(attemptedAt, Date.now())
    .run();
}

export async function reconcileD1StandbySafely(): Promise<D1ReconciliationResult> {
  const db = d1();
  const url = databaseUrl();
  if (!db || !url) return reconcileD1Standby();

  const sql = neon(url);
  const rows = await sql`SELECT
      (SELECT COUNT(DISTINCT company_id) FROM deliveries
        WHERE company_id IS NOT NULL AND company_id <> '') AS company_count,
      (SELECT COUNT(*) FROM sessions WHERE expires_at > NOW()) AS active_session_count`
    .then((result) => result as unknown as CoverageRow[]);
  const coverage = rows[0];
  const companyCount = Number(coverage?.company_count ?? 0);
  const activeSessionCount = Number(coverage?.active_session_count ?? 0);

  if (
    companyCount > D1_RECONCILIATION_MAX_COMPANIES
    || activeSessionCount > D1_RECONCILIATION_MAX_ACTIVE_SESSIONS
  ) {
    const attemptedAt = Date.now();
    try {
      await recordCoverageFailure(db, attemptedAt);
    } catch (error) {
      console.error("[trackfleet:replication] failed to record D1 coverage failure", {
        message: error instanceof Error ? error.message : "unknown_error",
      });
    }
    console.error("[trackfleet:replication] D1 reconciliation coverage exceeded", {
      companyCount,
      maxCompanies: D1_RECONCILIATION_MAX_COMPANIES,
      activeSessionCount,
      maxActiveSessions: D1_RECONCILIATION_MAX_ACTIVE_SESSIONS,
    });
    throw new Error("d1_reconciliation_coverage_exceeded");
  }

  return reconcileD1Standby();
}
