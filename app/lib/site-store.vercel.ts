import { memorySiteStore } from "./site-store.memory";
import type { SiteStore } from "./site-store.types";

export const siteStore: SiteStore = process.env.DATABASE_URL?.trim()
  ? (await import("./site-store.postgres")).postgresSiteStore
  : memorySiteStore;
