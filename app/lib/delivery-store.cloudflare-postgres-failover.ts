import { store as primaryStore } from "./delivery-store.shared-postgres";
import { loadOperationalDeliveriesFromD1 } from "./delivery-operational.cloudflare";
import {
  getPublicDeliveryFromD1,
  getTripFromD1,
  listDeliveryEventsFromD1,
  listDeliveryIdsForTripFromD1,
  listEtaObservationsFromD1,
  listFleetPositionsFromD1,
  listRouteEtaObservationsFromD1,
  listTripPositionsFromD1,
  listTripsFromD1,
} from "./d1-standby-read-store";
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
      () => getPublicDeliveryFromD1(tracking),
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
      () => listDeliveryEventsFromD1(deliveryId),
    );
  },

  listEtaObservations(deliveryId, limit) {
    return withD1ReadFailover(
      "delivery.listEtaObservations",
      () => primaryStore.listEtaObservations(deliveryId, limit),
      () => listEtaObservationsFromD1(deliveryId, limit),
    );
  },

  listEtaObservationsForRoute(routeTemplateId, destinationSiteId, limit) {
    return withD1ReadFailover(
      "delivery.listEtaObservationsForRoute",
      () => primaryStore.listEtaObservationsForRoute(routeTemplateId, destinationSiteId, limit),
      () => listRouteEtaObservationsFromD1(routeTemplateId, destinationSiteId, limit),
    );
  },

  listTripPositionsForRoute(companyId, routeTemplateId, limit) {
    return withD1ReadFailover(
      "delivery.listTripPositionsForRoute",
      () => primaryStore.listTripPositionsForRoute(companyId, routeTemplateId, limit),
      () => listTripPositionsFromD1(companyId, routeTemplateId, limit),
    );
  },

  listFleetPositions(companyId, vehicleId, limit) {
    return withD1ReadFailover(
      "delivery.listFleetPositions",
      () => primaryStore.listFleetPositions(companyId, vehicleId, limit),
      () => listFleetPositionsFromD1(companyId, vehicleId, limit),
    );
  },

  getTrip(companyId, tripId) {
    return withD1ReadFailover(
      "delivery.getTrip",
      () => primaryStore.getTrip(companyId, tripId),
      () => getTripFromD1(companyId, tripId),
    );
  },

  listTrips(companyId, limit) {
    return withD1ReadFailover(
      "delivery.listTrips",
      () => primaryStore.listTrips(companyId, limit),
      () => listTripsFromD1(companyId, limit),
    );
  },

  listDeliveryIdsForTrip(companyId, tripId) {
    return withD1ReadFailover(
      "delivery.listDeliveryIdsForTrip",
      () => primaryStore.listDeliveryIdsForTrip(companyId, tripId),
      () => listDeliveryIdsForTripFromD1(companyId, tripId),
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

  async upsertTrip(input) {
    if (await d1ReadFailoverActive()) {
      const existing = await getTripFromD1(input.companyId, input.id).catch(() => null);
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

  async updateSchedule(deliveryId, companyId, input) {
    if (await d1ReadFailoverActive()) return null;
    return primaryStore.updateSchedule(deliveryId, companyId, input);
  },

  create: primaryStore.create,
};
