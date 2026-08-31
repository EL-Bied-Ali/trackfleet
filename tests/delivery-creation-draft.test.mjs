import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  deliveryCreationDraftKey, isMeaningfulDeliveryCreationDraft,
} from "../app/lib/delivery-creation-draft.ts";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

function emptyDraft(overrides = {}) {
  return {
    destinationSiteId: "", departureAt: "", vehicleId: "", parcels: [],
    customer: "", contact: "", customerEmail: "", recipientName: "", recipientContact: "",
    whatsappOptIn: false,
    ...overrides,
  };
}

test("the draft key is namespaced per account and per user, same as origin/truck preference", () => {
  assert.equal(deliveryCreationDraftKey({ account: "Acme", user: "Alice" }), "trackfleet-delivery-draft:acme:alice");
  assert.notEqual(
    deliveryCreationDraftKey({ account: "Acme", user: "Alice" }),
    deliveryCreationDraftKey({ account: "Acme", user: "Bob" }),
  );
});

test("a draft with nothing typed into it is not meaningful -- an empty destination/departure/parcel list and blank text fields", () => {
  assert.equal(isMeaningfulDeliveryCreationDraft(emptyDraft()), false);
  assert.equal(isMeaningfulDeliveryCreationDraft(emptyDraft({
    parcels: [{ key: "0", weightKg: "", manualPriceAmount: "", itemDescription: "" }],
  })), false, "a single blank parcel row is the default shape, not real content");
});

test("any single non-empty field makes a draft meaningful", () => {
  assert.equal(isMeaningfulDeliveryCreationDraft(emptyDraft({ destinationSiteId: "casablanca-mohammed-vi-959" })), true);
  assert.equal(isMeaningfulDeliveryCreationDraft(emptyDraft({ departureAt: "2026-09-01T10:00" })), true);
  assert.equal(isMeaningfulDeliveryCreationDraft(emptyDraft({ customer: "Acme SARL" })), true);
  assert.equal(isMeaningfulDeliveryCreationDraft(emptyDraft({ contact: "+32470000000" })), true);
  assert.equal(isMeaningfulDeliveryCreationDraft(emptyDraft({ customerEmail: "a@b.com" })), true);
  assert.equal(isMeaningfulDeliveryCreationDraft(emptyDraft({ recipientName: "Bob" })), true);
  assert.equal(isMeaningfulDeliveryCreationDraft(emptyDraft({ recipientContact: "+212600000000" })), true);
  assert.equal(isMeaningfulDeliveryCreationDraft(emptyDraft({
    parcels: [{ key: "0", weightKg: "10", manualPriceAmount: "", itemDescription: "" }],
  })), true);
});

test("opening the creation modal restores a saved draft, validating the destination site and vehicle are still current", () => {
  assert.match(page, /const raw = window\.localStorage\.getItem\(deliveryCreationDraftKey\(company\)\);/);
  assert.match(page, /knownSites\.some\(\(site\) => site\.id === draft!\.destinationSiteId\) \? draft\.destinationSiteId : ""/);
  assert.match(page, /draft\.vehicleId && integration\.vehicles\.some\(\(vehicle\) => vehicle\.id === draft!\.vehicleId\) \? draft\.vehicleId : preferredVehicleId/);
});

test("closing without submitting saves the current form state as a draft (or clears a now-empty one), reading the uncontrolled text fields via FormData", () => {
  assert.match(page, /const formData = creationFormRef\.current \? new FormData\(creationFormRef\.current\) : null;/);
  assert.match(page, /if \(isMeaningfulDeliveryCreationDraft\(draft\)\) window\.localStorage\.setItem\(key, JSON\.stringify\(draft\)\);/);
  assert.match(page, /else window\.localStorage\.removeItem\(key\);/);
});

test("a successful submit clears the draft, not just the in-memory form state", () => {
  assert.match(page, /if \(company\) window\.localStorage\.removeItem\(deliveryCreationDraftKey\(company\)\);\s*setModalOpen\(false\);/);
});

test("the uncontrolled text inputs are seeded from the restored draft via defaultValue/defaultChecked, since they have no per-keystroke state of their own", () => {
  for (const field of ["customer", "contact", "customerEmail", "recipientName", "recipientContact"]) {
    assert.match(page, new RegExp(`name="${field}"[^>]*defaultValue=\\{creationDraftSeed\\?\\.${field} \\?\\? ""\\}`), `expected ${field} to be seeded from creationDraftSeed`);
  }
});

test("pressing Escape closes the creation modal through the same draft-saving path as the × and Cancel buttons, not a bare setModalOpen(false)", () => {
  assert.match(page, /if \(event\.key === "Escape" && modalOpen\) closeCreateModal\(\);/);
});

test("the creation form element carries a ref so closeCreateModal can read its uncontrolled fields", () => {
  assert.match(page, /<form onSubmit=\{createDelivery\} ref=\{creationFormRef\}>/);
});
