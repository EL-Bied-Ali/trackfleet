import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { memoryStore } from "../app/lib/delivery-store.memory.ts";

// Task 7 of the depot-shelf-photo batch: track whether a parcel's price has
// actually been collected (paid/partial/unpaid), editable at creation and
// at edit time, separate from priceAmount/priceCurrency itself (the
// trusted billing figure, unaffected by what's been paid). Settled via
// AskUserQuestion: editable any time (not just at creation), and for a
// partial payment the dispatcher enters the amount paid SO FAR, with the
// remaining balance computed from the delivery's own price.

const [
  deliveryStoreTypes, deliveryStorePostgres, deliveryStoreCloudflare,
  deliveriesRoute, updateRoute, page, labelsPage,
  storageSchemaContract, prepareD1Schema,
] = await Promise.all([
  readFile(new URL("../app/lib/delivery-store.types.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/delivery-store.postgres.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/delivery-store.cloudflare.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/deliveries/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/deliveries/update/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/labels/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/storage-schema-contract.ts", import.meta.url), "utf8"),
  readFile(new URL("../scripts/prepare-d1-schema.mjs", import.meta.url), "utf8"),
]);

test("DeliveryRow carries an optional paymentStatus/amountPaid, and DeliveryDetailsUpdateInput requires both on every edit", () => {
  assert.match(deliveryStoreTypes, /paymentStatus\?: "unpaid" \| "partial" \| "paid" \| null;/);
  assert.match(deliveryStoreTypes, /amountPaid\?: number \| null;/);
  assert.match(deliveryStoreTypes, /paymentStatus: "unpaid" \| "partial" \| "paid";\s*\n\s*amountPaid: number \| null;/);
});

test("the Postgres columns have no DEFAULT -- historical deliveries stay NULL (unknown) rather than being backdated to 'unpaid', which would misrepresent parcels already paid in reality", () => {
  assert.match(deliveryStorePostgres, /ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS payment_status text`;/);
  assert.match(deliveryStorePostgres, /ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS amount_paid numeric\(12,2\)`;/);
  assert.doesNotMatch(deliveryStorePostgres, /payment_status text DEFAULT/);
});

test("every NEW delivery gets an explicit 'unpaid' default at creation, in both the Postgres and D1 backends", () => {
  assert.match(deliveryStorePostgres, /paymentStatus: input\.paymentStatus \?\? "unpaid",/);
  assert.match(deliveryStoreCloudflare, /paymentStatus: input\.paymentStatus \?\? "unpaid",/);
});

test("the memory backend threads paymentStatus/amountPaid through create and updateDetails (Object.assign/spread already covers new fields generically)", async () => {
  const created = await memoryStore.create({
    id: undefined, customer: "Payment Test", originSiteId: null, originLatitude: null, originLongitude: null,
    destinationSiteId: null, destination: "Test City", destinationLatitude: null, destinationLongitude: null,
    arrivalRadiusKm: 0.5, truck: "T1", driver: "d", status: "Loading", eta: "", plannedArrivalAt: null,
    nextTruckDepartureAt: null, progress: 0, color: "#000", contact: "", sendatrackVehicleId: "", latitude: null,
    longitude: null, speed: null, lastPositionAt: null, gpsSource: "simulation", companyId: "company-payment-a",
    trackingToken: "tok-payment-a", paymentStatus: "unpaid", amountPaid: null,
  });
  assert.equal(created.paymentStatus, "unpaid");
  const updated = await memoryStore.updateDetails(created.id, "company-payment-a", {
    customer: "Payment Test", contact: "", customerEmail: null, recipientName: "", recipientContact: "",
    weightKg: 10, priceAmount: 15, priceCurrency: "EUR", paymentStatus: "partial", amountPaid: 5,
    itemDescription: null, destinationSiteId: null, destination: "Test City", destinationLatitude: null,
    destinationLongitude: null, arrivalRadiusKm: 0.5, plannedArrivalAt: null,
  });
  assert.equal(updated?.paymentStatus, "partial");
  assert.equal(updated?.amountPaid, 5);
});

