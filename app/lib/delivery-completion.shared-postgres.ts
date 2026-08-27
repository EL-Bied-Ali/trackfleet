import "./postgres-runtime-bootstrap";
import { runtimeEnv } from "trackfleet-runtime-env";
import {
  completeDeliveryManually as completePrimaryManually,
  confirmDepartureManually as confirmPrimaryDeparture,
  observeArrivalCompletion as observePrimaryArrivalCompletion,
  type ArrivalCompletionObservation,
  type ArrivalCompletionResult,
} from "./delivery-completion.vercel";

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

function replicationError(scope: string, error: unknown, context: Record<string, unknown>) {
  console.error(`[trackfleet:replication] D1 ${scope} mirror failed`, {
    message: error instanceof Error ? error.message : "unknown_error",
    ...context,
  });
}

async function mirrorArrivalObservation(input: ArrivalCompletionObservation, result: ArrivalCompletionResult) {
  const db = d1();
  if (!db) return;
  try {
    if (!input.insideArrivalZone) {
      await db.batch([
        db.prepare("DELETE FROM delivery_arrival_state WHERE company_id = ? AND delivery_id = ?")
          .bind(input.companyId, input.deliveryId),
        db.prepare("DELETE FROM delivery_events WHERE delivery_id = ? AND type = 'ARRIVED_AT_SITE'")
          .bind(input.deliveryId),
      ]);
      return;
    }

    if (result.deliveredNow) {
      await db.batch([
        db.prepare("UPDATE deliveries SET status = 'Delivered', progress = 100 WHERE id = ? AND company_id = ?")
          .bind(input.deliveryId, input.companyId),
        db.prepare("INSERT OR IGNORE INTO delivery_events (delivery_id, type, progress, created_at) VALUES (?, 'ARRIVED', 100, ?)")
          .bind(input.deliveryId, input.observationAt.getTime()),
        db.prepare("DELETE FROM delivery_arrival_state WHERE company_id = ? AND delivery_id = ?")
          .bind(input.companyId, input.deliveryId),
      ]);
      return;
    }

    if (!result.arrivalSiteSince) return;
    const statements = [
      db.prepare(`INSERT INTO delivery_arrival_state (company_id, delivery_id, arrived_at, last_observed_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(company_id, delivery_id) DO UPDATE SET
          arrived_at = excluded.arrived_at,
          last_observed_at = excluded.last_observed_at`)
        .bind(
          input.companyId,
          input.deliveryId,
          result.arrivalSiteSince.getTime(),
          input.observationAt.getTime(),
        ),
    ];
    if (result.justEntered) {
      statements.push(
        db.prepare("DELETE FROM delivery_events WHERE delivery_id = ? AND type = 'ARRIVED_AT_SITE'")
          .bind(input.deliveryId),
      );
    }
    await db.batch(statements);
  } catch (error) {
    replicationError("arrival completion", error, {
      companyId: input.companyId,
      deliveryId: input.deliveryId,
    });
  }
}

async function mirrorManualCompletion(companyId: string, deliveryId: string) {
  const db = d1();
  if (!db) return;
  const now = Date.now();
  try {
    await db.batch([
      db.prepare("UPDATE deliveries SET status = 'Delivered', progress = 100 WHERE id = ? AND company_id = ?")
        .bind(deliveryId, companyId),
      db.prepare("INSERT OR IGNORE INTO delivery_events (delivery_id, type, progress, created_at) VALUES (?, 'MANUAL_DELIVERED', 100, ?)")
        .bind(deliveryId, now),
      db.prepare("INSERT OR IGNORE INTO delivery_events (delivery_id, type, progress, created_at) VALUES (?, 'ARRIVED', 100, ?)")
        .bind(deliveryId, now),
      db.prepare("DELETE FROM delivery_arrival_state WHERE company_id = ? AND delivery_id = ?")
        .bind(companyId, deliveryId),
    ]);
  } catch (error) {
    replicationError("manual completion", error, { companyId, deliveryId });
  }
}

async function mirrorManualDeparture(companyId: string, deliveryId: string) {
  const db = d1();
  if (!db) return;
  const now = Date.now();
  try {
    // Loading-status deliveries -- the only ones this ever applies to --
    // have never had a GPS-observed progress update, so 0 is what the
    // primary's own subquery would read here too in practice.
    await db.batch([
      db.prepare("UPDATE deliveries SET status = 'In transit' WHERE id = ? AND company_id = ?")
        .bind(deliveryId, companyId),
      db.prepare("INSERT OR IGNORE INTO delivery_events (delivery_id, type, progress, created_at) VALUES (?, 'MANUAL_DEPARTURE_CONFIRMED', 0, ?)")
        .bind(deliveryId, now),
      db.prepare("INSERT OR IGNORE INTO delivery_events (delivery_id, type, progress, created_at) VALUES (?, 'DEPARTED', 0, ?)")
        .bind(deliveryId, now),
    ]);
  } catch (error) {
    replicationError("manual departure", error, { companyId, deliveryId });
  }
}

export async function observeArrivalCompletion(input: ArrivalCompletionObservation): Promise<ArrivalCompletionResult> {
  const result = await observePrimaryArrivalCompletion(input);
  await mirrorArrivalObservation(input, result);
  return result;
}

export async function completeDeliveryManually(companyId: string, deliveryId: string) {
  const completed = await completePrimaryManually(companyId, deliveryId);
  if (completed) await mirrorManualCompletion(companyId, deliveryId);
  return completed;
}

export async function confirmDepartureManually(companyId: string, deliveryId: string) {
  const departed = await confirmPrimaryDeparture(companyId, deliveryId);
  if (departed) await mirrorManualDeparture(companyId, deliveryId);
  return departed;
}

export type { ArrivalCompletionObservation, ArrivalCompletionResult };
