export const D1_STANDBY_MAX_SYNC_AGE_MS = 30 * 60_000;

type D1ReadinessStatement = {
  bind(...values: unknown[]): D1ReadinessStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
};

export type D1ReadinessBinding = {
  prepare(query: string): D1ReadinessStatement;
};

type D1ReadinessProbe = {
  operational_success_at: number | null;
  operational_failure_at: number | null;
  telemetry_success_at: number | null;
  telemetry_failure_at: number | null;
  company_count: number;
  completed_company_count: number;
  incomplete_company_count: number;
};

export type D1StandbyReadiness = {
  ready: boolean;
  reason: "ready" | "replication_not_started" | "replication_stale" | "history_backfill_incomplete";
  operationalLastSuccessAt: number | null;
  telemetryLastSuccessAt: number | null;
  operationalFresh: boolean;
  telemetryFresh: boolean;
  history: {
    companies: number;
    completedCompanies: number;
    complete: boolean;
  };
};

function successfulAndFresh(successAt: number | null, failureAt: number | null, now: number) {
  if (!successAt) return false;
  if (failureAt && failureAt > successAt) return false;
  return now - successAt <= D1_STANDBY_MAX_SYNC_AGE_MS;
}

export async function getD1StandbyReadiness(db: D1ReadinessBinding, now = Date.now()): Promise<D1StandbyReadiness> {
  const row = await db.prepare(`SELECT
      (SELECT last_success_at FROM automation_runtime_state WHERE id = 'd1_reconciliation') AS operational_success_at,
      (SELECT last_failure_at FROM automation_runtime_state WHERE id = 'd1_reconciliation') AS operational_failure_at,
      (SELECT last_success_at FROM automation_runtime_state WHERE id = 'd1_telemetry_reconciliation') AS telemetry_success_at,
      (SELECT last_failure_at FROM automation_runtime_state WHERE id = 'd1_telemetry_reconciliation') AS telemetry_failure_at,
      (SELECT COUNT(*) FROM (
        SELECT DISTINCT company_id FROM deliveries WHERE company_id IS NOT NULL AND company_id <> ''
      )) AS company_count,
      (SELECT COUNT(*) FROM (
        SELECT DISTINCT deliveries.company_id
        FROM deliveries
        JOIN d1_history_backfill_state state ON state.company_id = deliveries.company_id
        WHERE deliveries.company_id IS NOT NULL AND deliveries.company_id <> '' AND state.completed_at IS NOT NULL
      )) AS completed_company_count,
      (SELECT COUNT(*) FROM (
        SELECT DISTINCT deliveries.company_id
        FROM deliveries
        LEFT JOIN d1_history_backfill_state state ON state.company_id = deliveries.company_id
        WHERE deliveries.company_id IS NOT NULL AND deliveries.company_id <> '' AND state.completed_at IS NULL
      )) AS incomplete_company_count
    `).first<D1ReadinessProbe>();

  const operationalLastSuccessAt = row?.operational_success_at ?? null;
  const telemetryLastSuccessAt = row?.telemetry_success_at ?? null;
  const operationalFresh = successfulAndFresh(operationalLastSuccessAt, row?.operational_failure_at ?? null, now);
  const telemetryFresh = successfulAndFresh(telemetryLastSuccessAt, row?.telemetry_failure_at ?? null, now);
  const companies = Number(row?.company_count ?? 0);
  const completedCompanies = Number(row?.completed_company_count ?? 0);
  const historyComplete = Number(row?.incomplete_company_count ?? 0) === 0;

  let reason: D1StandbyReadiness["reason"] = "ready";
  if (!operationalLastSuccessAt || !telemetryLastSuccessAt) reason = "replication_not_started";
  else if (!operationalFresh || !telemetryFresh) reason = "replication_stale";
  else if (!historyComplete) reason = "history_backfill_incomplete";

  return {
    ready: reason === "ready",
    reason,
    operationalLastSuccessAt,
    telemetryLastSuccessAt,
    operationalFresh,
    telemetryFresh,
    history: { companies, completedCompanies, complete: historyComplete },
  };
}
