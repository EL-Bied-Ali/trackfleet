import { seedDeliveries } from "./delivery-seed.ts";
import { customerFacingEvent, detectDeliveryEvents, type DeliveryEventType } from "./delivery-events.ts";
import { createDeliveryId } from "./delivery-id.ts";
import type { CreateDeliveryInput, DeliveryEventRow, DeliveryRow, DeliveryStore, DeliveryTransition, EtaObservationRow, FleetPositionRow, TripPositionRow } from "./delivery-store.types.ts";
import { NotificationClaimState } from "./notification-claim-state.ts";
import { progressRouteDestination } from "./delivery-progress-destination.ts";
import { calculateRouteMetrics, deriveDeliveryState, rebaseRouteMetrics } from "./route-progress.ts";
import type { SendatrackSnapshot } from "./sendatrack.ts";
import { matchDeliveryVehicle } from "./vehicle-linking.ts";
import { isUnassignedVehicle } from "./delivery-vehicle-choice.ts";
import type { TripRecord } from "./trip-record.ts";
import { DEMO_DELIVERY_CUSTOMER_PREFIX } from "./demo-delivery.ts";

const deliveryStore = seedDeliveries.map((delivery) => ({ ...delivery }));
const deliveryEvents: DeliveryEventRow[] = [];
const etaObservations: EtaObservationRow[] = [];
const tripPositions: TripPositionRow[] = [];
const fleetPositions: FleetPositionRow[] = [];
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
  async findMostRecentActiveDeliveryByContact(phone) {
    // Either party texting in gets matched -- the sender tracking what they
    // shipped and the recipient tracking what's coming to them are both
    // legitimate, per the user's explicit call.
    const matches = deliveryStore.filter((delivery) => (delivery.contact === phone || delivery.recipientContact === phone) && delivery.status !== "Delivered");
    matches.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return matches[0] ?? null;
  },
  async findMostRecentActiveDeliveryByCustomerNameQuery(query) {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return null;
    const matches = deliveryStore.filter((delivery) => delivery.status !== "Delivered" && delivery.customer.toLowerCase().includes(trimmed));
    matches.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return matches[0] ?? null;
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
      const progressDestination = progressRouteDestination({ destination: delivery.destination, destinationSiteId: delivery.destinationSiteId, explicitDestination: explicitDestination(delivery) });
      const absoluteMetrics = calculateRouteMetrics(vehicle.latitude, vehicle.longitude, progressDestination.destination, progressDestination.explicitDestination, explicitOrigin(delivery));
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
    const progressDestination = progressRouteDestination({ destination: delivery.destination, destinationSiteId: delivery.destinationSiteId, explicitDestination: explicitDestination(delivery) });
    const metrics = calculateRouteMetrics(vehicle.latitude, vehicle.longitude, progressDestination.destination, progressDestination.explicitDestination, explicitOrigin(delivery));
    if (!deliveryEvents.some((event) => event.deliveryId === delivery.id && event.type === "GPS_BASELINE")) {
      deliveryEvents.push({ deliveryId: delivery.id, type: "GPS_BASELINE", progress: metrics.progress, createdAt: new Date() });
    }
    // No longer clears the vehicle off any other active delivery already
    // riding it (that used to run unconditionally here). One truck legitimately
    // carrying several parcels at once is the group feature's whole premise --
    // this single-delivery path is now just linkVehicleToGroup with one member,
    // so it must not evict the truck's existing group the way it used to.
    // Reported live: adding one more unassigned parcel to an already-multi-parcel
    // truck via this per-row action silently kicked its existing members back to
    // unassigned (stale GPS position/status still attached -- a ghost truck on
    // the map) every time. vehicleAssignmentConflict in page.tsx still warns the
    // dispatcher the truck is in use; trusting that warning (not blocking) was
    // already the design, this just stopped corrupting data when they proceed.
    // A trip groups deliveries that share one truck's route (see
    // buildTruckStopPlans in truck-stop-plan.ts, keyed by tripId when
    // present). Moving this delivery onto a genuinely different truck means
    // it's no longer on that route, so it must leave the trip -- otherwise
    // the trip's own truck/vehicleKey record can end up describing a truck
    // that isn't actually what this delivery is on. Re-linking the same
    // vehicle it already has (a no-op reassignment) leaves the trip intact.
    const truckIsChanging = delivery.sendatrackVehicleId !== vehicle.id;
    Object.assign(delivery, {
      sendatrackVehicleId: vehicle.id, truck: vehicle.name, latitude: vehicle.latitude, longitude: vehicle.longitude,
      speed: vehicle.speed, lastPositionAt: new Date(vehicle.updatedAt), gpsSource: "sendatrack", status: "Loading",
      ...(truckIsChanging ? { tripId: null } : {}),
    });
    return { ...delivery };
  },
  async linkVehicleToGroup(deliveryIds, companyId, vehicle) {
    const ids = new Set(deliveryIds);
    const deliveries = deliveryStore.filter((item) => ids.has(item.id) && item.companyId === companyId && item.status !== "Delivered");
    if (!deliveries.length) return [];
    for (const delivery of deliveries) {
      const progressDestination = progressRouteDestination({ destination: delivery.destination, destinationSiteId: delivery.destinationSiteId, explicitDestination: explicitDestination(delivery) });
      const metrics = calculateRouteMetrics(vehicle.latitude, vehicle.longitude, progressDestination.destination, progressDestination.explicitDestination, explicitOrigin(delivery));
      if (!deliveryEvents.some((event) => event.deliveryId === delivery.id && event.type === "GPS_BASELINE")) {
        deliveryEvents.push({ deliveryId: delivery.id, type: "GPS_BASELINE", progress: metrics.progress, createdAt: new Date() });
      }
    }
    // No longer clears the vehicle off any other active delivery already
    // riding it (that used to run unconditionally here). One truck legitimately
    // carrying several parcels at once is the group feature's whole premise --
    // this must not evict the target truck's existing group the same way
    // linkVehicle used to (see that fix). Reassigning group A onto a truck
    // that already carries group B would otherwise silently kick B back to
    // unassigned, with its last GPS position/status still attached.
    for (const delivery of deliveries) {
      const truckIsChanging = delivery.sendatrackVehicleId !== vehicle.id;
      Object.assign(delivery, {
        sendatrackVehicleId: vehicle.id, truck: vehicle.name, latitude: vehicle.latitude, longitude: vehicle.longitude,
        speed: vehicle.speed, lastPositionAt: new Date(vehicle.updatedAt), gpsSource: "sendatrack", status: "Loading",
        ...(truckIsChanging ? { tripId: null } : {}),
      });
    }
    return deliveries.map((delivery) => ({ ...delivery }));
  },
  async updateSchedule(deliveryId, companyId, input) {
    const delivery = deliveryStore.find((item) => item.id === deliveryId && item.companyId === companyId) ?? null;
    if (!delivery || delivery.status === "Delivered") return null;
    Object.assign(delivery, { plannedArrivalAt: input.plannedArrivalAt, nextTruckDepartureAt: input.nextTruckDepartureAt });
    return { ...delivery };
  },
  async updateDetails(deliveryId, companyId, input) {
    const delivery = deliveryStore.find((item) => item.id === deliveryId && item.companyId === companyId) ?? null;
    if (!delivery || delivery.status === "Delivered") return null;
    Object.assign(delivery, input);
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
  async listEtaObservationsForRoute(companyId, routeTemplateId, destinationSiteId, limit = 5000) {
    return etaObservations
      .filter((item) => item.companyId === companyId && item.routeTemplateId === routeTemplateId && item.destinationSiteId === destinationSiteId)
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
  async recordFleetPosition(input) {
    if (fleetPositions.some((item) => item.companyId === input.companyId && item.vehicleId === input.vehicleId && item.positionAt.getTime() === input.positionAt.getTime())) return false;
    fleetPositions.push({ ...input, createdAt: new Date() });
    return true;
  },
  async listFleetPositions(companyId, vehicleId, limit = 20000) {
    return fleetPositions
      .filter((item) => item.companyId === companyId && item.vehicleId === vehicleId)
      .sort((a, b) => b.positionAt.getTime() - a.positionAt.getTime())
      .slice(0, Math.max(1, Math.min(50000, limit)));
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
    const delivery: DeliveryRow = { ...input, id: createDeliveryId(), createdAt: new Date() };
    deliveryStore.push(delivery);
    return delivery;
  },
  async deleteDemoDeliveries(companyId) {
    const ids = new Set(deliveryStore.filter((delivery) => delivery.companyId === companyId && delivery.customer.startsWith(DEMO_DELIVERY_CUSTOMER_PREFIX)).map((delivery) => delivery.id));
    if (!ids.size) return 0;
    for (let index = deliveryStore.length - 1; index >= 0; index -= 1) {
      if (ids.has(deliveryStore[index].id)) deliveryStore.splice(index, 1);
    }
    for (let index = deliveryEvents.length - 1; index >= 0; index -= 1) {
      if (ids.has(deliveryEvents[index].deliveryId)) deliveryEvents.splice(index, 1);
    }
    for (let index = etaObservations.length - 1; index >= 0; index -= 1) {
      if (ids.has(etaObservations[index].deliveryId)) etaObservations.splice(index, 1);
    }
    return ids.size;
  },
  async deleteDelivery(deliveryId, companyId) {
    const index = deliveryStore.findIndex((delivery) => delivery.id === deliveryId && delivery.companyId === companyId);
    if (index === -1) return false;
    deliveryStore.splice(index, 1);
    for (let eventIndex = deliveryEvents.length - 1; eventIndex >= 0; eventIndex -= 1) {
      if (deliveryEvents[eventIndex].deliveryId === deliveryId) deliveryEvents.splice(eventIndex, 1);
    }
    for (let etaIndex = etaObservations.length - 1; etaIndex >= 0; etaIndex -= 1) {
      if (etaObservations[etaIndex].deliveryId === deliveryId) etaObservations.splice(etaIndex, 1);
    }
    return true;
  },
  async advanceDemoDelivery(deliveryId, companyId, input) {
    const delivery = deliveryStore.find((item) => item.id === deliveryId && item.companyId === companyId && item.customer.startsWith(DEMO_DELIVERY_CUSTOMER_PREFIX)) ?? null;
    if (!delivery) return null;
    Object.assign(delivery, { status: input.status, progress: input.progress, latitude: input.latitude, longitude: input.longitude, speed: input.speed, lastPositionAt: new Date(), gpsSource: "simulation" as const });
    return { ...delivery };
  },
};
