import "./postgres-runtime-bootstrap";
import { runtimeEnv } from "trackfleet-runtime-env";
import { store as baseStore } from "./delivery-store.vercel";
import { loadOperationalDeliveries } from "./delivery-operational.postgres";
import { loadEtaBatch, loadEventBatch } from "./delivery-store.postgres-read-batches";
import { createLimitedArrayBatcher, createRecordBatcher } from "./micro-batcher";
import type { DeliveryEventRow, DeliveryRow, DeliveryStore, EtaObservationRow } from "./delivery-store.types";

type D1MirrorStatement = {
  bind(...values: unknown[]): D1MirrorStatement;
  run(): Promise<unknown>;
};

type D1MirrorBinding = {
  prepare(query: string): D1MirrorStatement;
};

function d1() {
  return (runtimeEnv as unknown as { DB?: D1MirrorBinding }).DB ?? null;
}

async function mirrorDelivery(delivery: DeliveryRow) {
  const db = d1();
  if (!db) return;
  try {
    await db.prepare(`INSERT INTO deliveries (
      id, customer, origin_site_id, origin_latitude, origin_longitude, destination_site_id, destination,
      destination_latitude, destination_longitude, arrival_radius_km, truck, driver, status, eta,
      planned_arrival_at, progress, color, contact, whatsapp_opt_in, whatsapp_opt_in_at,
      sendatrack_vehicle_id, latitude, longitude, speed, last_position_at, gps_source, company_id,
      tracking_token, trip_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      customer = excluded.customer,
      origin_site_id = excluded.origin_site_id,
      origin_latitude = excluded.origin_latitude,
      origin_longitude = excluded.origin_longitude,
      destination_site_id = excluded.destination_site_id,
      destination = excluded.destination,
      destination_latitude = excluded.destination_latitude,
      destination_longitude = excluded.destination_longitude,
      arrival_radius_km = excluded.arrival_radius_km,
      truck = excluded.truck,
      driver = excluded.driver,
      status = excluded.status,
      eta = excluded.eta,
      planned_arrival_at = excluded.planned_arrival_at,
      progress = excluded.progress,
      color = excluded.color,
      contact = excluded.contact,
      whatsapp_opt_in = excluded.whatsapp_opt_in,
      whatsapp_opt_in_at = excluded.whatsapp_opt_in_at,
      sendatrack_vehicle_id = excluded.sendatrack_vehicle_id,
      latitude = excluded.latitude,
      longitude = excluded.longitude,
      speed = excluded.speed,
      last_position_at = excluded.last_position_at,
      gps_source = excluded.gps_source,
      company_id = excluded.company_id,
      tracking_token = excluded.tracking_token,
      trip_id = excluded.trip_id`)
      .bind(
        delivery.id,
        delivery.customer,
        delivery.originSiteId,
        delivery.originLatitude,
        delivery.originLongitude,
        delivery.destinationSiteId,
        delivery.destination,
        delivery.destinationLatitude,
        delivery.destinationLongitude,
        delivery.arrivalRadiusKm,
        delivery.truck,
        delivery.driver,
        delivery.status,
        delivery.eta,
        delivery.plannedArrivalAt?.getTime() ?? null,
        delivery.progress,
        delivery.color,
        delivery.contact,
        delivery.whatsappOptIn === true ? 1 : 0,
        delivery.whatsappOptInAt?.getTime() ?? null,
        delivery.sendatrackVehicleId,
        delivery.latitude,
        delivery.longitude,
        delivery.speed,
        delivery.lastPositionAt?.getTime() ?? null,
        delivery.gpsSource,
        delivery.companyId,
        delivery.trackingToken,
        delivery.tripId ?? null,
        delivery.createdAt.getTime(),
      )
      .run();
  } catch (error) {
    console.error("[trackfleet:replication] D1 delivery mirror failed", {
      message: error instanceof Error ? error.message : "unknown_error",
      deliveryId: delivery.id,
      companyId: delivery.companyId,
    });
  }
}

const listEventsBatched = createRecordBatcher<DeliveryEventRow[]>(loadEventBatch, () => []);
const listEtaObservationsBatched = createLimitedArrayBatcher<EtaObservationRow>(
  loadEtaBatch,
  (limit) => Math.max(1, Math.min(2000, Math.round(limit ?? 200))),
);

export const store: DeliveryStore = {
  ...baseStore,
  listForCompany: loadOperationalDeliveries,
  listEvents: listEventsBatched,
  listEtaObservations: listEtaObservationsBatched,
  async create(input) {
    const delivery = await baseStore.create(input);
    await mirrorDelivery(delivery);
    return delivery;
  },
};
