import type { DeliveryEventType } from "./delivery-events";
import type { SendatrackSnapshot, SendatrackVehicle } from "./sendatrack";

export type DeliveryStatus = "In transit" | "Delayed" | "Loading" | "Delivered";

export type DeliveryRow = {
  id: string;
  customer: string;
  originSiteId: string | null;
  originLatitude: number | null;
  originLongitude: number | null;
  destinationSiteId: string | null;
  destination: string;
  destinationLatitude: number | null;
  destinationLongitude: number | null;
  arrivalRadiusKm: number;
  truck: string;
  driver: string;
  status: DeliveryStatus;
  eta: string;
  plannedArrivalAt: Date | null;
  progress: number;
  color: string;
  contact: string;
  sendatrackVehicleId: string;
  latitude: number | null;
  longitude: number | null;
  speed: number | null;
  lastPositionAt: Date | null;
  gpsSource: string;
  companyId: string;
  trackingToken: string | null;
  createdAt: Date;
};

export type DeliveryEventRow = {
  deliveryId: string;
  type: DeliveryEventType;
  progress: number;
  createdAt: Date;
};

export type EtaObservationInput = {
  deliveryId: string;
  routeTemplateId: string | null;
  tripInstanceId: string | null;
  destinationSiteId: string | null;
  positionAt: Date;
  estimatedArrivalAt: Date;
  plannedArrivalAt: Date | null;
  delayMinutes: number | null;
  effectiveSpeedKmh: number | null;
  remainingDistanceKm: number;
  progress: number;
  confidence: "none" | "low" | "medium";
  source: "unavailable" | "baseline-model" | "route-history" | "observed-pace";
};

export type EtaObservationRow = EtaObservationInput & {
  createdAt: Date;
};

export type TripPositionInput = {
  companyId: string;
  routeTemplateId: string;
  tripInstanceId: string;
  vehicleId: string;
  positionAt: Date;
  latitude: number;
  longitude: number;
  speed: number;
};

export type TripPositionRow = TripPositionInput & {
  createdAt: Date;
};

export type DeliveryTransition = {
  delivery: DeliveryRow;
  events: DeliveryEventType[];
};

export type PendingDeliveryNotification = {
  delivery: DeliveryRow;
  event: DeliveryEventRow;
};

export type CreateDeliveryInput = Omit<DeliveryRow, "id" | "trackingToken" | "createdAt"> & {
  trackingToken: string;
};

export interface DeliveryStore {
  getPublic(tracking: string): Promise<DeliveryRow | null>;
  listForCompany(companyId: string): Promise<DeliveryRow[]>;
  applySendatrackSnapshot(snapshot: SendatrackSnapshot, companyId: string): Promise<DeliveryTransition[]>;
  linkVehicle(deliveryId: string, companyId: string, vehicle: SendatrackVehicle): Promise<DeliveryRow | null>;
  recordEvent(deliveryId: string, type: DeliveryEventType, progress: number): Promise<boolean>;
  listEvents(deliveryId: string): Promise<DeliveryEventRow[]>;
  recordEtaObservation(input: EtaObservationInput): Promise<boolean>;
  listEtaObservations(deliveryId: string, limit?: number): Promise<EtaObservationRow[]>;
  listEtaObservationsForRoute(routeTemplateId: string, destinationSiteId: string, limit?: number): Promise<EtaObservationRow[]>;
  recordTripPosition(input: TripPositionInput): Promise<boolean>;
  listTripPositionsForRoute(routeTemplateId: string, limit?: number): Promise<TripPositionRow[]>;
  listPendingNotifications(companyId: string): Promise<PendingDeliveryNotification[]>;
  claimNotification(deliveryId: string, type: DeliveryEventType): Promise<boolean>;
  markNotificationSent(deliveryId: string, type: DeliveryEventType): Promise<void>;
  releaseNotification(deliveryId: string, type: DeliveryEventType): Promise<void>;
  create(input: CreateDeliveryInput): Promise<DeliveryRow>;
}
