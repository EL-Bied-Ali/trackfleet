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

const maxContinuousObservationGapMs = 30 * 60_000;

function db() {
  if (!runtimeEnv.DB) throw new Error("Cloudflare D1 binding `DB` is required for delivery completion");
  return runtimeEnv.DB;
}

async function clearArrivalState(database: D1Database, companyId: string, deliveryId: string) {
  await database.batch([
    database.prepare("DELETE FROM delivery_arrival_state WHERE company_id = ? AND delivery_id = ?")
      .bind(companyId, deliveryId),
    database.prepare(`DELETE FROM delivery_events
      WHERE delivery_id = ? AND type = 'ARRIVED_AT_SITE'
        AND EXISTS (SELECT 1 FROM deliveries WHERE id = ? AND company_id = ?)`)
      .bind(deliveryId, deliveryId, companyId),
  ]);
}

export async function observeArrivalCompletion(input: ArrivalCompletionObservation): Promise<ArrivalCompletionResult> {
  const database = db();
  if (!input.insideArrivalZone) {
    await clearArrivalState(database, input.companyId, input.deliveryId);
    return { justEntered: false, deliveredNow: false, arrivalSiteSince: null };
  }

  const state = await database.prepare(`SELECT arrived_at AS arrivedAt, last_observed_at AS lastObservedAt
    FROM delivery_arrival_state WHERE company_id = ? AND delivery_id = ? LIMIT 1`)
    .bind(input.companyId, input.deliveryId)
    .first<{ arrivedAt: number; lastObservedAt: number | null }>();
  const observationMs = input.observationAt.getTime();
  const previousObservedMs = state?.lastObservedAt ?? NaN;
  const continuityBroken = !state
    || !Number.isFinite(previousObservedMs)
    || observationMs < previousObservedMs
    || observationMs - previousObservedMs > maxContinuousObservationGapMs;

  const arrivalSiteSince = continuityBroken ? input.observationAt : new Date(state.arrivedAt);
  if (continuityBroken) {
    await database.batch([
      database.prepare(`DELETE FROM delivery_events
        WHERE delivery_id = ? AND type = 'ARRIVED_AT_SITE'
          AND EXISTS (SELECT 1 FROM deliveries WHERE id = ? AND company_id = ?)`)
        .bind(input.deliveryId, input.deliveryId, input.companyId),
      database.prepare(`INSERT INTO delivery_arrival_state (company_id, delivery_id, arrived_at, last_observed_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(company_id, delivery_id) DO UPDATE SET arrived_at = excluded.arrived_at, last_observed_at = excluded.last_observed_at`)
        .bind(input.companyId, input.deliveryId, observationMs, observationMs),
    ]);
  } else {
    await database.prepare("UPDATE delivery_arrival_state SET last_observed_at = ? WHERE company_id = ? AND delivery_id = ?")
      .bind(observationMs, input.companyId, input.deliveryId).run();
  }

  const elapsedMinutes = Math.max(0, (observationMs - arrivalSiteSince.getTime()) / 60_000);
  if (elapsedMinutes < input.unloadGraceMinutes) {
    return { justEntered: continuityBroken, deliveredNow: false, arrivalSiteSince };
  }

  const existing = await database.prepare("SELECT id FROM deliveries WHERE id = ? AND company_id = ? AND status != 'Delivered' LIMIT 1")
    .bind(input.deliveryId, input.companyId).first<{ id: string }>();
  if (!existing) return { justEntered: false, deliveredNow: false, arrivalSiteSince };
  await database.batch([
    database.prepare("UPDATE deliveries SET status = 'Delivered', progress = 100 WHERE id = ? AND company_id = ? AND status != 'Delivered'")
      .bind(input.deliveryId, input.companyId),
    database.prepare("INSERT OR IGNORE INTO delivery_events (delivery_id, type, progress, created_at) VALUES (?, 'ARRIVED', 100, ?)")
      .bind(input.deliveryId, observationMs),
    database.prepare("DELETE FROM delivery_arrival_state WHERE company_id = ? AND delivery_id = ?")
      .bind(input.companyId, input.deliveryId),
  ]);
  return { justEntered: false, deliveredNow: true, arrivalSiteSince };
}

export async function completeDeliveryManually(companyId: string, deliveryId: string) {
  const database = db();
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

// Same idea as completeDeliveryManually, but for the other end of the trip:
// a delivery with no SENDATRACK-tracked vehicle never gets the automatic
// Loading -> In transit transition (detectDeliveryEvents only fires DEPARTED
// off a real GPS-observed status change), so it would otherwise sit in
// Loading forever. Only applies from Loading -- already-departed or already-
// delivered deliveries are left untouched.
export async function confirmDepartureManually(companyId: string, deliveryId: string) {
  const database = db();
  const existing = await database.prepare("SELECT id, progress FROM deliveries WHERE id = ? AND company_id = ? AND status = 'Loading' LIMIT 1")
    .bind(deliveryId, companyId).first<{ id: string; progress: number }>();
  if (!existing) return false;
  const now = Date.now();
  await database.batch([
    database.prepare("UPDATE deliveries SET status = 'In transit' WHERE id = ? AND company_id = ? AND status = 'Loading'")
      .bind(deliveryId, companyId),
    database.prepare("INSERT OR IGNORE INTO delivery_events (delivery_id, type, progress, created_at) VALUES (?, 'MANUAL_DEPARTURE_CONFIRMED', ?, ?)")
      .bind(deliveryId, existing.progress, now),
    database.prepare("INSERT OR IGNORE INTO delivery_events (delivery_id, type, progress, created_at) VALUES (?, 'DEPARTED', ?, ?)")
      .bind(deliveryId, existing.progress, now),
  ]);
  return true;
}
