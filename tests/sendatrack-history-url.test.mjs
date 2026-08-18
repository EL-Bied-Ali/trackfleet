import assert from "node:assert/strict";
import test from "node:test";

import { buildSendatrackHistoryUrl, SENDATRACK_HISTORY_BASE_URL } from "../app/lib/sendatrack-history.ts";

test("SENDATRACK history URL uses APK-derived events7 contract", () => {
  const url = new URL(buildSendatrackHistoryUrl({
    accountId: " account-1 ",
    deviceId: " truck-17 ",
    from: new Date("2026-08-17T10:00:00.000Z"),
    to: new Date("2026-08-17T12:00:00.000Z"),
  }));

  assert.equal(`${url.origin}${url.pathname}`, SENDATRACK_HISTORY_BASE_URL);
  assert.deepEqual([...url.searchParams.keys()], ["a", "dId", "rf", "rt"]);
  assert.equal(url.searchParams.get("a"), "account-1");
  assert.equal(url.searchParams.get("dId"), "truck-17");
  assert.equal(url.searchParams.get("rf"), "1786960800");
  assert.equal(url.searchParams.get("rt"), "1786968000");
});

test("SENDATRACK history URL accepts millisecond timestamps and converts them to epoch seconds", () => {
  const from = Date.parse("2026-08-17T10:00:00.000Z");
  const to = Date.parse("2026-08-17T10:05:00.000Z");
  const url = new URL(buildSendatrackHistoryUrl({ accountId: "a", deviceId: "d", from, to }));
  assert.equal(url.searchParams.get("rf"), String(Math.floor(from / 1000)));
  assert.equal(url.searchParams.get("rt"), String(Math.floor(to / 1000)));
});

test("SENDATRACK history URL rejects incomplete or reversed ranges", () => {
  assert.throws(() => buildSendatrackHistoryUrl({ accountId: "", deviceId: "d", from: 1, to: 2 }), /account id/i);
  assert.throws(() => buildSendatrackHistoryUrl({ accountId: "a", deviceId: "", from: 1, to: 2 }), /device id/i);
  assert.throws(() => buildSendatrackHistoryUrl({ accountId: "a", deviceId: "d", from: 2_000, to: 1_000 }), /reversed/i);
});
