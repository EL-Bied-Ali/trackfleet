import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const types = fs.readFileSync(new URL("../app/lib/delivery-store.types.ts", import.meta.url), "utf8");
const postgres = fs.readFileSync(new URL("../app/lib/delivery-store.postgres.ts", import.meta.url), "utf8");
const cloudflare = fs.readFileSync(new URL("../app/lib/delivery-store.cloudflare.ts", import.meta.url), "utf8");
const memory = fs.readFileSync(new URL("../app/lib/delivery-store.memory.ts", import.meta.url), "utf8");
const automation = fs.readFileSync(new URL("../app/lib/server-automation.ts", import.meta.url), "utf8");
const schema = fs.readFileSync(new URL("../db/schema.ts", import.meta.url), "utf8");

test("fleet history is tenant scoped and deduplicated by provider timestamp", () => {
  assert.match(types, /recordFleetPosition\(input: FleetPositionInput\)/);
  assert.match(types, /listFleetPositions\(companyId: string, vehicleId: string/);
  assert.match(postgres, /PRIMARY KEY \(company_id, vehicle_id, position_at\)/);
  assert.match(postgres, /ON CONFLICT \(company_id, vehicle_id, position_at\) DO NOTHING/);
  assert.match(cloudflare, /PRIMARY KEY \(company_id, vehicle_id, position_at\)/);
  assert.match(cloudflare, /INSERT OR IGNORE INTO fleet_position_observations/);
  assert.match(memory, /item\.companyId === input\.companyId && item\.vehicleId === input\.vehicleId/);
  assert.match(schema, /fleetPositionObservations = sqliteTable\("fleet_position_observations"/);
});

test("automation records every live vehicle before delivery-specific processing", () => {
  const recordAt = automation.indexOf('snapshot.vehicles.map((vehicle) => store.recordFleetPosition');
  const deliveryAt = automation.indexOf('store.applySendatrackSnapshot');
  assert.ok(recordAt >= 0, 'fleet snapshot recorder missing');
  assert.ok(deliveryAt > recordAt, 'fleet history must not depend on parcel assignment');
  assert.match(automation, /vehicleId: vehicle\.providerDeviceId \|\| vehicle\.id/);
  assert.match(automation, /fleetPositions: number/);
  assert.match(automation, /fleetPositions = fleetPositionResults\.filter\(Boolean\)\.length/);
});
