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
  // Employee-entered date/time the next relay truck is expected to depart
  // (distinct from plannedArrivalAt, which is the customer-facing arrival
  // estimate). Required at creation time going forward (see
  // app/api/deliveries/route.ts), but nullable in the stored row since
  // deliveries created before this field existed won't have it.
  nextTruckDepartureAt: Date | null;
  progress: number;
  color: string;
  contact: string;
  recipientName?: string;
  recipientContact?: string;
  weightKg?: number | null;
  priceAmount?: number | null;
  priceCurrency?: DeliveryPriceCurrency | null;
  // Free-text description of what the parcel actually is -- required at
  // creation time when weightKg is absent (a bulky item priced manually,
  // e.g. a TV or washing machine, per app/api/deliveries/route.ts), since
  // there's otherwise nothing distinguishing one unweighed parcel from
  // another in the table or on the customer tracking page.
  itemDescription?: string | null;
  customerEmail?: string | null;
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
  // Client-generated per submission (not per delivery) so a dispatcher
  // entering several parcels for one customer in one sitting can link them
  // together -- each parcel still gets its own id/tracking/weight/price,
  // this is purely a grouping key. Null for parcels created before this
  // existed, or for any single-parcel submission (no siblings to link).
  shipmentId?: string | null;
  createdAt: Date;
  // Short QR/Code128 label identifier, separate from trackingToken (see
  // parcel-code.ts) -- generated at creation, null only for deliveries
  // created before this feature existed.
  parcelCode?: string | null;
};

export type DeliveryEventRow = {
  deliveryId: string;
  type: DeliveryEventType;
  progress: number;
  createdAt: Date;
};

