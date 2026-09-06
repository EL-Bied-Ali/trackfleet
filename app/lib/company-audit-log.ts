import { getSql } from "./pg-client.ts";

export type CompanyAuditAction =
  | "delivery_deleted"
  | "arrival_confirmed_missing_scans_bypassed"
  | "arrival_confirmed_location_mismatch_bypassed";

export type CompanyAuditLogEntry = {
  id: number;
  companyId: string;
  actor: string;
  action: CompanyAuditAction;
  deliveryId: string | null;
  deliveryCustomer: string | null;
  deliveryDestination: string | null;
  detail: string | null;
  createdAt: string;
};

let schemaPromise: Promise<void> | null = null;

// Deliberately NOT gated behind delivery-store.postgres.ts's
// TRACKFLEET_RUNTIME_SCHEMA_BOOTSTRAP flag -- that guard exists because
// THAT file's ensureSchema runs dozens of CREATE/ALTER statements per cold
// start, a real subrequest-budget risk (see its own comment). This table
// is a single CREATE TABLE + one index, memoized like login_rate_limits'
// own ensureSchema, so it self-heals at request time the same way that
// table does.
async function ensureSchema() {
  if (schemaPromise) return schemaPromise;
  const sql = getSql();
  schemaPromise = (async () => {
    await sql`CREATE TABLE IF NOT EXISTS company_audit_log (
      id bigserial PRIMARY KEY,
      company_id text NOT NULL,
      actor text NOT NULL,
      action text NOT NULL,
      delivery_id text,
      delivery_customer text,
      delivery_destination text,
      detail text,
      created_at timestamptz NOT NULL
    )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_company_audit_log_company_created ON company_audit_log(company_id, created_at DESC)`;
  })();
  return schemaPromise;
}

// Live request: "can't we attribute actions to the google accounts" --
// the sensitive, hard-to-reverse dispatcher actions (deleting a delivery,
// confirming arrival despite a missing-scans or location-mismatch
// warning) get their actor recorded here. Fire-and-forget from the
// caller's perspective, same convention as admin-audit-log.ts: logging
// failure must never block the underlying action, only get reported.
export async function logCompanyAction(input: {
  companyId: string;
  actor: string;
  action: CompanyAuditAction;
  deliveryId?: string | null;
  deliveryCustomer?: string | null;
  deliveryDestination?: string | null;
  detail?: string | null;
}) {
  try {
    await ensureSchema();
    const sql = getSql();
    await sql`INSERT INTO company_audit_log
      (company_id, actor, action, delivery_id, delivery_customer, delivery_destination, detail, created_at)
      VALUES (${input.companyId}, ${input.actor}, ${input.action}, ${input.deliveryId ?? null},
        ${input.deliveryCustomer ?? null}, ${input.deliveryDestination ?? null}, ${input.detail ?? null},
        ${new Date().toISOString()})`;
  } catch (error) {
    console.error("[trackfleet:company-audit-log] write failed", {
      action: input.action, companyId: input.companyId,
      message: error instanceof Error ? error.message : "unknown_error",
    });
  }
}

type RawEntry = {
  id: string | number;
  company_id: string;
  actor: string;
  action: CompanyAuditAction;
  delivery_id: string | null;
  delivery_customer: string | null;
  delivery_destination: string | null;
  detail: string | null;
  created_at: string | Date;
};

function hydrate(row: RawEntry): CompanyAuditLogEntry {
  return {
    id: Number(row.id),
    companyId: row.company_id,
    actor: row.actor,
    action: row.action,
    deliveryId: row.delivery_id,
    deliveryCustomer: row.delivery_customer,
    deliveryDestination: row.delivery_destination,
    detail: row.detail,
    createdAt: (row.created_at instanceof Date ? row.created_at : new Date(row.created_at)).toISOString(),
  };
}

const AUDIT_LOG_PAGE_SIZE = 50;

export async function listCompanyAuditLog(companyId: string, options: { beforeId?: number | null } = {}) {
  await ensureSchema();
  const sql = getSql();
  const beforeId = options.beforeId ?? null;
  const rows = beforeId
    ? await sql`SELECT id, company_id, actor, action, delivery_id, delivery_customer, delivery_destination, detail, created_at
        FROM company_audit_log WHERE company_id = ${companyId} AND id < ${beforeId}
        ORDER BY id DESC LIMIT ${AUDIT_LOG_PAGE_SIZE + 1}` as RawEntry[]
    : await sql`SELECT id, company_id, actor, action, delivery_id, delivery_customer, delivery_destination, detail, created_at
        FROM company_audit_log WHERE company_id = ${companyId}
        ORDER BY id DESC LIMIT ${AUDIT_LOG_PAGE_SIZE + 1}` as RawEntry[];
  const hasMore = rows.length > AUDIT_LOG_PAGE_SIZE;
  const pageRows = hasMore ? rows.slice(0, AUDIT_LOG_PAGE_SIZE) : rows;
  const items = pageRows.map(hydrate);
  const last = items.at(-1) ?? null;
  return { items, nextCursor: hasMore && last ? last.id : null };
}
