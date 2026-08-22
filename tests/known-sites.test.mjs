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

test("regional destinations reached only past the Casablanca relay are flagged as GPS-untracked", () => {
  // The client described the real route as Tanger -> Rabat -> Casablanca
  // (depot), then onward to Marrakech / Agadir / Fquih Ben Salah on what our
  // GPS-tracked trucks never physically visit -- confirmed by zero stationary
  // GPS evidence at any of these three despite active deliveries routing
  // through them. Khouribga is intentionally left unflagged: the client
  // never mentioned it as part of this described network, so its status is
  // genuinely unknown rather than confirmed either way.
  for (const id of ["marrakech-essaouira-12", "agadir-zaitoune-tikiouine-103a", "fquih-ben-salah-allal-ben-abdellah-197"]) {
    assert.equal(knownSites.find((site) => site.id === id)?.finalLegTrackingUnavailable, true, `${id} should be flagged`);
  }
  for (const id of ["brussels-abattoir-45", "tanger-med-ksar-al-majaz", "tanger-ville-said-kotb-19a", "tetouan-cortoba-146", "sale-hay-nasser-12bis", "khouribga-mohamed-vi-30", "casablanca-mohammed-vi-959"]) {
    assert.notEqual(knownSites.find((site) => site.id === id)?.finalLegTrackingUnavailable, true, `${id} should not be flagged`);
  }
});