export type EtaObservationInput = {
  companyId: string;
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

export type DeliveryScanCheckpoint = "loaded" | "departed" | "arrived" | "delivered";

// A full, unconstrained audit trail (see app/api/scan/route.ts) -- unlike
// DeliveryEventRow, the same (deliveryId, checkpoint) pair can appear more
// than once here, since a legitimate re-scan of the same checkpoint (a
// second handler, a QC re-check) is real information, not a duplicate to
// silently drop the way recordEvent's UNIQUE (delivery_id, type) does.
export type DeliveryScanInput = {
  companyId: string;
  deliveryId: string;
  checkpoint: DeliveryScanCheckpoint;
  scannedBy: string;
  truck: string | null;
  locationLabel: string | null;
};

export type DeliveryScanRow = DeliveryScanInput & {
  id: string;
  scannedAt: Date;
};

export type PendingDeliveryNotification = {
  delivery: DeliveryRow;
  event: DeliveryEventRow;
};

export type CreateDeliveryInput = Omit<DeliveryRow, "id" | "trackingToken" | "createdAt"> & {
  trackingToken: string;
};

export type DeliveryDetailsUpdateInput = {
  customer: string;
  contact: string;
  customerEmail: string | null;
  recipientName: string;
  recipientContact: string;
  weightKg: number | null;
  priceAmount: number | null;
  priceCurrency: DeliveryPriceCurrency | null;
  itemDescription: string | null;
  destinationSiteId: string | null;
  destination: string;
  destinationLatitude: number | null;
  destinationLongitude: number | null;
  arrivalRadiusKm: number;
  plannedArrivalAt: Date | null;
};

export interface DeliveryStore {
  getPublic(tracking: string): Promise<DeliveryRow | null>;
  listForCompany(companyId: string): Promise<DeliveryRow[]>;
  applySendatrackSnapshot(snapshot: SendatrackSnapshot, companyId: string): Promise<DeliveryTransition[]>;
  linkVehicle(deliveryId: string, companyId: string, vehicle: SendatrackVehicle): Promise<DeliveryRow | null>;
  // Same effect as calling linkVehicle once per id, but atomic across the
  // whole group -- linkVehicle's own "unassign this vehicle from any OTHER
  // delivery that currently holds it" safety guard only excludes the ONE
  // delivery being linked, so naively looping it once per parcel in a group
  // would have each call strip the vehicle right back off the parcel(s) the
  // previous call(s) just assigned it to. This does the unassign-others and
  // assign-to-group steps as one operation instead, excluding every id in
  // the group at once. Deliveries not found (wrong company, already
  // Delivered, unknown id) are silently skipped -- returns only the ones
  // actually updated.
  linkVehicleToGroup(deliveryIds: string[], companyId: string, vehicle: SendatrackVehicle): Promise<DeliveryRow[]>;
  updateSchedule(deliveryId: string, companyId: string, input: { plannedArrivalAt: Date | null; nextTruckDepartureAt: Date | null }): Promise<DeliveryRow | null>;
  // Edits the "content" fields of an existing, not-yet-delivered delivery
  // (client identity, recipient, weight/price, description, and
  // destination) -- everything the full creation form can set except
  // truck/vehicle (linkVehicle/linkVehicleToGroup) and next departure
  // (updateSchedule), which keep their own dedicated, already-hardened
  // paths (trip reassignment, double-booking safety) rather than being
  // folded in here. Blocked once Delivered, same guard as
  // updateSchedule/linkVehicle.
  updateDetails(deliveryId: string, companyId: string, input: DeliveryDetailsUpdateInput): Promise<DeliveryRow | null>;
  // Company-scoped so a scan session (dispatcher or agency, never a bare
  // public lookup like getPublic/trackingToken) can only ever resolve its
  // own company's parcels -- see app/lib/parcel-code.ts for why this code
  // doesn't need to be a standalone bearer secret the way trackingToken is.
  findByParcelCode(companyId: string, parcelCode: string): Promise<DeliveryRow | null>;
  recordScan(input: DeliveryScanInput): Promise<DeliveryScanRow>;
  // Most-recent-first, used both to render a delivery's scan history and to
  // detect an accidental duplicate scan (see app/api/scan/route.ts).
  listScansForDelivery(deliveryId: string, limit?: number): Promise<DeliveryScanRow[]>;
  recordEvent(deliveryId: string, type: DeliveryEventType, progress: number): Promise<boolean>;
  listEvents(deliveryId: string): Promise<DeliveryEventRow[]>;
  recordEtaObservation(input: EtaObservationInput): Promise<boolean>;
  listEtaObservations(deliveryId: string, limit?: number): Promise<EtaObservationRow[]>;
  listEtaObservationsForRoute(companyId: string, routeTemplateId: string, destinationSiteId: string, limit?: number): Promise<EtaObservationRow[]>;
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
  // Both unscoped by company, matching getPublic's existing global-lookup
  // pattern -- an inbound WhatsApp message arrives with no company context
  // at all (the webhook only knows which Meta phone number received it, and
  // today exactly one company has one configured), so there is no companyId
  // to scope by. "Active" means not yet Delivered; ties broken by most
  // recent createdAt, per product decision (see whatsapp-inbound.ts).
  // findMostRecentActiveDeliveryByContact matches EITHER contact (the
  // sender) OR recipientContact (the recipient) -- either party texting in
  // is a legitimate lookup, per explicit product decision.
  findMostRecentActiveDeliveryByContact(phone: string): Promise<DeliveryRow | null>;
  findMostRecentActiveDeliveryByCustomerNameQuery(query: string): Promise<DeliveryRow | null>;
  claimNotification(deliveryId: string, type: DeliveryEventType): Promise<boolean>;
  markNotificationSent(deliveryId: string, type: DeliveryEventType): Promise<void>;
  releaseNotification(deliveryId: string, type: DeliveryEventType): Promise<void>;
  create(input: CreateDeliveryInput): Promise<DeliveryRow>;
  // Bulk-deletes every delivery for this company whose customer name starts
  // with DEMO_DELIVERY_CUSTOMER_PREFIX (see demo-delivery.ts), along with
  // their events/notifications/eta observations -- backs the dispatcher's
  // "Supprimer les livraisons démo" cleanup action. Scoped to the marker
  // prefix specifically so this can never touch a real customer delivery.
  // Returns the number of deliveries deleted.
  deleteDemoDeliveries(companyId: string): Promise<number>;
  // Permanently removes one delivery (and its events/eta observations),
  // scoped to this company -- backs the dispatcher's per-row delete action
  // (gated behind a confirmation in the UI, see page.tsx). Returns false
  // when nothing matched (wrong company or already-removed id) so the
  // route can 404 instead of silently succeeding.
  deleteDelivery(deliveryId: string, companyId: string): Promise<boolean>;
  // Teleports a [DEMO]-prefixed delivery's status/progress/position, backing
  // the dispatcher's "Faire avancer le camion" demo-walkthrough button (see
  // demo-advance.ts) -- there's no real truck or SENDATRACK feed behind a
  // demo delivery, so progress has to be set directly rather than observed
  // from GPS. Scoped to the DEMO_DELIVERY_CUSTOMER_PREFIX marker at the
  // storage layer itself (same defense-in-depth as deleteDemoDeliveries), so
  // this can never be used to fake-move a real delivery even if a route-level
  // check were ever missed.
  advanceDemoDelivery(deliveryId: string, companyId: string, input: { status: DeliveryStatus; progress: number; latitude: number; longitude: number; speed: number }): Promise<DeliveryRow | null>;
}
