export type SendatrackHistoryEndpoint = "eventsApp2" | "events7" | "eventsApp";

export const SENDATRACK_HISTORY_ENDPOINT_URLS: Record<SendatrackHistoryEndpoint, string> = {
  eventsApp2: "http://app.sendatrack.com:8080/eventsApp2/data.jsonx",
  events7: "http://app.sendatrack.com:8080/events7/data.jsonx",
  eventsApp: "http://app.sendatrack.com:8080/eventsApp/data.jsonx",
};

// Public SENDATRACK-family source code uses eventsApp2 for a selected device's
// historical day. The official 1.0.8 APK also contains events7/eventsApp URLs,
// which remain bounded fallbacks in the live probe.
export const SENDATRACK_HISTORY_BASE_URL = SENDATRACK_HISTORY_ENDPOINT_URLS.eventsApp2;

export type SendatrackHistoryQuery = {
  accountId: string;
  userId?: string;
  password?: string;
  deviceId: string;
  from: Date | number;
  to: Date | number;
  endpoint?: SendatrackHistoryEndpoint;
};

export type SendatrackHistoryPoint = {
  deviceId: string;
  timestamp: number;
  latitude: number;
  longitude: number;
  speed: number;
  odometer: number | null;
  address: string;
  statusCode: number | null;
};

export type SendatrackHistoryTrip = {
  deviceId: string;
  startedAt: number;
  endedAt: number;
  durationSeconds: number;
  distance: number | null;
  startAddress: string;
  endAddress: string;
  points: SendatrackHistoryPoint[];
};

const START_STATUS_CODES = new Set([62465, 61714]);
const STOP_STATUS_CODES = new Set([62467]);

function toEpochSeconds(value: Date | number) {
  const milliseconds = value instanceof Date ? value.getTime() : value;
  if (!Number.isFinite(milliseconds)) throw new Error("Invalid SENDATRACK history timestamp");
  return Math.floor(milliseconds / 1000);
}

export function buildSendatrackHistoryUrl(query: SendatrackHistoryQuery) {
  const accountId = query.accountId.trim();
  const userId = query.userId?.trim() ?? "";
  const password = query.password ?? "";
  const deviceId = query.deviceId.trim();
  if (!accountId) throw new Error("Missing SENDATRACK account id");
  if (!deviceId) throw new Error("Missing SENDATRACK device id");

  const from = toEpochSeconds(query.from);
  const to = toEpochSeconds(query.to);
  if (from > to) throw new Error("SENDATRACK history range is reversed");

  const endpoint = query.endpoint ?? "eventsApp2";
  const url = new URL(SENDATRACK_HISTORY_ENDPOINT_URLS[endpoint]);
  // Exact legacy/OpenGTS contract confirmed from SENDATRACK-family source:
  // a=account, p=password, u=user, d=logical Device, rf/rt=epoch seconds.
  url.searchParams.set("a", accountId);
  if (password) url.searchParams.set("p", password);
  if (userId) url.searchParams.set("u", userId);
  url.searchParams.set("d", deviceId);
  url.searchParams.set("rf", String(from));
  url.searchParams.set("rt", String(to));
  url.searchParams.set("l", "5000");
  url.searchParams.set("at", "true");
  return url.toString();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function numberFrom(...values: unknown[]) {
  for (const value of values) {
    const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
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

function timestampSeconds(...values: unknown[]) {
  for (const value of values) {
    const numeric = numberFrom(value);
    if (numeric !== null && numeric > 0) return numeric > 10_000_000_000 ? Math.floor(numeric / 1000) : Math.floor(numeric);
    if (typeof value === "string" && value.trim()) {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return Math.floor(parsed / 1000);
    }
  }
  return null;
}

function collectDeviceRecords(value: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 5 || value == null) return [];
  if (Array.isArray(value)) return value.flatMap((item) => collectDeviceRecords(item, depth + 1));
  const record = asRecord(value);
  if (!record) return [];
  if (Array.isArray(record.EventData)) return [record];
  return Object.values(record).flatMap((nested) => collectDeviceRecords(nested, depth + 1));
}

function normalizeEvent(device: Record<string, unknown>, value: unknown): SendatrackHistoryPoint | null {
  const event = asRecord(value);
  if (!event) return null;
  const latitude = numberFrom(event.GPSPoint_lat, event.latitude, event.lat);
  const longitude = numberFrom(event.GPSPoint_lon, event.longitude, event.lng, event.lon);
  const timestamp = timestampSeconds(event.Timestamp, event.timestamp, event.LastTime);
  if (latitude === null || longitude === null || timestamp === null) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;

  const deviceId = stringFrom(device.Device, event.Device, event.DeviceCode, device.DeviceCode, device.id);
  if (!deviceId) return null;

  return {
    deviceId,
    timestamp,
    latitude,
    longitude,
    speed: numberFrom(event.Speed, event.speed) ?? 0,
    odometer: numberFrom(event.Odometer, event.odometer),
    address: stringFrom(event.Address, event.Adresse, event.address),
    statusCode: numberFrom(event.StatusCode, event.Statucode, event.statusCode),
  };
}

export function normalizeSendatrackHistory(payload: unknown): SendatrackHistoryPoint[] {
  const points = collectDeviceRecords(payload)
    .flatMap((device) => (device.EventData as unknown[]).map((event) => normalizeEvent(device, event)))
    .filter((point): point is SendatrackHistoryPoint => Boolean(point));

  const unique = new Map<string, SendatrackHistoryPoint>();
  for (const point of points) {
    const key = `${point.deviceId}\u0000${point.timestamp}\u0000${point.latitude}\u0000${point.longitude}`;
    unique.set(key, point);
  }

  return [...unique.values()].sort((a, b) => a.timestamp - b.timestamp);
}

function tripDistance(start: SendatrackHistoryPoint, end: SendatrackHistoryPoint) {
  if (start.odometer === null || end.odometer === null) return null;
  const distance = end.odometer - start.odometer;
  return Number.isFinite(distance) && distance >= 0 ? distance : null;
}

export function segmentSendatrackHistoryTrips(points: SendatrackHistoryPoint[]): SendatrackHistoryTrip[] {
  const byDevice = new Map<string, SendatrackHistoryPoint[]>();
  for (const point of points) {
    const list = byDevice.get(point.deviceId) ?? [];
    list.push(point);
    byDevice.set(point.deviceId, list);
  }

  const trips: SendatrackHistoryTrip[] = [];
  for (const [deviceId, devicePoints] of byDevice) {
    devicePoints.sort((a, b) => a.timestamp - b.timestamp);
    let active: SendatrackHistoryPoint[] | null = null;

    for (const point of devicePoints) {
      const status = point.statusCode;
      if (status !== null && START_STATUS_CODES.has(status)) {
        if (!active) active = [point];
        else active.push(point);
        continue;
      }
      if (!active) continue;
      active.push(point);
      if (status === null || !STOP_STATUS_CODES.has(status)) continue;

      const start = active[0];
      const end = active.at(-1)!;
      if (end.timestamp > start.timestamp) {
        trips.push({
          deviceId,
          startedAt: start.timestamp,
          endedAt: end.timestamp,
          durationSeconds: end.timestamp - start.timestamp,
          distance: tripDistance(start, end),
          startAddress: start.address,
          endAddress: end.address,
          points: active,
        });
      }
      active = null;
    }
  }

  return trips.sort((a, b) => a.startedAt - b.startedAt);
}
