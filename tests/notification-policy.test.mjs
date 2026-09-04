import test from "node:test";
import assert from "node:assert/strict";
import { groupActionableByShipment, isHistoricalNotification, parseAutomationStartAt, splitLatestPendingNotifications } from "../app/lib/notification-policy.ts";

test("parses a valid automation activation timestamp", () => {
  const start = parseAutomationStartAt("2026-08-16T19:00:00.000Z");
  assert.ok(start instanceof Date);
  assert.equal(start.toISOString(), "2026-08-16T19:00:00.000Z");
});

test("rejects missing or invalid activation timestamps", () => {
  assert.equal(parseAutomationStartAt(undefined), null);
  assert.equal(parseAutomationStartAt("not-a-date"), null);
});

test("suppresses events created before activation but keeps new events eligible", () => {
  const start = new Date("2026-08-16T19:00:00.000Z");
  assert.equal(isHistoricalNotification(new Date("2026-08-16T18:59:59.000Z"), start), true);
  assert.equal(isHistoricalNotification(new Date("2026-08-16T19:00:00.000Z"), start), false);
  assert.equal(isHistoricalNotification(new Date("2026-08-16T19:05:00.000Z"), start), false);
});

test("keeps only the newest pending event per delivery", () => {
  const items = [
    { delivery: { id: "TF-1" }, event: { type: "PROGRESS_25", createdAt: new Date("2026-08-16T19:01:00Z") } },
    { delivery: { id: "TF-1" }, event: { type: "PROGRESS_50", createdAt: new Date("2026-08-16T19:02:00Z") } },
    { delivery: { id: "TF-1" }, event: { type: "PROGRESS_75", createdAt: new Date("2026-08-16T19:03:00Z") } },
    { delivery: { id: "TF-2" }, event: { type: "DEPARTED", createdAt: new Date("2026-08-16T19:04:00Z") } },
  ];

  const result = splitLatestPendingNotifications(items);
  assert.deepEqual(result.actionable.map((item) => [item.delivery.id, item.event.type]), [
    ["TF-1", "PROGRESS_75"],
    ["TF-2", "DEPARTED"],
  ]);
  assert.deepEqual(result.superseded.map((item) => item.event.type), ["PROGRESS_25", "PROGRESS_50"]);
});

// Live audit finding: a "weigh together" shipment is several delivery rows
// sharing one shipmentId, each carrying its own copy of the same event --
// without grouping, a customer with 3 parcels on one truck got 3
// near-identical WhatsApp/email pushes for the same real-world event.
test("groupActionableByShipment sends one representative per (shipmentId, event type) group and reports the group's true size", () => {
  const items = [
    { delivery: { id: "TF-1", shipmentId: "ship-A" }, event: { type: "REGISTERED", createdAt: new Date("2026-09-01T10:00:00Z") } },
    { delivery: { id: "TF-2", shipmentId: "ship-A" }, event: { type: "REGISTERED", createdAt: new Date("2026-09-01T10:00:01Z") } },
    { delivery: { id: "TF-3", shipmentId: "ship-A" }, event: { type: "REGISTERED", createdAt: new Date("2026-09-01T10:00:02Z") } },
    { delivery: { id: "TF-9", shipmentId: null }, event: { type: "REGISTERED", createdAt: new Date("2026-09-01T10:00:00Z") } },
  ];

  const { representative, redundant } = groupActionableByShipment(items);
  assert.equal(representative.length, 2);
  const shipmentGroup = representative.find((entry) => entry.item.delivery.id === "TF-1");
  assert.equal(shipmentGroup.parcelCount, 3);
  const soloGroup = representative.find((entry) => entry.item.delivery.id === "TF-9");
  assert.equal(soloGroup.parcelCount, 1);
  assert.deepEqual(redundant.map((item) => item.delivery.id), ["TF-2", "TF-3"]);
});

test("groupActionableByShipment groups by (shipmentId, event type), not shipmentId alone -- a shipment with both a pending REGISTERED and a pending ARRIVED_AT_SITE sends one of each, not one total", () => {
  const items = [
    { delivery: { id: "TF-1", shipmentId: "ship-B" }, event: { type: "REGISTERED", createdAt: new Date("2026-09-01T10:00:00Z") } },
    { delivery: { id: "TF-2", shipmentId: "ship-B" }, event: { type: "ARRIVED_AT_SITE", createdAt: new Date("2026-09-02T10:00:00Z") } },
  ];

  const { representative, redundant } = groupActionableByShipment(items);
  assert.equal(representative.length, 2);
  assert.equal(redundant.length, 0);
});

test("a delivery with no shipmentId falls back to grouping by its own id -- unaffected, one representative per delivery as before", () => {
  const items = [
    { delivery: { id: "TF-1", shipmentId: null }, event: { type: "REGISTERED", createdAt: new Date() } },
    { delivery: { id: "TF-2", shipmentId: undefined }, event: { type: "REGISTERED", createdAt: new Date() } },
  ];

  const { representative, redundant } = groupActionableByShipment(items);
  assert.equal(representative.length, 2);
  assert.equal(redundant.length, 0);
  assert.deepEqual(representative.map((entry) => entry.parcelCount), [1, 1]);
});
