import type { StorageHealth } from "./storage-health.ts";

export function automationStorageIsReady(storage: StorageHealth) {
  return storage.persistent && storage.connected;
}
