import { seedDeliveries } from "./delivery-seed";
import { customerFacingEvent, detectDeliveryEvents, type DeliveryEventType } from "./delivery-events";
import type { CreateDeliveryInput, DeliveryEventRow, DeliveryRow, DeliveryStore, DeliveryTransition } from "./delivery-store.types";
import { NotificationClaimState } from "./notification-claim-state";
import { calculateRouteMetrics, deriveDeliveryState, rebaseRouteMetrics } from "./route-progress";
import type { SendatrackSnapshot } from "./sendatrack";

const deliveryStore = seedDeliveries.map((delivery) => ({ ...delivery }));
const deliveryEvents: DeliveryEventRow[] = [];
const notificationClaims = new NotificationClaimState();

function key(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}
function notificationKey(deliveryId: string, type: DeliveryEventType) { return `${deliveryId}:${type}:whatsapp`; }
function baselineProgress(deliveryId: string) {
  return deliveryEvents.find((event) => event.deliveryId === deliveryId && event.type === "GPS_BASELINE")?.progress ?? 0;
}
function explicitDestination(delivery: DeliveryRow): [number, number] | null {
  return typeof delivery.destinationLatitude === "number" && typeof delivery.destinationLongitude === "number"
    ? [delivery.destinationLongitude, delivery.destinationLatitude]
    : null;
}

export const store: DeliveryStore = {
  async getPublic(tracking) {
    return deliveryStore.find((delivery) => delivery.trackingToken === tracking || (delivery.companyId === "demo" && delivery.id === tracking)) ?? null;
  },
  async listForCompany(companyId) {
    return deliveryStore.filter((delivery) => delivery.companyId === companyId || delivery.companyId === "demo").sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  },
  async applySendatrackSnapshot(snapshot: SendatrackSnapshot, companyId: string) {
    const transitions: DeliveryTransition[] = [];
    if (!snapshot.connected || !snapshot.vehicles.length) return transitions;
    for (const delivery of deliveryStore) {
      if (delivery.status === "Delivered" || (delivery.companyId !== companyId && delivery.companyId !== "demo")) continue;
      const vehicle = snapshot.vehicles.find((item) => item.id === delivery.sendatrackVehicleId)
        ?? snapshot.vehicles.find((item) => key(item.name) === key(delivery.truck));
      if (!vehicle) continue;
      const previousStatus = delivery.status;
      const previousProgress = delivery.progress;
      const absoluteMetrics = calculateRouteMetrics(vehicle.latitude, vehicle.longitude, delivery.destination, explicitDestination(delivery));
      const metrics = rebaseRouteMetrics(absoluteMetrics, baselineProgress(delivery.id));
      const state = deriveDeliveryState(delivery.status, metrics, vehicle.speed, previousProgress, delivery.arrivalRadiusKm);
      const positionAgeMinutes = Math.max(0, Math.round((Date.now() - vehicle.updatedAt) / 60_000));
      const events = detectDeliveryEvents({ previousStatus, nextStatus: state.status, previousProgress, nextProgress: state.progress, distanceToDestinationKm: metrics.distanceToDestinationKm, positionAgeMinutes });
      Object.assign(delivery, { sendatrackVehicleId: vehicle.id, truck: vehicle.name, latitude: vehicle.latitude, longitude: vehicle.longitude, speed: vehicle.speed, lastPositionAt: new Date(vehicle.updatedAt), gpsSource: "sendatrack", progress: state.progress, status: state.status });
      transitions.push({ delivery: { ...delivery }, events });
    }
    return transitions;
  },
  async recordEvent(deliveryId, type, progress) {
    if (deliveryEvents.some((event) => event.deliveryId === deliveryId && event.type === type)) return false;
    deliveryEvents.push({ deliveryId, type, progress, createdAt: new Date() });
    return true;
  },
  async listEvents(deliveryId) {
    return deliveryEvents.filter((event) => event.deliveryId === deliveryId).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  },
  async listPendingNotifications(companyId) {
    return deliveryEvents.flatMap((event) => {
      if (!customerFacingEvent(event.type)) return [];
      const delivery = deliveryStore.find((item) => item.id === event.deliveryId && (item.companyId === companyId || item.companyId === "demo"));
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
