import { seedDeliveries } from "./delivery-seed";
import { customerFacingEvent, detectDeliveryEvents, type DeliveryEventType } from "./delivery-events";
import type { CreateDeliveryInput, DeliveryEventRow, DeliveryRow, DeliveryStore, DeliveryTransition, EtaObservationRow, TripPositionRow } from "./delivery-store.types";
import { NotificationClaimState } from "./notification-claim-state";
import { calculateRouteMetrics, deriveDeliveryState, rebaseRouteMetrics } from "./route-progress";
import type { SendatrackSnapshot } from "./sendatrack";
import { matchDeliveryVehicle } from "./vehicle-linking";
import { isUnassignedVehicle } from "./delivery-vehicle-choice.ts";
import type { TripRecord } from "./trip-record";

const deliveryStore = seedDeliveries.map((delivery) => ({ ...delivery }));
const deliveryEvents: DeliveryEventRow[] = [];
const etaObservations: EtaObservationRow[] = [];
const tripPositions: TripPositionRow[] = [];
const trips: TripRecord[] = [];
const deliveryTripAssignments = new Map<string, string>();
const notificationClaims = new NotificationClaimState();

function notificationKey(deliveryId: string, type: DeliveryEventType) { return `${deliveryId}:${type}:whatsapp`; }
function baselineProgress(deliveryId: string) {
  return deliveryEvents.find((event) => event.deliveryId === deliveryId && event.type === "GPS_BASELINE")?.progress ?? 0;
}
function explicitDestination(delivery: DeliveryRow): [number, number] | null {
  return typeof delivery.destinationLatitude === "number" && typeof delivery.destinationLongitude === "number"
    ? [delivery.destinationLongitude, delivery.destinationLatitude]
    : null;
}
function explicitOrigin(delivery: DeliveryRow): [number, number] | null {
  return typeof delivery.originLatitude === "number" && typeof delivery.originLongitude === "number"
    ? [delivery.originLongitude, delivery.originLatitude]
    : null;
}

