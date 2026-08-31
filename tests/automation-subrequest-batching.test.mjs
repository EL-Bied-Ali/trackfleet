import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const businessTick = await readFile(new URL("../app/lib/fleet-business-tick.ts", import.meta.url), "utf8");
const completion = await readFile(new URL("../app/lib/delivery-completion.vercel.ts", import.meta.url), "utf8");

test("the fleet tick primes batched event and ETA reads before sequential processing", () => {
  assert.match(businessTick, /await Promise\.all\(\[\.\.\.eventPrefetchIds\]\.map\(\(deliveryId\) => eventsFor\(deliveryId\)\)\);/);
  assert.match(businessTick, /const etaHistoryEntries = await Promise\.all\(activeDeliveries\.map/);
  assert.match(businessTick, /const previousEtaObservations = etaHistoryById\.get\(delivery\.id\) \?\? \[\];/);
});

test("the normal tick reuses its delivery working set and only reloads after an automatic completion", () => {
  assert.match(businessTick, /const deliveries = automaticCompletions > 0\s*\? await store\.listForCompany\(companyId\)\s*:\s*manualArrivalCandidates;/);
});

test("clearing inactive arrival state uses one Postgres request", () => {
  assert.match(completion, /WITH cleared_arrival_state AS/);
  assert.doesNotMatch(completion, /async function clearArrivalState[\s\S]*?Promise\.all\(/);
});
