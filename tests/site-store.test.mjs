import assert from "node:assert/strict";
import test from "node:test";
import { memorySiteStore } from "../app/lib/site-store.memory.ts";

test("seeds operational sites and persists company-specific additions", async () => {
  const initial = await memorySiteStore.listForCompany("company-sites-a");
  assert.ok(initial.length >= 10);
  assert.ok(initial.some((site) => site.id === "casablanca-mohammed-vi-959"));

  await memorySiteStore.upsert({
    companyId: "company-sites-a",
    id: "rabat-custom-terminal",
    label: "Rabat · Nouveau dépôt",
    city: "Rabat",
    country: "MA",
    address: "Adresse test Rabat, Maroc",
    latitude: 34.02,
    longitude: -6.83,
    arrivalRadiusKm: 0.6,
    roles: ["origin", "destination"],
  });

  const reloaded = await memorySiteStore.listForCompany("company-sites-a");
  const custom = reloaded.find((site) => site.id === "rabat-custom-terminal");
  assert.ok(custom);
  assert.equal(custom.address, "Adresse test Rabat, Maroc");
  assert.equal(custom.arrivalRadiusKm, 0.6);

  const otherCompany = await memorySiteStore.listForCompany("company-sites-b");
  assert.equal(otherCompany.some((site) => site.id === "rabat-custom-terminal"), false);
});
