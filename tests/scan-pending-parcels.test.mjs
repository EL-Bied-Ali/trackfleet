import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { computePendingScanList } from "../app/lib/scan-pending.ts";

function delivery(overrides = {}) {
  return {
    id: "TF-1", customer: "Jean Dupont", destination: "Casablanca", destinationSiteId: "casablanca-mohammed-vi-959",
    truck: "TRUCK-1", status: "Loading", shortCode: "CAS 00",
    ...overrides,
  };
}

function summary(deliveryId, { loadedAt = null, hubArrivedAt = null } = {}) {
  return [deliveryId, { deliveryId, loadedAt, loadedTruck: null, loadedLabel: null, hubArrivedAt, hubLabel: null }];
}

// Live request: "I wanna have at least a list of the parcels they are
// supposed to still scan... not leaving out/forgetting parcels" -- each
// checkpoint's pending list must reflect exactly what's still outstanding
// AT THAT STEP, not every open delivery, or it's not actually a checklist.
test("loaded checkpoint: only Loading-status deliveries not yet scanned loaded", () => {
  const deliveries = [
    delivery({ id: "TF-1", status: "Loading" }),
    delivery({ id: "TF-2", status: "Loading" }),
    delivery({ id: "TF-3", status: "In transit" }), // already departed, not relevant to "still needs loading"
  ];
  const summaries = new Map([summary("TF-2", { loadedAt: new Date() })]); // already loaded
  const result = computePendingScanList("loaded", deliveries, summaries, null);
  assert.deepEqual(result.items.map((item) => item.id), ["TF-1"]);
  assert.equal(result.groupByTruck, true);
});

test("arrived (hub) checkpoint: only deliveries already loaded but not yet hub-scanned", () => {
  const deliveries = [
    delivery({ id: "TF-1" }), // never loaded -- shouldn't show up as "needs hub scan" yet
    delivery({ id: "TF-2" }), // loaded, not yet hub-scanned
    delivery({ id: "TF-3" }), // loaded AND hub-scanned already
  ];
  const summaries = new Map([
    summary("TF-2", { loadedAt: new Date() }),
    summary("TF-3", { loadedAt: new Date(), hubArrivedAt: new Date() }),
  ]);
  const result = computePendingScanList("arrived", deliveries, summaries, null);
  assert.deepEqual(result.items.map((item) => item.id), ["TF-2"]);
  assert.equal(result.groupByTruck, true);
});

test("delivered checkpoint: an agency only sees its own destination's pending parcels", () => {
  const deliveries = [
    delivery({ id: "TF-1", destinationSiteId: "casablanca-mohammed-vi-959" }),
    delivery({ id: "TF-2", destinationSiteId: "tanger-med-ksar-al-majaz" }),
  ];
  const forCasablancaAgency = computePendingScanList("delivered", deliveries, new Map(), "casablanca-mohammed-vi-959");
  assert.deepEqual(forCasablancaAgency.items.map((item) => item.id), ["TF-1"]);
  assert.equal(forCasablancaAgency.groupByTruck, false);
});

test("delivered checkpoint: a dispatcher (no site) sees every still-open destination", () => {
  const deliveries = [
    delivery({ id: "TF-1", destinationSiteId: "casablanca-mohammed-vi-959" }),
    delivery({ id: "TF-2", destinationSiteId: "tanger-med-ksar-al-majaz" }),
  ];
  const result = computePendingScanList("delivered", deliveries, new Map(), null);
  assert.deepEqual(result.items.map((item) => item.id).sort(), ["TF-1", "TF-2"]);
});

test("loaded/arrived lists are sorted by truck then short code, so several trucks loading at once stay scannable without a filter", () => {
  const deliveries = [
    delivery({ id: "TF-1", truck: "Camion 2", shortCode: "CAS 01" }),
    delivery({ id: "TF-2", truck: "Camion 1", shortCode: "CAS 05" }),
    delivery({ id: "TF-3", truck: "Camion 1", shortCode: "CAS 02" }),
  ];
  const result = computePendingScanList("loaded", deliveries, new Map(), null);
  assert.deepEqual(result.items.map((item) => item.id), ["TF-3", "TF-2", "TF-1"]);
});

test("a delivery missing its short code still sorts and displays sensibly, falling back to its id", () => {
  const deliveries = [delivery({ id: "TF-legacy", shortCode: null })];
  const result = computePendingScanList("delivered", deliveries, new Map(), "casablanca-mohammed-vi-959");
  assert.equal(result.items[0].shortCode, null);
  assert.equal(result.items[0].id, "TF-legacy");
});

const pendingRoute = await readFile(new URL("../app/api/scan/pending/route.ts", import.meta.url), "utf8");
const scanPage = await readFile(new URL("../app/scan/page.tsx", import.meta.url), "utf8");

test("the pending route requires authentication and excludes already-Delivered parcels before scoping", () => {
  assert.match(pendingRoute, /if \(!session\) return noStore\(\{ error: "unauthorized" \}, 401, refreshHeaders\);/);
  assert.match(pendingRoute, /\.filter\(\(delivery\) => delivery\.status !== "Delivered"\)/);
});

test("a locked device's pending list always uses its own locked checkpoint, never a client-supplied one", () => {
  assert.match(pendingRoute, /const requestedCheckpoint = scannerResult\?\.session\.checkpoint\s*\n\s*\?\? String\(new URL\(request\.url\)\.searchParams\.get\("checkpoint"\) \?\? ""\) as DeliveryScanCheckpoint;/);
});

test("the scan page shows a live-shrinking pending count, refetching after every real (non-duplicate) scan", () => {
  assert.match(scanPage, /const \[pending, setPending\] = useState<\{ checkpoint: Checkpoint; groupByTruck: boolean; items: PendingItem\[\] \} \| null>\(null\);/);
  assert.match(scanPage, /if \(!data\.duplicate && data\.delivery\) \{/);
  assert.match(scanPage, /setPending\(\(current\) => current && \{ \.\.\.current, items: current\.items\.filter\(\(item\) => item\.id !== scannedId\) \}\);/);
  assert.match(scanPage, /void refreshPending\(modeRef\.current\);/);
});
