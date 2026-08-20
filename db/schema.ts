import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const deliveries = sqliteTable("deliveries", {
  id: text("id").primaryKey(),
  customer: text("customer").notNull(),
  originSiteId: text("origin_site_id"),
  originLatitude: real("origin_latitude"),
  originLongitude: real("origin_longitude"),
  destinationSiteId: text("destination_site_id"),
  destination: text("destination").notNull(),
  destinationLatitude: real("destination_latitude"),
  destinationLongitude: real("destination_longitude"),
  arrivalRadiusKm: real("arrival_radius_km").notNull().default(0.5),
  truck: text("truck").notNull(),
  driver: text("driver").notNull(),
  status: text("status", { enum: ["In transit", "Delayed", "Loading", "Delivered"] }).notNull(),
  eta: text("eta").notNull(),
  plannedArrivalAt: integer("planned_arrival_at", { mode: "timestamp_ms" }),
  progress: integer("progress").notNull().default(0),
  color: text("color").notNull().default("#916ed7"),
  contact: text("contact").notNull().default(""),
  recipientName: text("recipient_name").notNull().default(""),
  recipientContact: text("recipient_contact").notNull().default(""),
  whatsappOptIn: integer("whatsapp_opt_in", { mode: "boolean" }).notNull().default(false),
  whatsappOptInAt: integer("whatsapp_opt_in_at", { mode: "timestamp_ms" }),
  recipientWhatsappOptIn: integer("recipient_whatsapp_opt_in", { mode: "boolean" }).notNull().default(false),
  recipientWhatsappOptInAt: integer("recipient_whatsapp_opt_in_at", { mode: "timestamp_ms" }),
  sendatrackVehicleId: text("sendatrack_vehicle_id").notNull().default(""),
  latitude: real("latitude"),
  longitude: real("longitude"),
  speed: real("speed"),
  lastPositionAt: integer("last_position_at", { mode: "timestamp_ms" }),
  gpsSource: text("gps_source").notNull().default("simulation"),
  companyId: text("company_id").notNull().default("demo"),
  tripId: text("trip_id"),
  trackingToken: text("tracking_token"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  index("idx_deliveries_company_id").on(table.companyId),
  index("idx_deliveries_company_trip").on(table.companyId, table.tripId),
  uniqueIndex("idx_deliveries_tracking_token").on(table.trackingToken),
]);

export const deliveryEvents = sqliteTable("delivery_events", {
  deliveryId: text("delivery_id").notNull(),
  type: text("type", { enum: [
    "GPS_BASELINE",
    "REGISTERED",
    "DEPARTED",
    "PROGRESS_25",
    "PROGRESS_50",
    "PROGRESS_75",
    "NEAR_DESTINATION",
    "DELAY_DETECTED",
    "ARRIVED_AT_SITE",
    "MANUAL_ARRIVAL_CONFIRMED",
    "ARRIVED",
    "MANUAL_DELIVERED",
    "GPS_STALE",
    "WHATSAPP_OPT_OUT",
  ] }).notNull(),
  progress: integer("progress").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.deliveryId, table.type] }),
  index("idx_delivery_events_delivery_id").on(table.deliveryId),
]);

export const deliveryNotifications = sqliteTable("delivery_notifications", {
  deliveryId: text("delivery_id").notNull(),
  eventType: text("event_type").notNull(),
  channel: text("channel").notNull(),
  attemptedAt: integer("attempted_at", { mode: "timestamp_ms" }).notNull(),
  sentAt: integer("sent_at", { mode: "timestamp_ms" }),
}, (table) => [
  primaryKey({ columns: [table.deliveryId, table.eventType, table.channel] }),
]);

export const deliveryEtaObservations = sqliteTable("delivery_eta_observations", {
  deliveryId: text("delivery_id").notNull(),
  routeTemplateId: text("route_template_id"),
  tripInstanceId: text("trip_instance_id"),
  destinationSiteId: text("destination_site_id"),
  positionAt: integer("position_at", { mode: "timestamp_ms" }).notNull(),
  estimatedArrivalAt: integer("estimated_arrival_at", { mode: "timestamp_ms" }).notNull(),
  plannedArrivalAt: integer("planned_arrival_at", { mode: "timestamp_ms" }),
  delayMinutes: integer("delay_minutes"),
  effectiveSpeedKmh: real("effective_speed_kmh"),
  remainingDistanceKm: real("remaining_distance_km").notNull(),
  progress: integer("progress").notNull(),
  confidence: text("confidence", { enum: ["none", "low", "medium"] }).notNull(),
  source: text("source", { enum: ["unavailable", "baseline-model", "route-history", "observed-pace"] }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.deliveryId, table.positionAt] }),
  index("idx_eta_observations_delivery_position").on(table.deliveryId, table.positionAt),
  index("idx_eta_observations_route_destination").on(table.routeTemplateId, table.destinationSiteId, table.positionAt),
]);

export const companies = sqliteTable("companies", {
  id: text("id").primaryKey(),
  accountLabel: text("account_label").notNull(),
  userLabel: text("user_label").notNull(),
  credentialsCiphertext: text("credentials_ciphertext").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  companyId: text("company_id").notNull(),
  accountLabel: text("account_label"),
  userLabel: text("user_label"),
  credentialsCiphertext: text("credentials_ciphertext"),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  index("idx_sessions_company_id").on(table.companyId),
  index("idx_sessions_expires_at").on(table.expiresAt),
]);

export const tripPositionObservations = sqliteTable("trip_position_observations", {
  companyId: text("company_id").notNull(),
  routeTemplateId: text("route_template_id").notNull(),
  tripInstanceId: text("trip_instance_id").notNull(),
  vehicleId: text("vehicle_id").notNull(),
  positionAt: integer("position_at", { mode: "timestamp_ms" }).notNull(),
  latitude: real("latitude").notNull(),
  longitude: real("longitude").notNull(),
  speed: real("speed").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.companyId, table.tripInstanceId, table.positionAt] }),
  index("idx_trip_positions_company_route").on(table.companyId, table.routeTemplateId, table.positionAt),
]);

export const fleetPositionObservations = sqliteTable("fleet_position_observations", {
  companyId: text("company_id").notNull(),
  vehicleId: text("vehicle_id").notNull(),
  vehicleName: text("vehicle_name").notNull(),
  positionAt: integer("position_at", { mode: "timestamp_ms" }).notNull(),
  latitude: real("latitude").notNull(),
  longitude: real("longitude").notNull(),
  speed: real("speed").notNull(),
  heading: real("heading"),
  address: text("address").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.companyId, table.vehicleId, table.positionAt] }),
  index("idx_fleet_positions_company_vehicle").on(table.companyId, table.vehicleId, table.positionAt),
]);

export const trips = sqliteTable("trips", {
  id: text("id").notNull(),
  companyId: text("company_id").notNull(),
  routeTemplateId: text("route_template_id").notNull(),
  vehicleKey: text("vehicle_key").notNull(),
  truck: text("truck").notNull(),
  sendatrackVehicleId: text("sendatrack_vehicle_id").notNull().default(""),
  originSiteId: text("origin_site_id"),
  stopsJson: text("stops_json").notNull(),
  status: text("status", { enum: ["planned", "active", "completed"] }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.companyId, table.id] }),
  index("idx_trips_company_updated").on(table.companyId, table.updatedAt),
]);
