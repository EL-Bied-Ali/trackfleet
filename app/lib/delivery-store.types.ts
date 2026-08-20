import type { DeliveryEventType } from "./delivery-events";
import type { SendatrackSnapshot, SendatrackVehicle } from "./sendatrack";
import type { TripRecord, UpsertTripInput } from "./trip-record";

export type DeliveryStatus = "In transit" | "Delayed" | "Loading" | "Delivered";
export type DeliveryPriceCurrency = "EUR" | "MAD";

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
  recipientName?: string;
  recipientContact?: string;
  weightKg?: number | null;
  priceAmount?: number | null;
  priceCurrency?: DeliveryPriceCurrency | null;
  whatsappOptIn?: boolean;
  whatsappOptInAt?: Date | null;
  recipientWhatsappOptIn?: boolean;
  recipientWhatsappOptInAt?: Date | null;
  sendatrackVehicleId: string;
  latitude: number | null;
  longitude: number | null;
  speed: number | null;
  lastPositionAt: Date | null;
  gpsSource: string;
  companyId: string;
  trackingToken: string | null;
  tripId?: string | null;
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

export type FleetPositionInput = {
  companyId: string;
  vehicleId: string;
  vehicleName: string;
  positionAt: Date;
  latitude: number;
  longitude: number;
  speed: number;
  heading: number | null;
  address: string;
};

export type FleetPositionRow = FleetPositionInput & {
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
  listTripPositionsForRoute(companyId: string, routeTemplateId: string, limit?: number): Promise<TripPositionRow[]>;
  recordFleetPosition(input: FleetPositionInput): Promise<boolean>;
  listFleetPositions(companyId: string, vehicleId: string, limit?: number): Promise<FleetPositionRow[]>;
  upsertTrip(input: UpsertTripInput): Promise<TripRecord>;
  getTrip(companyId: string, tripId: string): Promise<TripRecord | null>;
  listTrips(companyId: string, limit?: number): Promise<TripRecord[]>;
  assignDeliveryTrip(deliveryId: string, companyId: string, tripId: string): Promise<boolean>;
  assignDeliveryToPlannedTrip(deliveryId: string, companyId: string, tripId: string, truck: string, sendatrackVehicleId: string): Promise<DeliveryRow | null>;
  listDeliveryIdsForTrip(companyId: string, tripId: string): Promise<string[]>;
  listPendingNotifications(companyId: string): Promise<PendingDeliveryNotification[]>;
  claimNotification(deliveryId: string, type: DeliveryEventType): Promise<boolean>;
  markNotificationSent(deliveryId: string, type: DeliveryEventType): Promise<void>;
  releaseNotification(deliveryId: string, type: DeliveryEventType): Promise<void>;
  create(input: CreateDeliveryInput): Promise<DeliveryRow>;
}
