import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});
