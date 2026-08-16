import assert from "node:assert/strict";
import test from "node:test";
import { knownSites, resolveKnownSite } from "../app/lib/known-sites.ts";

const moroccoSites = knownSites.filter((site) => site.country === "MA");

test("contains the nine Morocco operational stops supplied by the business", () => {
  assert.equal(moroccoSites.length, 9);
  const cities = new Set(moroccoSites.map((site) => site.city));
  for (const city of ["Tanger Med", "Tanger", "Tétouan", "Salé", "Marrakech", "Agadir", "Khouribga", "Fquih Ben Salah", "Casablanca"]) {
    assert.ok(cities.has(city), `missing ${city}`);
  }
});

test("site identifiers are unique and Morocco stops can be delivery destinations", () => {
  assert.equal(new Set(knownSites.map((site) => site.id)).size, knownSites.length);
  for (const site of moroccoSites) {
    assert.ok(site.roles.includes("destination"), `${site.id} is not a destination`);
    assert.ok(site.roles.includes("dropoff"), `${site.id} is not a dropoff stop`);
    assert.ok(site.roles.includes("replenishment"), `${site.id} is not a replenishment stop`);
  }
});

test("resolves an agency by id, city, label or exact address", () => {
  const marrakech = resolveKnownSite("marrakech-essaouira-12");
  assert.equal(marrakech?.city, "Marrakech");
  assert.equal(resolveKnownSite("Marrakech")?.id, marrakech?.id);
  assert.equal(resolveKnownSite(marrakech?.label ?? "")?.id, marrakech?.id);
  assert.equal(resolveKnownSite(marrakech?.address ?? "")?.id, marrakech?.id);
});
