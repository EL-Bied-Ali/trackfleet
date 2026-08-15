import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const deliveries = sqliteTable("deliveries", {
  id: text("id").primaryKey(),
  customer: text("customer").notNull(),
  destination: text("destination").notNull(),
  truck: text("truck").notNull(),
  driver: text("driver").notNull(),
  status: text("status", { enum: ["In transit", "Delayed", "Loading", "Delivered"] }).notNull(),
  eta: text("eta").notNull(),
  progress: integer("progress").notNull().default(0),
  color: text("color").notNull().default("#916ed7"),
  contact: text("contact").notNull().default(""),
  sendatrackVehicleId: text("sendatrack_vehicle_id").notNull().default(""),
  latitude: real("latitude"),
  longitude: real("longitude"),
  speed: real("speed"),
  lastPositionAt: integer("last_position_at", { mode: "timestamp_ms" }),
  gpsSource: text("gps_source").notNull().default("simulation"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});
