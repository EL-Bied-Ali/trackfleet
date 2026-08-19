import { store as primaryStore } from "./delivery-store.shared-postgres";
import { store as standbyStore } from "./delivery-store.cloudflare";
import { loadOperationalDeliveriesFromD1 } from "./delivery-operational.cloudflare";
import {
  d1ReadFailoverActive,
  suppressMaintenanceWriteDuringD1Failover,
  withD1ReadFailover,
} from "./d1-read-failover";
import type { DeliveryStore } from "./delivery-store.types";

export const store: DeliveryStore = {
  ...primaryStore,

  getPublic(tracking) {
    return withD1ReadFailover(
      "delivery.getPublic",
      () => primaryStore.getPublic(tracking),
      () => standbyStore.getPublic(tracking),
    );
  },

  listForCompany(companyId) {
    return withD1ReadFailover(
      "delivery.listForCompany",
      () => primaryStore.listForCompany(companyId),
      () => loadOperationalDeliveriesFromD1(companyId),
    );
  },

  listEvents(deliveryId) {
    return withD1ReadFailover(
      "delivery.listEvents",
      () => primaryStore.listEvents(deliveryId),
      () => standbyStore.listEvents(deliveryId),
    );
  },

  listEtaObservations(deliveryId, limit) {
    return withD1ReadFailover(
      "delivery.listEtaObservations",
      () => primaryStore.listEtaObservations(deliveryId, limit),
      () => standbyStore.listEtaObservations(deliveryId, limit),
    );
  },

  listEtaObservationsForRoute(routeTemplateId, destinationSiteId, limit) {
    return withD1ReadFailover(
      "delivery.listEtaObservationsForRoute",
      () => primaryStore.listEtaObservationsForRoute(routeTemplateId, destinationSiteId, limit),
      () => standbyStore.listEtaObservationsForRoute(routeTemplateId, destinationSiteId, limit),
    );
  },

  listTripPositionsForRoute(companyId, routeTemplateId, limit) {
    return withD1ReadFailover(
      "delivery.listTripPositionsForRoute",
      () => primaryStore.listTripPositionsForRoute(companyId, routeTemplateId, limit),
      () => standbyStore.listTripPositionsForRoute(companyId, routeTemplateId, limit),
    );
  },

  listFleetPositions(companyId, vehicleId, limit) {
    return withD1ReadFailover(
      "delivery.listFleetPositions",
      () => primaryStore.listFleetPositions(companyId, vehicleId, limit),
      () => standbyStore.listFleetPositions(companyId, vehicleId, limit),
    );
  },

  getTrip(companyId, tripId) {
    return withD1ReadFailover(
      "delivery.getTrip",
      () => primaryStore.getTrip(companyId, tripId),
      () => standbyStore.getTrip(companyId, tripId),
    );
  },

  listTrips(companyId, limit) {
    return withD1ReadFailover(
      "delivery.listTrips",
      () => primaryStore.listTrips(companyId, limit),
      () => standbyStore.listTrips(companyId, limit),
    );
  },

  listDeliveryIdsForTrip(companyId, tripId) {
    return withD1ReadFailover(
      "delivery.listDeliveryIdsForTrip",
      () => primaryStore.listDeliveryIdsForTrip(companyId, tripId),
      () => standbyStore.listDeliveryIdsForTrip(companyId, tripId),
    );
  },

  listPendingNotifications(companyId) {
    return withD1ReadFailover(
      "delivery.listPendingNotifications",
      () => primaryStore.listPendingNotifications(companyId),
      async () => [],
    );
  },

  applySendatrackSnapshot(snapshot, companyId) {
    return suppressMaintenanceWriteDuringD1Failover(
      "delivery.applySendatrackSnapshot",
      () => primaryStore.applySendatrackSnapshot(snapshot, companyId),
      [],
    );
  },

  recordEvent(deliveryId, type, progress) {
    return suppressMaintenanceWriteDuringD1Failover(
      "delivery.recordEvent",
      () => primaryStore.recordEvent(deliveryId, type, progress),
      false,
    );
  },

  recordEtaObservation(input) {
    return suppressMaintenanceWriteDuringD1Failover(
      "delivery.recordEtaObservation",
      () => primaryStore.recordEtaObservation(input),
      false,
    );
  },

  recordTripPosition(input) {
    return suppressMaintenanceWriteDuringD1Failover(
      "delivery.recordTripPosition",
      () => primaryStore.recordTripPosition(input),
      false,
    );
  },

  recordFleetPosition(input) {
    return suppressMaintenanceWriteDuringD1Failover(
      "delivery.recordFleetPosition",
      () => primaryStore.recordFleetPosition(input),
      false,
    );
  },

  claimNotification(deliveryId, type) {
    return suppressMaintenanceWriteDuringD1Failover(
      "delivery.claimNotification",
      () => primaryStore.claimNotification(deliveryId, type),
      false,
    );
  },

  markNotificationSent(deliveryId, type) {
    return suppressMaintenanceWriteDuringD1Failover(
      "delivery.markNotificationSent",
      () => primaryStore.markNotificationSent(deliveryId, type),
      undefined,
    );
  },

  releaseNotification(deliveryId, type) {
    return suppressMaintenanceWriteDuringD1Failover(
      "delivery.releaseNotification",
      () => primaryStore.releaseNotification(deliveryId, type),
      undefined,
    );
  },

  // The dashboard GET derives trips as part of rendering. During an active
  // read-only lease these derived writes are replaced with the D1 snapshot (or
  // a transient equivalent) so rendering remains available without creating a
  // second writable source of truth. External non-GET requests are blocked at
  // the Worker boundary while the lease is active.
  async upsertTrip(input) {
    if (await d1ReadFailoverActive()) {
      const existing = await standbyStore.getTrip(input.companyId, input.id).catch(() => null);
      if (existing) return existing;
      const now = new Date();
      return { ...input, createdAt: now, updatedAt: now };
    }
    return primaryStore.upsertTrip(input);
  },

  async assignDeliveryTrip(deliveryId, companyId, tripId) {
    if (await d1ReadFailoverActive()) return false;
    return primaryStore.assignDeliveryTrip(deliveryId, companyId, tripId);
  },

  async assignDeliveryToPlannedTrip(deliveryId, companyId, tripId, truck, sendatrackVehicleId) {
    if (await d1ReadFailoverActive()) return null;
    return primaryStore.assignDeliveryToPlannedTrip(deliveryId, companyId, tripId, truck, sendatrackVehicleId);
  },

  async linkVehicle(deliveryId, companyId, vehicle) {
    if (await d1ReadFailoverActive()) return null;
    return primaryStore.linkVehicle(deliveryId, companyId, vehicle);
  },

  // Delivery creation is never used by a GET path and remains strictly primary.
  create: primaryStore.create,
};
