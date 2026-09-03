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
  assert.match(page, /const \[parcelDrafts, setParcelDrafts\] = useState<DeliveryCreationDraftParcel\[\]>\(\[emptyParcelDraft\("0"\)\]\);/);
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
  assert.match(page, /for \(let parcelIndex = 0; parcelIndex < parcelDrafts\.length; parcelIndex\+\+\) \{/);
  assert.match(page, /const weightRaw = weightGroups\[parcelIndex\]\.effectiveWeightKg\.trim\(\);/);
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
// real workflow the client won't change). A first version added a separate
// "poids total + Répartir" tool block, but that made the form taller and
// felt disconnected from the rows it affected -- replaced with a compact
// per-row checkbox instead: checking "compté avec le colis précédent" folds
// a row into the nearest preceding un-grouped row (the anchor), whose own
// weightKg input is then read as a TOTAL for the whole run and split evenly
// (see parcelWeightGroups). A standalone row (no followers) is unaffected.
test("parcelWeightGroups splits an anchor's weight evenly across a run of consecutive grouped rows, and leaves an ungrouped row's own weight untouched", () => {
  const page = files["app/page.tsx"];
  const fnStart = page.indexOf("function parcelWeightGroups(drafts: DeliveryCreationDraftParcel[])");
  assert.ok(fnStart > -1, "expected parcelWeightGroups to be defined");
  const fnBody = page.slice(fnStart, page.indexOf("\n}", fnStart));
  assert.match(fnBody, /while \(j \+ 1 < drafts\.length && drafts\[j \+ 1\]\.groupedWithPrevious\) j\+\+;/);
  assert.match(fnBody, /const each = groupSize > 1 && total !== null && Number\.isFinite\(total\) && total > 0\s*\n\s*\? String\(Math\.round\(\(total \/ groupSize\) \* 1000\) \/ 1000\)\s*\n\s*: drafts\[i\]\.weightKg;/);
  assert.match(fnBody, /groups\.push\(\{ effectiveWeightKg: groupSize > 1 \? each : drafts\[k\]\.weightKg, groupSize, isAnchor: k === i \}\);/);
});

test("every row after the first offers a 'counted with the previous parcel' checkbox, and toggling it is the only way to set groupedWithPrevious", () => {
  const page = files["app/page.tsx"];
  assert.match(page, /\{index > 0 && <label className="grouped-weight-checkbox"><input type="checkbox" checked=\{parcel\.groupedWithPrevious\}/);
});

test("a grouped (non-anchor) row hides its own weight input behind a read-only note, and never independently prompts for an item description -- only the anchor can, and only when the group's total is still missing", () => {
  const page = files["app/page.tsx"];
  assert.match(page, /isAnchor \? <label><span className="field-label">\{groupSize > 1 \?/);
  // Wrapped in the same <label><span className="field-label">...</span> ...
  // structure the anchor's own weight input uses (not a bare <div>) -- a
  // live screenshot caught the bare version rendering visibly higher than
  // the "Prix" column beside it, since it skipped the label-text row every
  // other field in this grid has.
  assert.match(page, /<label><span className="field-label">\{locale === "fr" \? "Poids du colis"[^<]*<\/span><div className="grouped-weight-note">\{locale === "fr" \? `= \$\{effectiveWeightKg \|\| "…"\} kg \(inclus avec le colis précédent\)`/);
  assert.match(page, /\{isAnchor && !effectiveWeightKg && <label>/);
});

test("removing any parcel row clears every row's groupedWithPrevious flag, so a dangling group can never point at a row that no longer exists", () => {
  const page = files["app/page.tsx"];
  assert.match(page, /onClick=\{\(\) => setParcelDrafts\(\(rows\) => rows\.filter\(\(row\) => row\.key !== parcel\.key\)\.map\(\(row\) => \(\{ \.\.\.row, groupedWithPrevious: false \}\)\)\)\}/);
});

test("submitting is blocked with a clear toast (not a confusing per-parcel API failure) if a group's total weight is still blank or invalid", () => {
  const page = files["app/page.tsx"];
  const fnStart = page.indexOf("async function createDelivery(event: React.FormEvent<HTMLFormElement>) {");
  const guardBody = page.slice(fnStart, fnStart + 700);
  assert.match(guardBody, /if \(weightGroups\.some\(\(group\) => group\.groupSize > 1 && !group\.effectiveWeightKg\)\) \{/);
  assert.match(guardBody, /return;\s*\n\s*\}/);
});
