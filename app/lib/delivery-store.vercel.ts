import { memoryStore } from "./delivery-store.memory";
import type { DeliveryStore } from "./delivery-store.types";

// Local previews and CI can keep using the zero-config memory store. Production
// Vercel becomes durable as soon as DATABASE_URL is configured (for example by
// a Neon integration). Dynamic import avoids even initializing the DB driver in
// environments that intentionally have no database.
export const store: DeliveryStore = process.env.DATABASE_URL?.trim()
  ? (await import("./delivery-store.postgres")).postgresStore
  : memoryStore;
