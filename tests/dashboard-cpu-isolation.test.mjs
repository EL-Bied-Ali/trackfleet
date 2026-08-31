import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const deliveriesRoute = await readFile(new URL("../app/api/deliveries/route.ts", import.meta.url), "utf8");
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const sendatrackRoute = await readFile(new URL("../app/api/sendatrack/route.ts", import.meta.url), "utf8");

test("the authenticated dashboard read does not share its CPU budget with SENDATRACK parsing or state synchronization", () => {
  const getBody = deliveriesRoute.slice(deliveriesRoute.indexOf("export async function GET"), deliveriesRoute.indexOf("export async function POST"));
  assert.doesNotMatch(getBody, /getSendatrackSnapshot\(/);
  assert.doesNotMatch(getBody, /applySendatrackSnapshot\(/);
  assert.doesNotMatch(getBody, /processPendingNotifications\(/);
});

test("the UI requests live fleet data independently and a provider failure cannot reject the delivery request", () => {
  assert.match(page, /fetch\("\/api\/sendatrack", \{ cache: "no-store" \}\)\.catch\(\(\) => null\)/);
  assert.match(page, /const response = await fetch\(endpoint, \{ cache: "no-store" \}\);/);
});

test("the dedicated fleet response remains compatible with the dashboard integration state", () => {
  assert.match(sendatrackRoute, /vehicleCount: snapshot\.vehicles\.length/);
  assert.match(sendatrackRoute, /address: vehicle\.address/);
});