test("both creation and edit validate paymentStatus against the 3 allowed values, and require a positive amountPaid strictly less than the price when partial", () => {
  for (const route of [deliveriesRoute, updateRoute]) {
    assert.match(route, /if \(!\["unpaid", "partial", "paid"\]\.includes\(paymentStatusInput\)\) \{/);
    assert.match(route, /paymentStatus must be one of unpaid, partial, paid/);
    assert.match(route, /if \(paymentStatusInput === "partial" && \(amountPaidInput === null \|\| amountPaidInput <= 0\)\) \{/);
    assert.match(route, /if \(paymentStatusInput === "partial" && priceAmount !== null && amountPaidInput !== null && amountPaidInput >= priceAmount\) \{/);
    assert.match(route, /use paymentStatus 'paid' instead/);
  }
});

test("amountPaid is only ever stored when paymentStatus is 'partial' -- null for 'paid'/'unpaid', even if a stale amount was submitted alongside them", () => {
  for (const route of [deliveriesRoute, updateRoute]) {
    assert.match(route, /const amountPaid = paymentStatusInput === "partial" \? amountPaidInput : null;/);
  }
});

test("the creation/edit form offers 3 mutually-exclusive payment-status pills plus a conditional 'amount paid so far' field with a live remaining-balance hint", () => {
  assert.match(page, /\(\["unpaid", "partial", "paid"\] as const\)\.map\(\(status\) =>/);
  assert.match(page, /aria-pressed=\{parcel\.paymentStatus === status\}/);
  assert.match(page, /\{parcel\.paymentStatus === "partial" && <label>/);
  assert.match(page, /const remaining = effectivePriceAmount != null && Number\(parcel\.amountPaid\) > 0 \? effectivePriceAmount - Number\(parcel\.amountPaid\) : null;/);
});

test("editing a delivery pre-fills the current paymentStatus/amountPaid (defaulting a delivery created before this existed to 'unpaid'), same non-destructive-edit principle as the price field", () => {
  assert.match(page, /paymentStatus: delivery\.paymentStatus \?\? "unpaid",/);
  assert.match(page, /amountPaid: delivery\.amountPaid != null \? String\(delivery\.amountPaid\) : "",/);
});

test("the label's extended-details rows (origin, phone, weight/price/payment) only render at 55mm+ label height, leaving the already-proven-safe 16/feuille 5-row layout completely untouched", () => {
  assert.match(labelsPage, /const showExtendedDetails = labelSize\.height >= 55;/);
  assert.match(labelsPage, /\{showExtendedDetails \? \(<>/);
  // The 16/feuille branch must still be the pre-existing,
  // live-verified-at-0px-overflow row count -- shortCode/id now lead with
  // the same shortCode-first priority as the extended layout (per a later
  // request), but still on that one single line, never a new row.
  assert.match(labelsPage, /<div style=\{\{ fontSize: 13, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" \}\}>\{delivery\.shortCode \?\? delivery\.id\}\{delivery\.shortCode \? ` · \$\{delivery\.id\}` : ""\}<\/div>/);
});

test("the extended label shows the short code in large type (falling back to the plain id when this destination has no shortCodePrefix), origin -> destination, phone, and a compact weight/price/payment line", () => {
  assert.match(labelsPage, /fontSize: delivery\.shortCode \? 20 : 15, fontWeight: 800/);
  assert.match(labelsPage, /\{delivery\.shortCode \?\? delivery\.id\}/);
  assert.match(labelsPage, /\{\(\(delivery\.originSiteId && siteCities\.get\(delivery\.originSiteId\)\) \|\| ""\) \+ " → " \+ /);
  assert.match(labelsPage, /Tél : \{delivery\.contact\}/);
  assert.match(labelsPage, /\{paymentSummary\(delivery\)\}/);
});

test("paymentSummary formats a compact weight/price/status line, and computes the remaining balance for a partial payment from the delivery's own price rather than storing it separately", () => {
  assert.match(labelsPage, /function paymentSummary\(delivery: LabelDelivery\): string \| null \{/);
  assert.match(labelsPage, /if \(delivery\.paymentStatus === "partial"\) \{/);
  assert.match(labelsPage, /Reste \$\{Math\.round\(\(delivery\.priceAmount - delivery\.amountPaid\) \* 100\) \/ 100\}\$\{currencySuffix\}/);
});

test("the D1 schema script and the Postgres schema contract both know about payment_status/amount_paid", () => {
  assert.match(prepareD1Schema, /payment_status text,\s*\n\s*amount_paid real/);
  assert.match(prepareD1Schema, /\["payment_status", "text"\],\s*\n\s*\["amount_paid", "real"\],/);
  assert.match(storageSchemaContract, /\{ table: "deliveries", column: "payment_status" \},\s*\n\s*\{ table: "deliveries", column: "amount_paid" \},/);
});
