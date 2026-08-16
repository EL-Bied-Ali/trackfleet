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
  sendatrackVehicleId: text("sendatrack_vehicle_id").notNull().default(""),
  latitude: real("latitude"),
  longitude: real("longitude"),
  speed: real("speed"),
  lastPositionAt: integer("last_position_at", { mode: "timestamp_ms" }),
  gpsSource: text("gps_source").notNull().default("simulation"),
  companyId: text("company_id").notNull().default("demo"),
  trackingToken: text("tracking_token"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  index("idx_deliveries_company_id").on(table.companyId),
  uniqueIndex("idx_deliveries_tracking_token").on(table.trackingToken),
]);

export const deliveryEvents = sqliteTable("delivery_events", {
  deliveryId: text("delivery_id").notNull(),
  type: text("type", { enum: [
    "GPS_BASELINE",
    "DEPARTED",
    "PROGRESS_25",
    "PROGRESS_50",
    "PROGRESS_75",
    "NEAR_DESTINATION",
    "DELAY_DETECTED",
    "ARRIVED",
    "GPS_STALE",
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
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  index("idx_sessions_company_id").on(table.companyId),
  index("idx_sessions_expires_at").on(table.expiresAt),
]);
