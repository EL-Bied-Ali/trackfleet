import "./postgres-runtime-bootstrap";
import { store as baseStore } from "./delivery-store.vercel";
import { loadOperationalDeliveries } from "./delivery-operational.postgres";
import { loadEtaBatch, loadEventBatch } from "./delivery-store.postgres-read-batches";
import { createLimitedArrayBatcher, createRecordBatcher } from "./micro-batcher";
import { d1MirrorBinding, queueD1Mirror } from "./d1-mirror-queue";
import type { DeliveryEventRow, DeliveryRow, DeliveryStore, EtaObservationRow } from "./delivery-store.types";
import type { TripRecord } from "./trip-record";

const d1 = d1MirrorBinding;

function replicationError(scope: string, error: unknown, context: Record<string, unknown>) {
  console.error(`[trackfleet:replication] D1 ${scope} mirror failed`, {
    message: error instanceof Error ? error.message : "unknown_error",
    ...context,
  });
}

async function mirrorDelivery(delivery: DeliveryRow) {
  const db = d1();
  if (!db) return;
  try {
    const statement = db.prepare(`INSERT INTO deliveries (
      id, customer, origin_site_id, origin_latitude, origin_longitude, destination_site_id, destination,
      destination_latitude, destination_longitude, arrival_radius_km, truck, driver, status, eta,
      planned_arrival_at, next_truck_departure_at, progress, color, contact, recipient_name, recipient_contact, weight_kg, price_amount, price_currency, item_description, customer_email, whatsapp_opt_in, whatsapp_opt_in_at, recipient_whatsapp_opt_in, recipient_whatsapp_opt_in_at,
      sendatrack_vehicle_id, latitude, longitude, speed, last_position_at, gps_source, company_id,
      tracking_token, trip_id, shipment_id, created_at, parcel_code
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      next_truck_departure_at = excluded.next_truck_departure_at,
      progress = excluded.progress,
      color = excluded.color,
      contact = excluded.contact,
      recipient_name = excluded.recipient_name,
      recipient_contact = excluded.recipient_contact,
      weight_kg = excluded.weight_kg,
      price_amount = excluded.price_amount,
      price_currency = excluded.price_currency,
      item_description = excluded.item_description,
      customer_email = excluded.customer_email,
      whatsapp_opt_in = excluded.whatsapp_opt_in,
      whatsapp_opt_in_at = excluded.whatsapp_opt_in_at,
      recipient_whatsapp_opt_in = excluded.recipient_whatsapp_opt_in,
      recipient_whatsapp_opt_in_at = excluded.recipient_whatsapp_opt_in_at,
      sendatrack_vehicle_id = excluded.sendatrack_vehicle_id,
      latitude = excluded.latitude,
      longitude = excluded.longitude,
      speed = excluded.speed,
      last_position_at = excluded.last_position_at,
      gps_source = excluded.gps_source,
      company_id = excluded.company_id,
      tracking_token = excluded.tracking_token,
      trip_id = excluded.trip_id,
      shipment_id = excluded.shipment_id,
      parcel_code = excluded.parcel_code`);
    queueD1Mirror(statement.bind(
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
        delivery.nextTruckDepartureAt?.getTime() ?? null,
        delivery.progress,
        delivery.color,
        delivery.contact,
        delivery.recipientName ?? "",
        delivery.recipientContact ?? "",
        delivery.weightKg ?? null,
        delivery.priceAmount ?? null,
        delivery.priceCurrency ?? null,
        delivery.itemDescription ?? null,
        delivery.customerEmail ?? null,
        delivery.whatsappOptIn === true ? 1 : 0,
        delivery.whatsappOptInAt?.getTime() ?? null,
        delivery.recipientWhatsappOptIn === true ? 1 : 0,
        delivery.recipientWhatsappOptInAt?.getTime() ?? null,
        delivery.sendatrackVehicleId,
        delivery.latitude,
        delivery.longitude,
        delivery.speed,
        delivery.lastPositionAt?.getTime() ?? null,
        delivery.gpsSource,
        delivery.companyId,
        delivery.trackingToken,
        delivery.tripId ?? null,
        delivery.shipmentId ?? null,
        delivery.createdAt.getTime(),
        delivery.parcelCode ?? null,
      ),
    );
  } catch (error) {
    replicationError("delivery", error, { deliveryId: delivery.id, companyId: delivery.companyId });
  }
}

