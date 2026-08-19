import "./postgres-runtime-bootstrap";
import { store as baseStore } from "./delivery-store.vercel";
import { loadPostgresDashboardHistory } from "./delivery-store.postgres-dashboard-history";
import type { DeliveryStore } from "./delivery-store.types";

export const store: DeliveryStore = {
  ...baseStore,
  loadDashboardHistory: loadPostgresDashboardHistory,
};