export const memoryStore: DeliveryStore = {
  async getPublic(tracking) {
    return deliveryStore.find((delivery) => delivery.trackingToken === tracking) ?? null;
  },
  async listForCompany(companyId) {
    return deliveryStore.filter((delivery) => delivery.companyId === companyId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  },
  async applySendatrackSnapshot(snapshot: SendatrackSnapshot, companyId: string) {
    const transitions: DeliveryTransition[] = [];
    if (!snapshot.connected || !snapshot.vehicles.length) return transitions;
    for (const delivery of deliveryStore) {
      if (delivery.status === "Delivered" || delivery.companyId !== companyId) continue;
      const match = matchDeliveryVehicle(delivery, snapshot.vehicles);
      const vehicle = match.vehicle;
      if (!vehicle) continue;
      const firstLink = delivery.gpsSource !== "sendatrack";
      const previousStatus = delivery.status;
      const previousProgress = delivery.progress;
      const absoluteMetrics = calculateRouteMetrics(vehicle.latitude, vehicle.longitude, delivery.destination, explicitDestination(delivery), explicitOrigin(delivery));
      if (firstLink && !deliveryEvents.some((event) => event.deliveryId === delivery.id && event.type === "GPS_BASELINE")) {
        deliveryEvents.push({ deliveryId: delivery.id, type: "GPS_BASELINE", progress: absoluteMetrics.progress, createdAt: new Date() });
      }
      const metrics = rebaseRouteMetrics(absoluteMetrics, explicitOrigin(delivery) ? 0 : baselineProgress(delivery.id));
      const positionAgeMinutes = Math.max(0, Math.round((Date.now() - vehicle.updatedAt) / 60_000));
      const state = firstLink ? { status: "Loading" as const, progress: previousProgress } : deriveDeliveryState(delivery.status, metrics, vehicle.speed, previousProgress, delivery.arrivalRadiusKm, positionAgeMinutes);
      const events = firstLink ? [] : detectDeliveryEvents({ previousStatus, nextStatus: state.status, previousProgress, nextProgress: state.progress, distanceToDestinationKm: metrics.distanceToDestinationKm, positionAgeMinutes });
      Object.assign(delivery, { sendatrackVehicleId: vehicle.id, truck: vehicle.name, latitude: vehicle.latitude, longitude: vehicle.longitude, speed: vehicle.speed, lastPositionAt: new Date(vehicle.updatedAt), gpsSource: "sendatrack", progress: state.progress, status: state.status });
      transitions.push({ delivery: { ...delivery }, events });
    }
    return transitions;
  },
  async linkVehicle(deliveryId, companyId, vehicle) {
    const delivery = deliveryStore.find((item) => item.id === deliveryId && item.companyId === companyId) ?? null;
    if (!delivery || delivery.status === "Delivered") return null;
    const metrics = calculateRouteMetrics(vehicle.latitude, vehicle.longitude, delivery.destination, explicitDestination(delivery), explicitOrigin(delivery));
    if (!deliveryEvents.some((event) => event.deliveryId === delivery.id && event.type === "GPS_BASELINE")) {
      deliveryEvents.push({ deliveryId: delivery.id, type: "GPS_BASELINE", progress: metrics.progress, createdAt: new Date() });
    }
    Object.assign(delivery, {
      sendatrackVehicleId: vehicle.id, truck: vehicle.name, latitude: vehicle.latitude, longitude: vehicle.longitude,
      speed: vehicle.speed, lastPositionAt: new Date(vehicle.updatedAt), gpsSource: "sendatrack", status: "Loading",
    });
    return { ...delivery };
  },
  async recordEvent(deliveryId, type, progress) {
    if (deliveryEvents.some((event) => event.deliveryId === deliveryId && event.type === type)) return false;
    deliveryEvents.push({ deliveryId, type, progress, createdAt: new Date() });
    return true;
  },
  async listEvents(deliveryId) {
    return deliveryEvents.filter((event) => event.deliveryId === deliveryId).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  },
  async recordEtaObservation(input) {
    if (etaObservations.some((item) => item.deliveryId === input.deliveryId && item.positionAt.getTime() === input.positionAt.getTime())) return false;
    etaObservations.push({ ...input, createdAt: new Date() });
    return true;
  },
  async listEtaObservations(deliveryId, limit = 200) {
    return etaObservations.filter((item) => item.deliveryId === deliveryId).sort((a, b) => b.positionAt.getTime() - a.positionAt.getTime()).slice(0, Math.max(1, Math.min(2000, limit)));
  },
  async listEtaObservationsForRoute(routeTemplateId, destinationSiteId, limit = 5000) {
    return etaObservations
      .filter((item) => item.routeTemplateId === routeTemplateId && item.destinationSiteId === destinationSiteId)
      .sort((a, b) => b.positionAt.getTime() - a.positionAt.getTime())
      .slice(0, Math.max(1, Math.min(10000, limit)));
  },
  async recordTripPosition(input) {
    if (tripPositions.some((item) => item.tripInstanceId === input.tripInstanceId && item.positionAt.getTime() === input.positionAt.getTime())) return false;
    tripPositions.push({ ...input, createdAt: new Date() });
    return true;
  },
  async listTripPositionsForRoute(companyId, routeTemplateId, limit = 10000) {
    return tripPositions
      .filter((item) => item.companyId === companyId && item.routeTemplateId === routeTemplateId)
      .sort((a, b) => b.positionAt.getTime() - a.positionAt.getTime())
      .slice(0, Math.max(1, Math.min(20000, limit)));
  },
  async upsertTrip(input) {
    const existing = trips.find((trip) => trip.id === input.id && trip.companyId === input.companyId);
    if (existing) {
      existing.routeTemplateId = input.routeTemplateId;
      existing.vehicleKey = input.vehicleKey;
      existing.truck = input.truck;
      existing.sendatrackVehicleId = input.sendatrackVehicleId;
      existing.originSiteId = input.originSiteId;
      existing.stops = input.stops.map((stop) => ({ ...stop }));
      existing.status = input.status;
      existing.updatedAt = new Date();
      return { ...existing, stops: existing.stops.map((stop) => ({ ...stop })) };
    }
    const now = new Date();
    const trip: TripRecord = { ...input, stops: input.stops.map((stop) => ({ ...stop })), createdAt: now, updatedAt: now };
    trips.push(trip);
    return { ...trip, stops: trip.stops.map((stop) => ({ ...stop })) };
  },
  async getTrip(companyId, tripId) {
    const trip = trips.find((item) => item.companyId === companyId && item.id === tripId);
    return trip ? { ...trip, stops: trip.stops.map((stop) => ({ ...stop })) } : null;
  },
  async listTrips(companyId, limit = 100) {
    return trips.filter((trip) => trip.companyId === companyId).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()).slice(0, Math.max(1, Math.min(1000, limit))).map((trip) => ({ ...trip, stops: trip.stops.map((stop) => ({ ...stop })) }));
  },

  async assignDeliveryTrip(deliveryId, companyId, tripId) {
    const delivery = deliveryStore.find((item) => item.id === deliveryId && item.companyId === companyId);
    if (!delivery) return false;
    const key = `${companyId}:${deliveryId}`;
    const current = deliveryTripAssignments.get(key);
    if (current && current !== tripId) return false;
    deliveryTripAssignments.set(key, tripId);
    delivery.tripId = tripId;
    return true;
  },
  async assignDeliveryToPlannedTrip(deliveryId, companyId, tripId, truck, sendatrackVehicleId) {
    const delivery = deliveryStore.find((item) => item.id === deliveryId && item.companyId === companyId) ?? null;
    if (!delivery || delivery.status === "Delivered" || delivery.tripId || !isUnassignedVehicle(delivery)) return null;
    const key = `${companyId}:${deliveryId}`;
    if (deliveryTripAssignments.has(key)) return null;
    deliveryTripAssignments.set(key, tripId);
    Object.assign(delivery, { tripId, truck, sendatrackVehicleId });
    return { ...delivery };
  },
  async listDeliveryIdsForTrip(companyId, tripId) {
    return [...deliveryTripAssignments.entries()]
      .filter(([key, assignedTripId]) => key.startsWith(`${companyId}:`) && assignedTripId === tripId)
      .map(([key]) => key.slice(companyId.length + 1));
  },

  async listPendingNotifications(companyId) {
    return deliveryEvents.flatMap((event) => {
      if (!customerFacingEvent(event.type)) return [];
      const delivery = deliveryStore.find((item) => item.id === event.deliveryId && item.companyId === companyId);
      if (!delivery) return [];
      if (!notificationClaims.isPending(notificationKey(event.deliveryId, event.type))) return [];
      return [{ delivery: { ...delivery }, event: { ...event } }];
    });
  },
  async claimNotification(deliveryId, type) {
    return notificationClaims.claim(notificationKey(deliveryId, type));
  },
  async markNotificationSent(deliveryId, type) {
    notificationClaims.markSent(notificationKey(deliveryId, type));
  },
  async releaseNotification(deliveryId, type) {
    notificationClaims.release(notificationKey(deliveryId, type));
  },
  async create(input: CreateDeliveryInput) {
    const delivery: DeliveryRow = { ...input, id: `TF-${String(Date.now()).slice(-6)}`, createdAt: new Date() };
    deliveryStore.push(delivery);
    return delivery;
  },
};