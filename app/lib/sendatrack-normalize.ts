export type SendatrackVehicle = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  speed: number;
  heading: number | null;
  address: string;
  updatedAt: number;
  providerAccountId: string;
  providerAccountDescription: string;
  providerDeviceId: string;
};

export type SendatrackNormalizationDiagnostics = {
  candidateArrays: number;
  normalizedRows: number;
  syntheticRows: number;
  namedRows: number;
  finalVehicles: number;
  observedKeys: string[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function numberFrom(...values: unknown[]) {
  for (const value of values) {
    const parsed = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function stringFrom(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function timestampFrom(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value && Number.isNaN(Number(value))) {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    const numeric = numberFrom(value);
    if (numeric !== null && numeric > 0) return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  }
  return Date.now();
}

function findStringByKey(value: unknown, key: string, depth = 0): string {
  if (depth > 4 || value == null) return "";
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findStringByKey(item, key, depth + 1);
      if (found) return found;
    }
    return "";
  }
  const record = asRecord(value);
  if (!record) return "";
  if (key in record) {
    const found = stringFrom(record[key]);
    if (found) return found;
  }
  for (const nested of Object.values(record)) {
    const found = findStringByKey(nested, key, depth + 1);
    if (found) return found;
  }
  return "";
}

function candidateArrays(value: unknown, depth = 0): Array<{ items: unknown[]; depth: number }> {
  if (depth > 4) return [];
  if (Array.isArray(value)) return [{ items: value, depth }, ...value.flatMap((item) => candidateArrays(item, depth + 1))];
  const record = asRecord(value);
  return record ? Object.values(record).flatMap((item) => candidateArrays(item, depth + 1)) : [];
}

function observedObjectKeys(value: unknown, depth = 0, keys = new Set<string>()) {
  if (depth > 4 || keys.size >= 100) return keys;
  if (Array.isArray(value)) {
    for (const item of value) observedObjectKeys(item, depth + 1, keys);
    return keys;
  }
  const record = asRecord(value);
  if (!record) return keys;
  for (const [key, nested] of Object.entries(record)) {
    keys.add(key);
    if (keys.size >= 100) break;
    observedObjectKeys(nested, depth + 1, keys);
  }
  return keys;
}

export function normalizeSendatrackVehicle(value: unknown): SendatrackVehicle | null {
  const record = asRecord(value);
  if (!record) return null;
  const events = Array.isArray(record.EventData) ? record.EventData : Array.isArray(record.events) ? record.events : [];
  const event = asRecord(events.at(-1)) ?? asRecord(record.lastEvent) ?? asRecord(record.event) ?? record;
  const latitude = numberFrom(record.lastValidLatitude, record.latitude, record.lat, record.GPSPoint_lat, event.GPSPoint_lat, event.latitude, event.lat);
  const longitude = numberFrom(record.lastValidLongitude, record.longitude, record.lng, record.lon, record.GPSPoint_lon, event.GPSPoint_lon, event.longitude, event.lng, event.lon);
  if (latitude === null || longitude === null || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  const id = stringFrom(record.id, record.id_Vehicle, record.vehicleId, record.DeviceCode, record.Device, event.DeviceCode);
  const name = stringFrom(record.name, record.vehicleName, record.Device_desc, record.description, record.Device, id);
  if (!id || !name) return null;
  return {
    id,
    name,
    latitude,
    longitude,
    speed: numberFrom(record.speed, record.Speed, event.Speed, event.speed) ?? 0,
    heading: numberFrom(record.heading, record.Heading, event.Heading, event.heading),
    address: stringFrom(record.address, record.Address, event.Address, event.address),
    updatedAt: timestampFrom(record.timestamp, record.Timestamp, record.lastUpdate, event.Timestamp, event.timestamp),
    providerAccountId: stringFrom(record.Account, event.Account),
    providerAccountDescription: stringFrom(record.Account_desc, event.Account_desc),
    providerDeviceId: stringFrom(record.DeviceCode, event.DeviceCode, record.Device, event.Device, id),
  };
}

export function normalizeSendatrackFleet(payload: unknown) {
  const groups = candidateArrays(payload)
    .map(({ items, depth }) => ({ depth, vehicles: items.map(normalizeSendatrackVehicle).filter((item): item is SendatrackVehicle => Boolean(item)) }))
    .filter((group) => group.vehicles.length > 0);

  const vehicles = groups.flatMap((group) => group.vehicles);
  const namedVehicles = vehicles.filter((vehicle) => !/^v\d+$/i.test(vehicle.name));
  const syntheticRows = vehicles.length - namedVehicles.length;
  const fleetRows = namedVehicles.length > 0 ? namedVehicles : vehicles;

  const newestByVehicle = new Map<string, SendatrackVehicle>();
  for (const vehicle of fleetRows) {
    const vehicleKey = vehicle.name.toLowerCase().replace(/[^a-z0-9]/g, "") || vehicle.id;
    const existing = newestByVehicle.get(vehicleKey);
    if (!existing || vehicle.updatedAt >= existing.updatedAt) newestByVehicle.set(vehicleKey, vehicle);
  }

  const providerAccountId = findStringByKey(payload, "Account");
  const providerAccountDescription = findStringByKey(payload, "Account_desc");
  const result = [...newestByVehicle.values()].map((vehicle) => ({
    ...vehicle,
    providerAccountId: vehicle.providerAccountId || providerAccountId,
    providerAccountDescription: vehicle.providerAccountDescription || providerAccountDescription,
  }));
  const diagnostics: SendatrackNormalizationDiagnostics = {
    candidateArrays: groups.length,
    normalizedRows: vehicles.length,
    syntheticRows,
    namedRows: namedVehicles.length,
    finalVehicles: result.length,
    observedKeys: [...observedObjectKeys(payload)].sort(),
  };

  return { vehicles: result, diagnostics };
}
