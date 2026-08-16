import test from "node:test";
import assert from "node:assert/strict";
import { isHistoricalNotification, parseAutomationStartAt } from "../app/lib/notification-policy.ts";

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
