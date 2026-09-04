import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const tracker = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const events = await readFile(new URL("../app/lib/delivery-events.ts", import.meta.url), "utf8");
const scanRoute = await readFile(new URL("../app/api/scan/route.ts", import.meta.url), "utf8");
const policy = await readFile(new URL("../app/lib/notification-policy.ts", import.meta.url), "utf8");

test("public tracking has clear customer copy for loading and hub arrival, without calling the hub a final delivery", () => {
  assert.match(tracker, /SCAN_LOADED: "Colis chargé dans le camion"/);
  assert.match(tracker, /SCAN_HUB_ARRIVED: "Colis arrivé au centre logistique"/);
  assert.doesNotMatch(tracker, /SCAN_HUB_ARRIVED: "Livraison arrivée"/);
});

test("both scan milestones are timeline events but are excluded from automatic WhatsApp", () => {
  assert.match(events, /\| "SCAN_LOADED"\s*\n\s*\| "SCAN_HUB_ARRIVED"/);
  assert.doesNotMatch(events, /event !== "SCAN_LOADED"/);
  assert.doesNotMatch(events, /event !== "SCAN_HUB_ARRIVED"/);
  assert.doesNotMatch(policy, /"SCAN_LOADED"/);
  assert.doesNotMatch(policy, /"SCAN_HUB_ARRIVED"/);
});

test("the scanner records a customer milestone before its audit proof, without the loaded/hub checkpoints ever changing the final delivery status", () => {
  const milestone = scanRoute.indexOf('checkpoint === "loaded" ? "SCAN_LOADED" : "SCAN_HUB_ARRIVED"');
  const audit = scanRoute.indexOf("await store.recordScan({");
  assert.ok(milestone >= 0 && milestone < audit);
  // Neither loaded nor hub ever reaches completeDeliveryManually -- only the
  // separate "delivered" checkpoint (a live follow-up request: a QR scan at
  // the destination agency can confirm final delivery too, reusing the
  // exact same confirmArrivalManually effect the dashboard's own
  // "Confirmer l'arrivée" button already triggers) calls confirmArrivalManually,
  // and only inside its own `if (checkpoint === "delivered")` branch.
  assert.doesNotMatch(scanRoute, /completeDeliveryManually/);
  const deliveredBranch = scanRoute.slice(scanRoute.indexOf('if (checkpoint === "delivered") {\n        //'));
  assert.match(deliveredBranch, /await confirmArrivalManually\(/);
});
