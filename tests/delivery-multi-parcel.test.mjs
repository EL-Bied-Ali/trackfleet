import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const files = Object.fromEntries(await Promise.all([
  "app/api/deliveries/route.ts",
  "app/lib/delivery-store.types.ts",
  "app/lib/delivery-store.postgres.ts",
  "app/lib/delivery-operational.postgres.ts",
  "app/lib/delivery-store.cloudflare.ts",
  "app/lib/delivery-operational.cloudflare.ts",
  "app/lib/delivery-store.shared-postgres.ts",
  "app/lib/d1-standby-read-store.ts",
  "app/lib/d1-history-backfill.ts",
  "app/lib/d1-reconciliation.ts",
  "app/lib/storage-schema-contract.ts",
  "app/lib/public-delivery-view.ts",
  "scripts/prepare-d1-schema.mjs",
  "app/page.tsx",
  "app/globals.css",
].map(async (path) => [path, await readFile(new URL(`../${path}`, import.meta.url), "utf8")])));

test("a client can send several parcels at once, each still its own independently tracked delivery, linked by one client-generated shipmentId", () => {
  // Chosen over a single record with a quantity field specifically to keep
  // each parcel's own TF-id/tracking-link/WhatsApp/weight/price -- the whole
  // point of TrackFleet is per-parcel tracking, a "quantity" field would
  // have thrown that away for the multi-parcel case.
  assert.match(files["app/lib/delivery-store.types.ts"], /shipmentId\?: string \| null;/);
});

test("the create-delivery API validates and stores an optional client-generated shipmentId", () => {
  const route = files["app/api/deliveries/route.ts"];
  assert.match(route, /const SHIPMENT_ID_PATTERN = \/\^\[A-Za-z0-9\._:-\]\{8,128\}\$\/;/);
  assert.match(route, /const shipmentIdInput = String\(payload\.shipmentId \?\? ""\)\.trim\(\);/);
  assert.match(route, /if \(shipmentIdInput && !SHIPMENT_ID_PATTERN\.test\(shipmentIdInput\)\)/);
  assert.match(route, /shipmentId: shipmentIdInput \|\| null,/);
});

test("shipmentId is never exposed on the public customer tracking view", () => {
  // The allowlist in publicDeliveryView constructs a fresh object from named
  // fields (not a deny-list), so shipmentId is excluded by construction --
  // a customer has no business seeing an internal grouping key, let alone
  // any hint about other parcels in the same submission.
  assert.doesNotMatch(files["app/lib/public-delivery-view.ts"], /shipmentId/);
});

test("shipment_id is propagated through every delivery storage path: Postgres, its operational read path, D1/Cloudflare, D1 mirror, standby, history backfill and reconciliation", () => {
  for (const path of [
    "app/lib/delivery-store.postgres.ts",
    "app/lib/delivery-operational.postgres.ts",
    "app/lib/delivery-store.cloudflare.ts",
    "app/lib/delivery-operational.cloudflare.ts",
    "app/lib/delivery-store.shared-postgres.ts",
    "app/lib/d1-standby-read-store.ts",
    "app/lib/d1-history-backfill.ts",
    "app/lib/d1-reconciliation.ts",
    "scripts/prepare-d1-schema.mjs",
  ]) {
    assert.match(files[path], /shipment_id/, `${path} must carry shipment_id`);
  }
});

test("the Postgres schema-safety contract knows about shipment_id, so CI catches a production database that's missing the column", () => {
  assert.match(files["app/lib/storage-schema-contract.ts"], /\{ table: "deliveries", column: "shipment_id" \}/);
});

