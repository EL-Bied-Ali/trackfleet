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
        PRIMARY KEY (company_id, delivery_id)
      )`;
      await sql`CREATE INDEX IF NOT EXISTS idx_delivery_arrival_state_arrived_at ON delivery_arrival_state(arrived_at)`;
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
  return sql;
}

export async function observeArrivalCompletion(input: ArrivalCompletionObservation): Promise<ArrivalCompletionResult> {
  const sql = await ensureSchema();
  if (!input.insideArrivalZone) {
    await sql`DELETE FROM delivery_arrival_state WHERE company_id = ${input.companyId} AND delivery_id = ${input.deliveryId}`;
    return { justEntered: false, deliveredNow: false, arrivalSiteSince: null };
  }

  const inserted = await sql`INSERT INTO delivery_arrival_state (company_id, delivery_id, arrived_at)
    VALUES (${input.companyId}, ${input.deliveryId}, ${input.observationAt.toISOString()})
    ON CONFLICT (company_id, delivery_id) DO NOTHING
    RETURNING delivery_id` as Array<{ delivery_id: string }>;
  const rows = await sql`SELECT arrived_at FROM delivery_arrival_state
    WHERE company_id = ${input.companyId} AND delivery_id = ${input.deliveryId} LIMIT 1` as Array<{ arrived_at: string | Date }>;
  const arrivalSiteSince = rows[0] ? new Date(rows[0].arrived_at) : input.observationAt;
  const elapsedMinutes = Math.max(0, (input.observationAt.getTime() - arrivalSiteSince.getTime()) / 60_000);
  if (elapsedMinutes < input.unloadGraceMinutes) {
    return { justEntered: inserted.length > 0, deliveredNow: false, arrivalSiteSince };
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
  return { justEntered: inserted.length > 0, deliveredNow: completed.length > 0, arrivalSiteSince };
}

export async function completeDeliveryManually(companyId: string, deliveryId: string) {
  const sql = await ensureSchema();
  const completed = await sql`WITH updated AS (
      UPDATE deliveries SET status = 'Delivered', progress = 100
      WHERE id = ${deliveryId} AND company_id = ${companyId} AND status <> 'Delivered'
      RETURNING id
    ), manual_event AS (
      INSERT INTO delivery_events (delivery_id, type, progress, created_at)
      SELECT id, 'MANUAL_DELIVERED', 100, ${new Date().toISOString()} FROM updated
      ON CONFLICT (delivery_id, type) DO NOTHING
      RETURNING delivery_id
    ), arrived_event AS (
      INSERT INTO delivery_events (delivery_id, type, progress, created_at)
      SELECT id, 'ARRIVED', 100, ${new Date().toISOString()} FROM updated
      ON CONFLICT (delivery_id, type) DO NOTHING
      RETURNING delivery_id
    )
    SELECT id FROM updated` as Array<{ id: string }>;
  if (!completed.length) return false;
  await sql`DELETE FROM delivery_arrival_state WHERE company_id = ${companyId} AND delivery_id = ${deliveryId}`;
  return true;
}
