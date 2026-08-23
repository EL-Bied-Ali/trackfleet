import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { memoryStore } from "../app/lib/delivery-store.memory.ts";

const route = fs.readFileSync("app/api/deliveries/update-schedule/route.ts", "utf8");
const page = fs.readFileSync("app/page.tsx", "utf8");
const typesFile = fs.readFileSync("app/lib/delivery-store.types.ts", "utf8");

test("the store's updateSchedule sets both dates and refuses an already-delivered delivery", async () => {
  const companyId = `update-schedule-test-${Date.now()}`;
  const delivery = await memoryStore.create({
    customer: "Test", originSiteId: null, originLatitude: null, originLongitude: null,
    destinationSiteId: null, destination: "Somewhere", destinationLatitude: null, destinationLongitude: null,
    arrivalRadiusKm: 0.5, truck: "__unassigned__", driver: "", status: "Loading", eta: "",
    plannedArrivalAt: null, nextTruckDepartureAt: null, progress: 0, color: "#000",
    contact: "", whatsappOptIn: false, whatsappOptInAt: null, sendatrackVehicleId: "",
    latitude: null, longitude: null, speed: null, lastPositionAt: null, gpsSource: "simulation",
    companyId, trackingToken: `tok-${Date.now()}`, tripId: null,
  });

  const plannedArrivalAt = new Date("2026-09-01T10:00:00Z");
  const nextTruckDepartureAt = new Date("2026-08-30T08:00:00Z");
  const updated = await memoryStore.updateSchedule(delivery.id, companyId, { plannedArrivalAt, nextTruckDepartureAt });
  assert.equal(updated?.plannedArrivalAt?.toISOString(), plannedArrivalAt.toISOString());
  assert.equal(updated?.nextTruckDepartureAt?.toISOString(), nextTruckDepartureAt.toISOString());

  const delivered = await memoryStore.create({
    customer: "Test", originSiteId: null, originLatitude: null, originLongitude: null,
    destinationSiteId: null, destination: "Somewhere", destinationLatitude: null, destinationLongitude: null,
    arrivalRadiusKm: 0.5, truck: "TRUCK-1", driver: "", status: "Delivered", eta: "",
    plannedArrivalAt: null, nextTruckDepartureAt: null, progress: 100, color: "#000",
    contact: "", whatsappOptIn: false, whatsappOptInAt: null, sendatrackVehicleId: "",
    latitude: null, longitude: null, speed: null, lastPositionAt: null, gpsSource: "simulation",
    companyId, trackingToken: `tok2-${Date.now()}`, tripId: null,
  });
  assert.equal(await memoryStore.updateSchedule(delivered.id, companyId, { plannedArrivalAt, nextTruckDepartureAt }), null);
});

test("the DeliveryStore interface declares updateSchedule and every backend implements it", () => {
  assert.match(typesFile, /updateSchedule\(deliveryId: string, companyId: string, input: \{ plannedArrivalAt: Date \| null; nextTruckDepartureAt: Date \| null \}\): Promise<DeliveryRow \| null>;/);
  for (const path of [
    "app/lib/delivery-store.postgres.ts",
    "app/lib/delivery-store.cloudflare.ts",
    "app/lib/delivery-store.memory.ts",
    "app/lib/delivery-store.shared-postgres.ts",
    "app/lib/delivery-store.cloudflare-postgres-failover.ts",
  ]) {
    const source = fs.readFileSync(path, "utf8");
    assert.match(source, /updateSchedule/, `${path} must implement updateSchedule`);
  }
});

test("the update-schedule endpoint is dispatcher-only, same-origin protected, and treats blank dates as clearing them", () => {
  assert.match(route, /getDispatcherSession\(request\)/);
  assert.match(route, /requestIsSameOrigin\(request\)/);
  assert.match(route, /function parseOptionalDate\(value: unknown\) \{/);
  assert.match(route, /if \(!raw\) return \{ ok: true as const, date: null \};/);
  assert.match(route, /store\.updateSchedule\(deliveryId, session\.companyId, \{/);
});

test("the delivery table has a per-row schedule editor (dispatcher only) that pre-fills from the delivery's current dates", () => {
  assert.match(page, /const \[scheduleEditorDeliveryId, setScheduleEditorDeliveryId\] = useState<string \| null>\(null\);/);
  assert.match(page, /className="more-button schedule-editor-trigger"/);
  assert.match(page, /setScheduleEditorPlannedArrival\(opening \? toDatetimeLocalValue\(delivery\.plannedArrivalAt\) : ""\);/);
  assert.match(page, /setScheduleEditorNextDeparture\(opening \? toDatetimeLocalValue\(delivery\.nextTruckDepartureAt\) : ""\);/);
  assert.match(page, /async function updateDeliverySchedule\(deliveryId: string, plannedArrivalAt: string, nextTruckDepartureAt: string\)/);
  assert.match(page, /fetch\("\/api\/deliveries\/update-schedule", \{/);
});
