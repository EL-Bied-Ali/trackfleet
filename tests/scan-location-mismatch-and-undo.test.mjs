import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { memoryStore } from "../app/lib/delivery-store.memory.ts";
import { createParcelCode } from "../app/lib/parcel-code.ts";
import { customerFacingEvent } from "../app/lib/delivery-events.ts";

const [route, undoRoute, page, deliveriesRoute, historyLib, historyPage, globalsCss] = await Promise.all([
  readFile(new URL("../app/api/scan/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/scan/undo/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/scan/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/deliveries/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/delivery-history.postgres.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/operations/history/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
]);

function baseDeliveryInput(companyId, overrides = {}) {
  return {
    customer: "Location Mismatch SARL", originSiteId: "brussels-abattoir-45", originLatitude: null, originLongitude: null,
    destinationSiteId: "casablanca-mohammed-vi-959", destination: "Casablanca", destinationLatitude: null, destinationLongitude: null,
    arrivalRadiusKm: 0.5, truck: "TRUCK-mismatch", driver: "", status: "In transit", eta: "",
    plannedArrivalAt: null, nextTruckDepartureAt: null, progress: 90, color: "#000",
    contact: "", whatsappOptIn: false, whatsappOptInAt: null, sendatrackVehicleId: "",
    latitude: null, longitude: null, speed: null, lastPositionAt: null, gpsSource: "simulation",
    companyId, trackingToken: `tok-mismatch-${Date.now()}-${Math.random()}`, tripId: null,
    parcelCode: createParcelCode(),
    ...overrides,
  };
}

// --- Server-side: location-mismatch check (app/api/scan/route.ts) ---

test("ARRIVAL_LOCATION_MISMATCH_BYPASSED is a real event type, excluded from customer-facing tracking", () => {
  assert.equal(customerFacingEvent("ARRIVAL_LOCATION_MISMATCH_BYPASSED"), false);
});

test("the scan route only checks location match on the delivered checkpoint, using a deliberately generous radius vs a truck's own arrivalRadiusKm", () => {
  assert.match(route, /const AGENCY_LOCATION_MISMATCH_RADIUS_KM = 2;/);
  const deliveredBlockStart = route.indexOf('if (checkpoint === "delivered") {');
  const deliveredBlockEnd = route.indexOf("\n    }\n\n    const recentScans");
  assert.ok(deliveredBlockStart >= 0 && deliveredBlockEnd > deliveredBlockStart);
  const block = route.slice(deliveredBlockStart, deliveredBlockEnd);
  assert.match(block, /AGENCY_LOCATION_MISMATCH_RADIUS_KM/);
});

test("the mismatch check is skipped entirely unless BOTH a phone position and the destination site's own coordinates exist -- never blocks on merely missing data", () => {
  assert.match(route, /if \(phonePosition && destinationSite\s*\n\s*&& typeof destinationSite\.latitude === "number" && typeof destinationSite\.longitude === "number"\) \{/);
});

test("a genuine mismatch returns a structured 409 with the distance and agency label, unless explicitly bypassed", () => {
  assert.match(route, /if \(distanceToAgencyKm > AGENCY_LOCATION_MISMATCH_RADIUS_KM && payload\.bypassLocationMismatch !== true\) \{/);
  assert.match(route, /error: "location_mismatch",\s*\n\s*distanceKm: Math\.round\(distanceToAgencyKm \* 10\) \/ 10,\s*\n\s*agencyLabel: destinationSite\.label,/);
});

test("an explicit bypass still proceeds, but logs a warning and persists an audit event -- same pattern as the missing-scans bypass", () => {
  assert.match(route, /console\.warn\("\[trackfleet:scan\] delivered checkpoint confirmed despite location mismatch \(explicit bypass\)", \{/);
  assert.match(route, /await store\.recordEvent\(delivery\.id, "ARRIVAL_LOCATION_MISMATCH_BYPASSED", delivery\.progress\);/);
});

test("the scan response returns the new scan's own id, so the client can offer an undo for it", () => {
  assert.match(route, /let recordedScanId: string \| null = null;/);
  assert.match(route, /const recordedScan = await store\.recordScan\(\{/);
  assert.match(route, /recordedScanId = recordedScan\.id;/);
  assert.match(route, /scanId: recordedScanId,/);
});

// --- Server-side: undo endpoint (app/api/scan/undo/route.ts) ---

test("the undo route requires auth, same-origin, a deliveryId and scanId, and only ever accepts the loaded checkpoint", () => {
  assert.match(undoRoute, /if \(!requestIsSameOrigin\(request\)\) return originRejectedResponse\(\);/);
  assert.match(undoRoute, /if \(!session\) return noStore\(\{ error: "unauthorized" \}, 401, refreshHeaders\);/);
  assert.match(undoRoute, /if \(!deliveryId \|\| !scanId\) return noStore\(\{ error: "invalid_request" \}, 400, refreshHeaders\);/);
  assert.match(undoRoute, /if \(checkpoint !== "loaded"\) return noStore\(\{ error: "checkpoint_not_undoable" \}, 400, refreshHeaders\);/);
});

test("the undo route delegates to the store with a fixed 30s window and reports 404 when nothing matched", () => {
  assert.match(undoRoute, /const undoWindowMs = 30_000;/);
  assert.match(undoRoute, /const undone = await store\.undoRecentScan\(session\.companyId, deliveryId, scanId, undoWindowMs\);/);
  assert.match(undoRoute, /if \(!undone\) return noStore\(\{ error: "scan_not_found_or_too_old" \}, 404, refreshHeaders\);/);
});

// --- Store: undoRecentScan, behavioral via memoryStore ---

test("undoRecentScan removes exactly the targeted scan and its delivery_events marker when it was the only scan of that checkpoint", async () => {
  const companyId = `undo-test-${Date.now()}`;
  const delivery = await memoryStore.create(baseDeliveryInput(companyId));
  await memoryStore.recordEvent(delivery.id, "SCAN_LOADED", delivery.progress);
  const scan = await memoryStore.recordScan({ companyId, deliveryId: delivery.id, checkpoint: "loaded", scannedBy: "dispatcher:alice", truck: "TRUCK-mismatch", locationLabel: null });

  const undone = await memoryStore.undoRecentScan(companyId, delivery.id, scan.id, 30_000);
  assert.equal(undone, true);

  const scans = await memoryStore.listScansForDelivery(delivery.id);
  assert.equal(scans.length, 0);
  const events = await memoryStore.listEvents(delivery.id);
  assert.equal(events.some((event) => event.type === "SCAN_LOADED"), false, "the SCAN_LOADED marker must be removed once its only backing scan is gone");
});

test("undoRecentScan keeps the delivery_events marker when another scan of the same checkpoint still exists", async () => {
  const companyId = `undo-keep-test-${Date.now()}`;
  const delivery = await memoryStore.create(baseDeliveryInput(companyId));
  await memoryStore.recordEvent(delivery.id, "SCAN_LOADED", delivery.progress);
  const first = await memoryStore.recordScan({ companyId, deliveryId: delivery.id, checkpoint: "loaded", scannedBy: "dispatcher:alice", truck: "TRUCK-mismatch", locationLabel: null });
  await memoryStore.recordScan({ companyId, deliveryId: delivery.id, checkpoint: "loaded", scannedBy: "dispatcher:bob", truck: "TRUCK-mismatch", locationLabel: null });

  const undone = await memoryStore.undoRecentScan(companyId, delivery.id, first.id, 30_000);
  assert.equal(undone, true);

  const scans = await memoryStore.listScansForDelivery(delivery.id);
  assert.equal(scans.length, 1);
  const events = await memoryStore.listEvents(delivery.id);
  assert.equal(events.some((event) => event.type === "SCAN_LOADED"), true, "a genuinely earlier, separate scan of the same checkpoint must not have its evidence erased");
});

test("undoRecentScan refuses a scan that's too old, or that belongs to a different company or delivery", async () => {
  const companyId = `undo-scope-test-${Date.now()}`;
  const delivery = await memoryStore.create(baseDeliveryInput(companyId));
  const scan = await memoryStore.recordScan({ companyId, deliveryId: delivery.id, checkpoint: "loaded", scannedBy: "dispatcher:alice", truck: "TRUCK-mismatch", locationLabel: null });

  assert.equal(await memoryStore.undoRecentScan(companyId, delivery.id, scan.id, -1), false, "a negative max age must never match a just-created scan");
  assert.equal(await memoryStore.undoRecentScan(`${companyId}-other`, delivery.id, scan.id, 30_000), false, "wrong company must not undo another company's scan");
  assert.equal(await memoryStore.undoRecentScan(companyId, `${delivery.id}-other`, scan.id, 30_000), false, "wrong delivery must not undo an unrelated delivery's scan");

  const stillThere = await memoryStore.listScansForDelivery(delivery.id);
  assert.equal(stillThere.length, 1, "none of the rejected undo attempts should have removed the real scan");
});

test("every DeliveryStore backend declares/implements undoRecentScan", async () => {
  const typesFile = await readFile(new URL("../app/lib/delivery-store.types.ts", import.meta.url), "utf8");
  assert.match(typesFile, /undoRecentScan\(companyId: string, deliveryId: string, scanId: string, maxAgeMs: number\): Promise<boolean>;/);
  for (const path of [
    "app/lib/delivery-store.postgres.ts",
    "app/lib/delivery-store.cloudflare.ts",
    "app/lib/delivery-store.memory.ts",
    "app/lib/delivery-store.shared-postgres.ts",
  ]) {
    const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
    assert.match(source, /async undoRecentScan\(/, `${path} must implement undoRecentScan`);
  }
});

// --- Client: app/scan/page.tsx ---

test("a dismissible (severe) error stays on screen until acknowledged, and pauses the camera loop instead of scanning past it in the background", () => {
  assert.match(page, /const severeScanErrors = new Set\(\["agency_destination_mismatch", "already_delivered", "arrival_blocked_missing_scans", "checkpoint_locked"\]\);/);
  assert.match(page, /const dismissible = Boolean\(data\.error && severeScanErrors\.has\(data\.error\)\);/);
  assert.match(page, /if \(!dismissible\) window\.setTimeout\(\(\) => setFlash\(null\), 1100\);/);
  assert.match(page, /const blockedRef = useRef\(false\);/);
  assert.match(page, /blockedRef\.current = errorDismissible \|\| locationMismatch !== null;/);
  assert.match(page, /if \(detectingRef\.current \|\| busyRef\.current \|\| blockedRef\.current\) return;/);
});

test("a location-mismatch response is a two-step confirm, not a terminal error -- distinct from the severe-error dismiss flow", () => {
  assert.match(page, /if \(data\.error === "location_mismatch"\) \{/);
  assert.match(page, /setLocationMismatch\(\{ code, distanceKm: data\.distanceKm \?\? 0, agencyLabel: data\.agencyLabel \?\? "" \}\);/);
  assert.match(page, /void submitScan\(locationMismatch\.code, \{ bypassLocationMismatch: true \}\)/);
});

test("a bypass resubmission skips the resubmit cooldown, so confirming quickly after a real mismatch can't be silently swallowed", () => {
  const fnStart = page.indexOf("const submitScan = useCallback");
  const fnBody = page.slice(fnStart, fnStart + 1200);
  assert.match(fnBody, /if \(!options\?\.bypassLocationMismatch\) \{/);
});

test("a real (non-duplicate) loaded scan offers a time-boxed undo, scoped to the loaded checkpoint only", () => {
  assert.match(page, /if \(!data\.duplicate && data\.delivery && data\.scanId && modeRef\.current === "loaded"\) \{/);
  assert.match(page, /setUndo\(\{ scanId: data\.scanId, deliveryId: data\.delivery\.id, label: shortCode \?\? detail \}\);/);
  assert.match(page, /undoTimeoutRef\.current = setTimeout\(\(\) => setUndo\(null\), 20_000\);/);
});

test("undoScan posts to the undo endpoint with the loaded checkpoint and refreshes the pending list on success", () => {
  const fnStart = page.indexOf("const undoScan = useCallback");
  const fnBody = page.slice(fnStart, fnStart + 900);
  assert.match(fnBody, /fetch\("\/api\/scan\/undo", \{/);
  assert.match(fnBody, /body: JSON\.stringify\(\{ deliveryId: undo\.deliveryId, scanId: undo\.scanId, checkpoint: "loaded" \}\)/);
  assert.match(fnBody, /void refreshPending\("loaded"\);/);
});

test("a successful scan shows the parcel's own short code prominently, separate from the customer/destination detail", () => {
  assert.match(page, /const \[flashShortCode, setFlashShortCode\] = useState<string \| null>\(null\);/);
  assert.match(page, /const shortCode = data\.delivery\?\.shortCode \?\? null;/);
  assert.match(page, /setFlashShortCode\(shortCode\);/);
  assert.match(page, /fontSize: 28, fontWeight: 800/);
});

// --- Dashboard + Historique visibility for the bypass marker ---

test("the deliveries API exposes when a delivery's arrival was confirmed despite a location mismatch", () => {
  assert.match(deliveriesRoute, /locationMismatchBypassedAt: events\.find\(\(event\) => event\.type === "ARRIVAL_LOCATION_MISMATCH_BYPASSED"\)\?\.createdAt\.toISOString\(\) \?\? null,/);
});

test("app/page.tsx (dashboard) renders the location-mismatch badge with a title tooltip naming when it happened", async () => {
  const dashboardPage = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(dashboardPage, /locationMismatchBypassedAt\?: string \| null;/);
  assert.match(dashboardPage, /\{delivery\.locationMismatchBypassedAt && <span className="location-mismatch-badge"/);
});

test("the location-mismatch badge has its own CSS class, distinct from the existing scan-proof/label-print-status badges", () => {
  assert.match(globalsCss, /\.location-mismatch-badge \{/);
});

test("delivery history (Historique) carries the bypass timestamp through its Postgres query, hydration, and type", () => {
  assert.match(historyLib, /locationMismatchBypassedAt: string \| null;/);
  assert.match(historyLib, /location_mismatch_bypassed_at: string \| Date \| null;/);
  assert.match(historyLib, /\(SELECT created_at FROM delivery_events WHERE delivery_id = deliveries\.id AND type = 'ARRIVAL_LOCATION_MISMATCH_BYPASSED'\) AS location_mismatch_bypassed_at/);
  assert.match(historyLib, /locationMismatchBypassedAt: toIso\(row\.location_mismatch_bypassed_at\),/);
});

test("the Historique page renders the same badge for a delivery whose arrival bypassed a location mismatch", () => {
  assert.match(historyPage, /locationMismatchBypassedAt: string \| null;/);
  assert.match(historyPage, /\{item\.locationMismatchBypassedAt && <span className="location-mismatch-badge"/);
});
