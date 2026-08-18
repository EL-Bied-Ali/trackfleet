import assert from "node:assert/strict";
import test from "node:test";

import { buildSendatrackHistoryUrl, SENDATRACK_HISTORY_BASE_URL, SENDATRACK_HISTORY_ENDPOINT_URLS } from "../app/lib/sendatrack-history.ts";

test("SENDATRACK history URL uses confirmed eventsApp2/OpenGTS contract", () => {
  const url = new URL(buildSendatrackHistoryUrl({
    accountId: " account-1 ",
    deviceId: " v17 ",
    from: new Date("2026-08-17T10:00:00.000Z"),
    to: new Date("2026-08-17T12:00:00.000Z"),
  }));

  assert.equal(`${url.origin}${url.pathname}`, SENDATRACK_HISTORY_BASE_URL);
  assert.equal(SENDATRACK_HISTORY_BASE_URL, SENDATRACK_HISTORY_ENDPOINT_URLS.eventsApp2);
  assert.deepEqual([...url.searchParams.keys()], ["a", "d", "rf", "rt", "l", "at"]);
  assert.equal(url.searchParams.get("a"), "account-1");
  assert.equal(url.searchParams.get("d"), "v17");
  assert.equal(url.searchParams.get("rf"), "1786960800");
  assert.equal(url.searchParams.get("rt"), "1786968000");
  assert.equal(url.searchParams.get("l"), "5000");
  assert.equal(url.searchParams.get("at"), "true");
  assert.equal(url.searchParams.has("dId"), false);
  assert.equal(url.searchParams.has("uId"), false);
});

test("SENDATRACK history URL includes legacy p/u authentication fields when provided", () => {
  const url = new URL(buildSendatrackHistoryUrl({
    accountId: "account-1",
    userId: " user-7 ",
    password: "secret-value",
    deviceId: "v17",
    from: Date.parse("2026-08-17T10:00:00.000Z"),
    to: Date.parse("2026-08-17T10:05:00.000Z"),
  }));
  assert.deepEqual([...url.searchParams.keys()], ["a", "p", "u", "d", "rf", "rt", "l", "at"]);
  assert.equal(url.searchParams.get("u"), "user-7");
  assert.equal(url.searchParams.get("p"), "secret-value");
});

test("SENDATRACK history URL can select bounded confirmed fallback endpoints", () => {
  for (const endpoint of ["eventsApp2", "events7", "eventsApp"]) {
    const url = new URL(buildSendatrackHistoryUrl({ accountId: "a", deviceId: "v1", from: 1000, to: 2000, endpoint }));
    assert.equal(`${url.origin}${url.pathname}`, SENDATRACK_HISTORY_ENDPOINT_URLS[endpoint]);
  }
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
