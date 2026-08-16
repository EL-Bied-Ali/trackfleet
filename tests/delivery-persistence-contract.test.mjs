import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const stores = [
  "app/lib/delivery-store.postgres.ts",
  "app/lib/delivery-store.cloudflare.ts",
];

const requiredFields = [
  "origin_site_id",
  "origin_latitude",
  "origin_longitude",
  "destination_site_id",
  "destination_latitude",
  "destination_longitude",
  "arrival_radius_km",
];

const requiredDeliveryProperties = [
  "delivery.originSiteId",
  "delivery.originLatitude",
  "delivery.originLongitude",
  "delivery.destinationSiteId",
  "delivery.destinationLatitude",
  "delivery.destinationLongitude",
  "delivery.arrivalRadiusKm",
];

test("persistent delivery stores write site ids, coordinates, and arrival radius together", () => {
  for (const file of stores) {
    const source = fs.readFileSync(file, "utf8");
    const createBlock = source.slice(source.indexOf("async create(input: CreateDeliveryInput)"));
    assert.notEqual(createBlock.length, source.length, `${file} create() block was not found`);

    for (const field of requiredFields) {
      assert.ok(createBlock.includes(field), `${file} create() does not persist ${field}`);
    }
    for (const property of requiredDeliveryProperties) {
      assert.ok(createBlock.includes(property), `${file} create() does not bind ${property}`);
    }
  }
});

test("Postgres hydration restores site ids and origin/destination coordinates", () => {
  const source = fs.readFileSync("app/lib/delivery-store.postgres.ts", "utf8");
  const hydrateBlock = source.slice(source.indexOf("function hydrate(row: RawDelivery)"), source.indexOf("function hydrateEvent"));
  for (const property of ["originSiteId", "originLatitude", "originLongitude", "destinationSiteId", "destinationLatitude", "destinationLongitude", "arrivalRadiusKm"]) {
    assert.ok(hydrateBlock.includes(property), `Postgres hydrate() does not restore ${property}`);
  }
});
