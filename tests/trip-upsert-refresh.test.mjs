import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const memory = fs.readFileSync(new URL("../app/lib/delivery-store.memory.ts", import.meta.url), "utf8");
const postgres = fs.readFileSync(new URL("../app/lib/delivery-store.postgres.ts", import.meta.url), "utf8");
const cloudflare = fs.readFileSync(new URL("../app/lib/delivery-store.cloudflare.ts", import.meta.url), "utf8");

test("trip upserts refresh the complete mutable snapshot", () => {
  assert.match(memory, /existing\.routeTemplateId = input\.routeTemplateId/);
  assert.match(memory, /existing\.originSiteId = input\.originSiteId/);
  assert.match(memory, /existing\.stops = input\.stops\.map/);

  assert.match(postgres, /ON CONFLICT \(company_id, id\) DO UPDATE SET/);
  for (const field of ["route_template_id", "vehicle_key", "truck", "sendatrack_vehicle_id", "origin_site_id", "stops_json", "status", "updated_at"]) {
    assert.match(postgres, new RegExp(`${field} = EXCLUDED\\.${field}`));
  }

  assert.match(cloudflare, /UPDATE trips SET route_template_id = \?, vehicle_key = \?, truck = \?, sendatrack_vehicle_id = \?, origin_site_id = \?, stops_json = \?, status = \?, updated_at = \?/);
});
