import { neon } from "@neondatabase/serverless";

export type ArrivalCompletionObservation = {
  companyId: string;
  deliveryId: string;
  insideArrivalZone: boolean;
  observationAt: Date;
  unloadGraceMinutes: number;
};

export type ArrivalCompletionResult = {
  justEntered: boolean;
  deliveredNow: boolean;
  arrivalSiteSince: Date | null;
};

const maxContinuousObservationGapMs = 30 * 60_000;
let schemaPromise: Promise<void> | null = null;

function sqlClient() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required for delivery completion");
  return neon(databaseUrl);
}

async function ensureSchema() {
  const sql = sqlClient();
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS delivery_arrival_state (
        company_id text NOT NULL,
        delivery_id text NOT NULL,
        arrived_at timestamptz NOT NULL,
        last_observed_at timestamptz NOT NULL,
        PRIMARY KEY (company_id, delivery_id)
      )`;
      await sql`ALTER TABLE delivery_arrival_state ADD COLUMN IF NOT EXISTS last_observed_at timestamptz`;
      await sql`UPDATE delivery_arrival_state SET last_observed_at = arrived_at WHERE last_observed_at IS NULL`;
      await sql`ALTER TABLE delivery_arrival_state ALTER COLUMN last_observed_at SET NOT NULL`;
      await sql`CREATE INDEX IF NOT EXISTS idx_delivery_arrival_state_arrived_at ON delivery_arrival_state(arrived_at)`;
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
  return sql;
}

async function clearArrivalState(sql: ReturnType<typeof sqlClient>, companyId: string, deliveryId: string) {
  await Promise.all([
    sql`DELETE FROM delivery_arrival_state WHERE company_id = ${companyId} AND delivery_id = ${deliveryId}`,
    sql`DELETE FROM delivery_events
      WHERE delivery_id = ${deliveryId} AND type = 'ARRIVED_AT_SITE'
        AND EXISTS (SELECT 1 FROM deliveries WHERE id = ${deliveryId} AND company_id = ${companyId})`,
  ]);
}

export async function observeArrivalCompletion(input: ArrivalCompletionObservation): Promise<ArrivalCompletionResult> {
  const sql = await ensureSchema();
  if (!input.insideArrivalZone) {
    await clearArrivalState(sql, input.companyId, input.deliveryId);
    return { justEntered: false, deliveredNow: false, arrivalSiteSince: null };
  }

  const rows = await sql`SELECT arrived_at, last_observed_at FROM delivery_arrival_state
    WHERE company_id = ${input.companyId} AND delivery_id = ${input.deliveryId} LIMIT 1` as Array<{
      arrived_at: string | Date;
      last_observed_at: string | Date;
    }>;
  const existing = rows[0];
  const observationMs = input.observationAt.getTime();
  const previousObservedMs = existing ? new Date(existing.last_observed_at).getTime() : NaN;
  const continuityBroken = !existing
    || !Number.isFinite(previousObservedMs)
    || observationMs < previousObservedMs
    || observationMs - previousObservedMs > maxContinuousObservationGapMs;

  const arrivalSiteSince = continuityBroken ? input.observationAt : new Date(existing.arrived_at);
  if (continuityBroken) {
    await sql`DELETE FROM delivery_events
      WHERE delivery_id = ${input.deliveryId} AND type = 'ARRIVED_AT_SITE'
        AND EXISTS (SELECT 1 FROM deliveries WHERE id = ${input.deliveryId} AND company_id = ${input.companyId})`;
    await sql`INSERT INTO delivery_arrival_state (company_id, delivery_id, arrived_at, last_observed_at)
      VALUES (${input.companyId}, ${input.deliveryId}, ${input.observationAt.toISOString()}, ${input.observationAt.toISOString()})
      ON CONFLICT (company_id, delivery_id) DO UPDATE SET
        arrived_at = EXCLUDED.arrived_at,
        last_observed_at = EXCLUDED.last_observed_at`;
  } else {
    await sql`UPDATE delivery_arrival_state SET last_observed_at = ${input.observationAt.toISOString()}
      WHERE company_id = ${input.companyId} AND delivery_id = ${input.deliveryId}`;
  }

  const elapsedMinutes = Math.max(0, (observationMs - arrivalSiteSince.getTime()) / 60_000);
  if (elapsedMinutes < input.unloadGraceMinutes) {
    return { justEntered: continuityBroken, deliveredNow: false, arrivalSiteSince };
  }

  const completed = await sql`WITH updated AS (
      UPDATE deliveries SET status = 'Delivered', progress = 100
      WHERE id = ${input.deliveryId} AND company_id = ${input.companyId} AND status <> 'Delivered'
      RETURNING id
    ), arrived_event AS (
      INSERT INTO delivery_events (delivery_id, type, progress, created_at)
      SELECT id, 'ARRIVED', 100, ${input.observationAt.toISOString()} FROM updated
      ON CONFLICT (delivery_id, type) DO NOTHING
      RETURNING delivery_id
    )
    SELECT id FROM updated` as Array<{ id: string }>;

  if (completed.length) {
    await sql`DELETE FROM delivery_arrival_state WHERE company_id = ${input.companyId} AND delivery_id = ${input.deliveryId}`;
  }
  return { justEntered: false, deliveredNow: completed.length > 0, arrivalSiteSince };
}

export async function completeDeliveryManually(companyId: string, deliveryId: string) {
  const sql = await ensureSchema();
  const now = new Date().toISOString();
  const completed = await sql`WITH updated AS (
      UPDATE deliveries SET status = 'Delivered', progress = 100
      WHERE id = ${deliveryId} AND company_id = ${companyId} AND status <> 'Delivered'
      RETURNING id
    ), manual_event AS (
      INSERT INTO delivery_events (delivery_id, type, progress, created_at)
      SELECT id, 'MANUAL_DELIVERED', 100, ${now} FROM updated
      ON CONFLICT (delivery_id, type) DO NOTHING
      RETURNING delivery_id
    ), arrived_event AS (
      INSERT INTO delivery_events (delivery_id, type, progress, created_at)
      SELECT id, 'ARRIVED', 100, ${now} FROM updated
      ON CONFLICT (delivery_id, type) DO NOTHING
      RETURNING delivery_id
    )
    SELECT id FROM updated` as Array<{ id: string }>;
  if (!completed.length) return false;
  await sql`DELETE FROM delivery_arrival_state WHERE company_id = ${companyId} AND delivery_id = ${deliveryId}`;
  return true;
}