test("the create-delivery form lets a dispatcher add several parcel rows for one client, each with its own weight/price", () => {
  const page = files["app/page.tsx"];
  assert.match(page, /const \[parcelDrafts, setParcelDrafts\] = useState<Array<\{ key: string; weightKg: string; manualPriceAmount: string; itemDescription: string; paymentStatus: "unpaid" \| "partial" \| "paid"; amountPaid: string \}>>\(\[\{ key: "0", weightKg: "", manualPriceAmount: "", itemDescription: "", paymentStatus: "unpaid", amountPaid: "" \}\]\);/);
  assert.match(page, /\{parcelDrafts\.map\(\(parcel, index\) => \{/);
  assert.match(page, /className="add-parcel-row"/);
  assert.match(page, /className="remove-parcel-row"/);
  // Removing a row is only offered once there's more than one -- a lone
  // parcel has nothing to remove down to.
  assert.match(page, /\{parcelDrafts\.length > 1 && <button type="button" className="remove-parcel-row"/);
});

test("submitting the form issues one create request per parcel row, all sharing one generated shipmentId, and reports partial failure honestly instead of pretending the whole batch succeeded", () => {
  const page = files["app/page.tsx"];
  assert.match(page, /const shipmentId = crypto\.randomUUID\(\);/);
  assert.match(page, /for \(const parcel of parcelDrafts\) \{/);
  assert.match(page, /shipmentId,\s*\n\s*weightKg: weightRaw \? Number\(weightRaw\) : null,/);
  // Each parcel is an independent request/resource (own tracking, own
  // consent, own price) -- a failure partway through must not be silently
  // swallowed or reported as full success.
  assert.match(page, /if \(failure\) \{/);
  assert.match(page, /colis créés, échec du reste : \$\{failure\}/);
});

test("the delivery table shows a small 'N linked parcels' hint when a delivery has visible siblings from the same submission, computed from what's on screen, and hidden for lone parcels", () => {
  const page = files["app/page.tsx"];
  const css = files["app/globals.css"];
  assert.match(page, /const shipmentSizes = useMemo\(\(\) => \{/);
  assert.match(page, /\{delivery\.shipmentId && \(shipmentSizes\.get\(delivery\.shipmentId\) \?\? 0\) > 1 && <span className="shipment-badge">/);
  assert.match(css, /td > span\.shipment-badge \{/);
});

// The depot scale weighs several parcels for the same client at once (a
// real workflow the client won't change) -- rather than force the employee
// to weigh each one separately, this splits one combined weight evenly
// across the parcel rows already added via "+ Ajouter un colis". Only
// touches weightKg on each row; price/payment/description are computed or
// entered per row exactly as before.
test("the create-delivery form offers a 'weigh together' tool for 2-5 parcel rows that splits one total weight evenly, leaving 0 or 1 row (nothing to split) and 6+ rows (past the client's stated max) alone", () => {
  const page = files["app/page.tsx"];
  assert.match(page, /const \[sharedWeightTotal, setSharedWeightTotal\] = useState\(""\);/);
  assert.match(page, /\{!editingDeliveryId && parcelDrafts\.length >= 2 && parcelDrafts\.length <= 5 && <div className="shared-weight-tool">/);
});

test("the 'weigh together' split divides the entered total by the current parcel row count, rounds to 3 decimals (matching the weight input's own step), and applies the same value to every row", () => {
  const page = files["app/page.tsx"];
  const toolStart = page.indexOf('<div className="shared-weight-tool">');
  const toolBody = page.slice(toolStart, page.indexOf("</div>", toolStart) + "</div>".length);
  assert.match(toolBody, /const total = Number\(sharedWeightTotal\); if \(!Number\.isFinite\(total\) \|\| total <= 0\) return;/);
  assert.match(toolBody, /const each = Math\.round\(\(total \/ parcelDrafts\.length\) \* 1000\) \/ 1000;/);
  assert.match(toolBody, /setParcelDrafts\(\(rows\) => rows\.map\(\(row\) => \(\{ \.\.\.row, weightKg: String\(each\) \}\)\)\);/);
  assert.match(toolBody, /setSharedWeightTotal\(""\);/);
});

test("sharedWeightTotal is cleared on every close/submit path, same as parcelDrafts, so a stale total never survives into the next delivery", () => {
  const page = files["app/page.tsx"];
  const resetSites = [...page.matchAll(/setParcelDrafts\(\[\{ key: "0", weightKg: "", manualPriceAmount: "", itemDescription: "", paymentStatus: "unpaid", amountPaid: "" \}\]\);\n\s*setSharedWeightTotal\(""\);/g)];
  assert.equal(resetSites.length, 3, "expected all 3 parcelDrafts reset sites (close, edit-save, create-success) to also clear sharedWeightTotal");
});
