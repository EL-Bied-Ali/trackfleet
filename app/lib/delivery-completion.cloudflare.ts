import { runtimeEnv } from "trackfleet-runtime-env";

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

function db() {
  if (!runtimeEnv.DB) throw new Error("Cloudflare D1 binding `DB` is required for delivery completion");
  return runtimeEnv.DB;
}

async function ensureSchema() {
  const database = db();
  await database.prepare(`CREATE TABLE IF NOT EXISTS delivery_arrival_state (
    company_id text NOT NULL,
    delivery_id text NOT NULL,
    arrived_at integer NOT NULL,
    PRIMARY KEY (company_id, delivery_id)
  )`).run();
  await database.prepare("CREATE INDEX IF NOT EXISTS idx_delivery_arrival_state_arrived_at ON delivery_arrival_state(arrived_at)").run();
  return database;
}

export async function observeArrivalCompletion(input: ArrivalCompletionObservation): Promise<ArrivalCompletionResult> {
  const database = await ensureSchema();
  if (!input.insideArrivalZone) {
    await database.prepare("DELETE FROM delivery_arrival_state WHERE company_id = ? AND delivery_id = ?")
      .bind(input.companyId, input.deliveryId).run();
    return { justEntered: false, deliveredNow: false, arrivalSiteSince: null };
  }

  const insert = await database.prepare(`INSERT OR IGNORE INTO delivery_arrival_state (company_id, delivery_id, arrived_at)
    VALUES (?, ?, ?)`).bind(input.companyId, input.deliveryId, input.observationAt.getTime()).run();
  const state = await database.prepare(`SELECT arrived_at AS arrivedAt FROM delivery_arrival_state
    WHERE company_id = ? AND delivery_id = ? LIMIT 1`)
    .bind(input.companyId, input.deliveryId)
    .first<{ arrivedAt: number }>();
  const arrivalSiteSince = state ? new Date(state.arrivedAt) : input.observationAt;
  const elapsedMinutes = Math.max(0, (input.observationAt.getTime() - arrivalSiteSince.getTime()) / 60_000);
  if (elapsedMinutes < input.unloadGraceMinutes) {
    return { justEntered: Number(insert.meta.changes ?? 0) > 0, deliveredNow: false, arrivalSiteSince };
  }

  const existing = await database.prepare("SELECT id FROM deliveries WHERE id = ? AND company_id = ? AND status != 'Delivered' LIMIT 1")
    .bind(input.deliveryId, input.companyId).first<{ id: string }>();
  if (!existing) return { justEntered: false, deliveredNow: false, arrivalSiteSince };
  await database.batch([
    database.prepare("UPDATE deliveries SET status = 'Delivered', progress = 100 WHERE id = ? AND company_id = ? AND status != 'Delivered'")
      .bind(input.deliveryId, input.companyId),
    database.prepare("INSERT OR IGNORE INTO delivery_events (delivery_id, type, progress, created_at) VALUES (?, 'ARRIVED', 100, ?)")
      .bind(input.deliveryId, input.observationAt.getTime()),
    database.prepare("DELETE FROM delivery_arrival_state WHERE company_id = ? AND delivery_id = ?")
      .bind(input.companyId, input.deliveryId),
  ]);
  return { justEntered: false, deliveredNow: true, arrivalSiteSince };
}

export async function completeDeliveryManually(companyId: string, deliveryId: string) {
  const database = await ensureSchema();
  const existing = await database.prepare("SELECT id FROM deliveries WHERE id = ? AND company_id = ? AND status != 'Delivered' LIMIT 1")
    .bind(deliveryId, companyId).first<{ id: string }>();
  if (!existing) return false;
  const now = Date.now();
  await database.batch([
    database.prepare("UPDATE deliveries SET status = 'Delivered', progress = 100 WHERE id = ? AND company_id = ? AND status != 'Delivered'")
      .bind(deliveryId, companyId),
    database.prepare("INSERT OR IGNORE INTO delivery_events (delivery_id, type, progress, created_at) VALUES (?, 'MANUAL_DELIVERED', 100, ?)")
      .bind(deliveryId, now),
    database.prepare("INSERT OR IGNORE INTO delivery_events (delivery_id, type, progress, created_at) VALUES (?, 'ARRIVED', 100, ?)")
      .bind(deliveryId, now),
    database.prepare("DELETE FROM delivery_arrival_state WHERE company_id = ? AND delivery_id = ?")
      .bind(companyId, deliveryId),
  ]);
  return true;
}
