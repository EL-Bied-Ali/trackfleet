import assert from "node:assert/strict";
import test from "node:test";
import { findCompanySiteByText, resolveExplicitCompanySite } from "../app/lib/delivery-site-resolution.ts";

function site(companyId, id, label, address) {
  return { companyId, id, label, city: label.split(" · ")[0], address, country: "MA", roles: ["origin", "destination"], latitude: 34, longitude: -6, arrivalRadiusKm: 0.5, geofenceReady: true, createdAt: new Date(), updatedAt: new Date() };
}

test("resolves tenant custom site by explicit id and text", () => {
  const sites = [site("company-a", "custom-rabat", "Rabat · Custom", "Rue test Rabat")];
  assert.equal(resolveExplicitCompanySite(sites, "custom-rabat").site?.id, "custom-rabat");
  assert.equal(findCompanySiteByText(sites, "rue test rabat")?.id, "custom-rabat");
});

test("rejects an explicit site id that is not present in the company site list", () => {
  const companyASites = [site("company-a", "custom-rabat", "Rabat · Custom", "Rue test Rabat")];
  const selection = resolveExplicitCompanySite(companyASites, "company-b-private-site");
  assert.equal(selection.site, null);
  assert.equal(selection.invalid, true);
});

test("blank explicit site selection remains optional", () => {
  const selection = resolveExplicitCompanySite([], "   ");
  assert.equal(selection.site, null);
  assert.equal(selection.invalid, false);
});