async function mirrorTripAssignment(deliveryId: string, companyId: string, tripId: string) {
  const db = d1();
  if (!db) return;
  try {
    queueD1Mirror(db.prepare("UPDATE deliveries SET trip_id = ? WHERE id = ? AND company_id = ?")
      .bind(tripId, deliveryId, companyId));
  } catch (error) {
    replicationError("delivery trip assignment", error, { deliveryId, companyId, tripId });
  }
}

async function mirrorEvent(
  deliveryId: string,
  type: Parameters<DeliveryStore["recordEvent"]>[1],
  progress: number,
) {
  const db = d1();
  if (!db) return;
  try {
    queueD1Mirror(db.prepare("INSERT OR IGNORE INTO delivery_events (delivery_id, type, progress, created_at) VALUES (?, ?, ?, ?)")
      .bind(deliveryId, type, progress, Date.now()));
  } catch (error) {
    replicationError("delivery event", error, { deliveryId, type });
  }
}

async function mirrorEtaObservation(input: Parameters<DeliveryStore["recordEtaObservation"]>[0]) {
  const db = d1();
  if (!db) return;
  try {
    queueD1Mirror(db.prepare(`INSERT OR IGNORE INTO delivery_eta_observations (
      delivery_id, route_template_id, trip_instance_id, destination_site_id, position_at,
      estimated_arrival_at, planned_arrival_at, delay_minutes, effective_speed_kmh,
      remaining_distance_km, progress, confidence, source, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        input.deliveryId,
        input.routeTemplateId,
        input.tripInstanceId,
        input.destinationSiteId,
        input.positionAt.getTime(),
        input.estimatedArrivalAt.getTime(),
        input.plannedArrivalAt?.getTime() ?? null,
        input.delayMinutes,
        input.effectiveSpeedKmh,
        input.remainingDistanceKm,
        input.progress,
        input.confidence,
        input.source,
        Date.now(),
      ));
  } catch (error) {
    replicationError("ETA observation", error, { deliveryId: input.deliveryId });
  }
}

async function mirrorTripPosition(input: Parameters<DeliveryStore["recordTripPosition"]>[0]) {
  const db = d1();
  if (!db) return;
  try {
    queueD1Mirror(db.prepare(`INSERT OR IGNORE INTO trip_position_observations (
      company_id, route_template_id, trip_instance_id, vehicle_id, position_at, latitude, longitude, speed, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        input.companyId,
        input.routeTemplateId,
        input.tripInstanceId,
        input.vehicleId,
        input.positionAt.getTime(),
        input.latitude,
        input.longitude,
        input.speed,
        Date.now(),
      ));
  } catch (error) {
    replicationError("trip position", error, { companyId: input.companyId, tripInstanceId: input.tripInstanceId });
  }
}

async function mirrorFleetPosition(input: Parameters<DeliveryStore["recordFleetPosition"]>[0]) {
  const db = d1();
  if (!db) return;
  try {
    queueD1Mirror(db.prepare(`INSERT OR IGNORE INTO fleet_position_observations (
      company_id, vehicle_id, vehicle_name, position_at, latitude, longitude, speed, heading, address, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        input.companyId,
        input.vehicleId,
        input.vehicleName,
        input.positionAt.getTime(),
        input.latitude,
        input.longitude,
        input.speed,
        input.heading,
        input.address,
        Date.now(),
      ));
  } catch (error) {
    replicationError("fleet position", error, { companyId: input.companyId, vehicleId: input.vehicleId });
  }
}

async function mirrorTrip(trip: TripRecord) {
  const db = d1();
  if (!db) return;
  const stopsJson = JSON.stringify(trip.stops.map((stop) => ({
    ...stop,
    plannedArrivalAt: stop.plannedArrivalAt?.getTime() ?? null,
  })));
  try {
    queueD1Mirror(db.prepare(`INSERT INTO trips (
      id, company_id, route_template_id, vehicle_key, truck, sendatrack_vehicle_id,
      origin_site_id, stops_json, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(company_id, id) DO UPDATE SET
      route_template_id = excluded.route_template_id,
      vehicle_key = excluded.vehicle_key,
      truck = excluded.truck,
      sendatrack_vehicle_id = excluded.sendatrack_vehicle_id,
      origin_site_id = excluded.origin_site_id,
      stops_json = excluded.stops_json,
      status = excluded.status,
      updated_at = excluded.updated_at`)
      .bind(
        trip.id,
        trip.companyId,
        trip.routeTemplateId,
        trip.vehicleKey,
        trip.truck,
        trip.sendatrackVehicleId,
        trip.originSiteId,
        stopsJson,
        trip.status,
        trip.createdAt.getTime(),
        trip.updatedAt.getTime(),
      ));
  } catch (error) {
    replicationError("trip", error, { companyId: trip.companyId, tripId: trip.id });
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
  async applySendatrackSnapshot(snapshot, companyId) {
    const transitions = await baseStore.applySendatrackSnapshot(snapshot, companyId);
    for (const transition of transitions) await mirrorDelivery(transition.delivery);
    return transitions;
  },
  async linkVehicle(deliveryId, companyId, vehicle) {
    const delivery = await baseStore.linkVehicle(deliveryId, companyId, vehicle);
    if (delivery) await mirrorDelivery(delivery);
    return delivery;
  },
  async updateSchedule(deliveryId, companyId, input) {
    const delivery = await baseStore.updateSchedule(deliveryId, companyId, input);
    if (delivery) await mirrorDelivery(delivery);
    return delivery;
  },
  async updateDetails(deliveryId, companyId, input) {
    const delivery = await baseStore.updateDetails(deliveryId, companyId, input);
    if (delivery) await mirrorDelivery(delivery);
    return delivery;
  },
  async recordScan(input) {
    const scan = await baseStore.recordScan(input);
    const db = d1();
    if (db) {
      try {
        queueD1Mirror(db.prepare(`INSERT INTO delivery_scans (id, company_id, delivery_id, checkpoint, scanned_by, truck, location_label, scanned_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(scan.id, scan.companyId, scan.deliveryId, scan.checkpoint, scan.scannedBy, scan.truck, scan.locationLabel, scan.scannedAt.getTime()));
      } catch (error) {
        replicationError("delivery scan", error, { deliveryId: scan.deliveryId, companyId: scan.companyId });
      }
    }
    return scan;
  },
  async recordEvent(deliveryId, type, progress) {
    const inserted = await baseStore.recordEvent(deliveryId, type, progress);
    if (inserted) await mirrorEvent(deliveryId, type, progress);
    return inserted;
  },
  async recordEtaObservation(input) {
    const inserted = await baseStore.recordEtaObservation(input);
    if (inserted) await mirrorEtaObservation(input);
    return inserted;
  },
  async recordTripPosition(input) {
    const inserted = await baseStore.recordTripPosition(input);
    if (inserted) await mirrorTripPosition(input);
    return inserted;
  },
  async recordFleetPosition(input) {
    const inserted = await baseStore.recordFleetPosition(input);
    if (inserted) await mirrorFleetPosition(input);
    return inserted;
  },
  async upsertTrip(input) {
    const trip = await baseStore.upsertTrip(input);
    await mirrorTrip(trip);
    return trip;
  },
  async assignDeliveryTrip(deliveryId, companyId, tripId) {
    const assigned = await baseStore.assignDeliveryTrip(deliveryId, companyId, tripId);
    if (assigned) await mirrorTripAssignment(deliveryId, companyId, tripId);
    return assigned;
  },
  async assignDeliveryToPlannedTrip(deliveryId, companyId, tripId, truck, sendatrackVehicleId) {
    const delivery = await baseStore.assignDeliveryToPlannedTrip(deliveryId, companyId, tripId, truck, sendatrackVehicleId);
    if (delivery) await mirrorDelivery(delivery);
    return delivery;
  },
};
