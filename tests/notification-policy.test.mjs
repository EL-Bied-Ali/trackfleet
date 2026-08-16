import test from "node:test";
import assert from "node:assert/strict";
import { isHistoricalNotification, parseAutomationStartAt, splitLatestPendingNotifications } from "../app/lib/notification-policy.ts";

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
