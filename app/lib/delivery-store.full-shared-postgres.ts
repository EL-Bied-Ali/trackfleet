import "./postgres-runtime-bootstrap";
import { store as baseStore } from "./delivery-store.vercel";
import { loadEtaBatch, loadEventBatch } from "./delivery-store.postgres-read-batches";
import { createLimitedArrayBatcher, createRecordBatcher } from "./micro-batcher";
import type { DeliveryEventRow, DeliveryStore, EtaObservationRow } from "./delivery-store.types";

const listEventsBatched = createRecordBatcher<DeliveryEventRow[]>(loadEventBatch, () => []);
const listEtaObservationsBatched = createLimitedArrayBatcher<EtaObservationRow>(
  loadEtaBatch,
  (limit) => Math.max(1, Math.min(2000, Math.round(limit ?? 200))),
);

export const store: DeliveryStore = {
  ...baseStore,
  listEvents: listEventsBatched,
  listEtaObservations: listEtaObservationsBatched,
};
