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

test("regional destinations reached only past the Casablanca or Tanger Med relay are flagged as GPS-untracked", () => {
  // Confirmed directly from real fleet GPS position history (2,780 pings
  // across 6 vehicles): only two sites show a sustained stationary cluster
  // -- Casablanca and the Tanger Med ferry crossing. Everywhere else in
  // Morocco sees zero GPS presence (the Rabat/Salé-area pings seen are a
  // thin single-day trail matching a truck driving the corridor between the
  // two hubs, not a stop). Tanger Med itself is confirmed as the ferry
  // crossing, not a customer-facing agency -- Tanger Ville and Tétouan relay
  // from it locally the same way Marrakech/Agadir/Fquih Ben Salah relay from
  // Casablanca. Khouribga has the same zero-GPS-evidence profile as those
  // three and is now flagged too (previously an unflagged gap).
  for (const id of ["marrakech-essaouira-12", "agadir-zaitoune-tikiouine-103a", "fquih-ben-salah-allal-ben-abdellah-197", "khouribga-mohamed-vi-30", "tanger-ville-said-kotb-19a", "tetouan-cortoba-146", "sale-hay-nasser-12bis"]) {
    assert.equal(knownSites.find((site) => site.id === id)?.finalLegTrackingUnavailable, true, `${id} should be flagged`);
  }
  for (const id of ["brussels-abattoir-45", "tanger-med-ksar-al-majaz", "casablanca-mohammed-vi-959"]) {
    assert.notEqual(knownSites.find((site) => site.id === id)?.finalLegTrackingUnavailable, true, `${id} should not be flagged -- confirmed GPS hub or Belgium origin`);
  }
});

test("every untracked-final-leg site points to whichever confirmed hub is geographically closer", () => {
  for (const id of ["marrakech-essaouira-12", "agadir-zaitoune-tikiouine-103a", "fquih-ben-salah-allal-ben-abdellah-197", "khouribga-mohamed-vi-30", "sale-hay-nasser-12bis"]) {
    assert.equal(knownSites.find((site) => site.id === id)?.relayHubSiteId, "casablanca-mohammed-vi-959", `${id} should point to the Casablanca relay hub`);
  }
  for (const id of ["tanger-ville-said-kotb-19a", "tetouan-cortoba-146"]) {
    assert.equal(knownSites.find((site) => site.id === id)?.relayHubSiteId, "tanger-med-ksar-al-majaz", `${id} should point to the Tanger Med relay hub`);
  }
  // Every relay hub id must itself be a real, resolvable site.
  for (const site of knownSites.filter((site) => site.finalLegTrackingUnavailable)) {
    assert.ok(knownSites.some((hub) => hub.id === site.relayHubSiteId), `${site.id}'s relayHubSiteId must resolve to a real site`);
  }
});
