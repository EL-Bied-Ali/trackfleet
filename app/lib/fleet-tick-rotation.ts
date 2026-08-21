// Caps how many vehicles a single automation tick fully processes (fleet
// sync, delivery-state transitions, ETA logging), so per-vehicle subrequest
// cost stays bounded regardless of fleet size -- see d1-mirror-queue.ts for
// the related "Too many subrequests by single Worker invocation" incident
// this protects against. Below the threshold this is a no-op: the whole
// fleet processes every tick exactly as before. Above it, vehicles rotate
// through batches based on the current time bucket -- no state to persist,
// since the bucket index derives deterministically from the clock -- so the
// full fleet still refreshes every few ticks instead of every vehicle
// refreshing every tick.
const maxVehiclesPerBatch = 10;
const tickIntervalMs = 5 * 60_000;

function stableHash(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (Math.imul(hash, 31) + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function rotatedVehicleBatch<T extends { id: string }>(vehicles: T[], now = Date.now()): T[] {
  const batchCount = Math.max(1, Math.ceil(vehicles.length / maxVehiclesPerBatch));
  if (batchCount <= 1) return vehicles;
  const bucket = Math.floor(now / tickIntervalMs) % batchCount;
  return vehicles.filter((vehicle) => stableHash(vehicle.id) % batchCount === bucket);
}
