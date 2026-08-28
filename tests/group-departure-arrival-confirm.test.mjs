import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [page, manualCompletionRoute] = await Promise.all([
  readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/deliveries/manual-completion/route.ts", import.meta.url), "utf8"),
]);

// Moved from a per-delivery popover button to a group-level action in the
// delivery table's own actions column, mirroring how truck reassignment and
// schedule edits already work at the truck-group level rather than one
// parcel at a time -- requested live after the departure-confirm feature
// shipped in a separate popover-only form the previous night.
test("confirming departure or arrival is a group-level action, not per delivery -- both take a list of deliveryIds", () => {
  assert.match(page, /async function confirmGroupDeparture\(label: string, deliveryIds: string\[\]\) \{/);
  assert.match(page, /async function confirmGroupArrival\(label: string, deliveryIds: string\[\]\) \{/);
});

test("the departure button only shows for a dispatcher, and only when the group actually has a Loading member", () => {
  assert.match(page, /\{company\?\.role === "dispatcher" && group\.deliveries\.some\(\(delivery\) => delivery\.status === "Loading"\) && <button type="button" className="more-button" disabled=\{groupDeparturePending === group\.label\}/);
  assert.match(page, /void confirmGroupDeparture\(group\.label, group\.deliveries\.filter\(\(delivery\) => delivery\.status === "Loading"\)\.map\(\(delivery\) => delivery\.id\)\)/);
});

test("the arrival button shows for either role (matching confirmArrival's own permission model), only once a member has actually departed and isn't already Delivered", () => {
  assert.match(page, /\{company && group\.deliveries\.some\(\(delivery\) => delivery\.status !== "Delivered" && delivery\.status !== "Loading"\) && <button type="button" className="more-button" disabled=\{groupArrivalPending === group\.label\}/);
  assert.match(page, /void confirmGroupArrival\(group\.label, group\.deliveries\.filter\(\(delivery\) => delivery\.status !== "Delivered" && delivery\.status !== "Loading"\)\.map\(\(delivery\) => delivery\.id\)\)/);
});

test("both group confirmations require an explicit browser confirmation before doing anything, mentioning the WhatsApp notice up front", () => {
  assert.match(page, /Confirmer le départ pour \$\{deliveryIds\.length\} colis, et notifier les clients par WhatsApp/);
  assert.match(page, /Confirmer l'arrivée pour \$\{deliveryIds\.length\} colis, et notifier les clients par WhatsApp/);
  assert.match(page, /if \(!window\.confirm\(confirmation\)\) return;\s*\n\s*setGroupDeparturePending\(label\);/);
  assert.match(page, /if \(!window\.confirm\(confirmation\)\) return;\s*\n\s*setGroupArrivalPending\(label\);/);
});

// Uses the same free, customer-service-window freeform reply the standalone
// "Notifier par WhatsApp" buttons already use (notify-departure/
// notify-arrival) -- not the paid, still-disabled automatic template push
// (WHATSAPP_AUTOMATION_ENABLED stays off; this doesn't touch that gate at
// all). A closed 24h window or withdrawn consent is a normal, expected
// per-delivery outcome, so the toast distinguishes "confirmed, and at least
// one notify succeeded" from "confirmed, but nothing could be sent" rather
// than claiming success either way.
test("each group confirmation notifies via the existing free WhatsApp mechanism after the status change succeeds, and reports honestly if nothing could actually be sent", () => {
  assert.match(page, /fetch\("\/api\/deliveries\/notify-departure", \{/);
  assert.match(page, /fetch\("\/api\/deliveries\/notify-arrival", \{/);
  assert.match(page, /const anyNotified = notifyResults\.some\(\(result\) => result\.ok\);/g);
  assert.match(page, /WhatsApp non envoyé : fenêtre 24h fermée ou consentement retiré/);
});

test("manual-completion's confirmDeparture and confirmArrival branches now return the updated delivery, so the frontend can merge it without a full refetch", () => {
  assert.match(manualCompletionRoute, /const delivery = \(await store\.listForCompany\(session\.companyId\)\)\.find\(\(candidate\) => candidate\.id === deliveryId\);\s*\n\s*return noStore\(\{ ok: true, deliveryId, status: "In transit", departureConfirmed: true, delivery \}\);/);
  assert.match(manualCompletionRoute, /const updated = \(await store\.listForCompany\(session\.companyId\)\)\.find\(\(candidate\) => candidate\.id === deliveryId\);\s*\n\s*return noStore\(\{ ok: true, deliveryId, arrivalConfirmed: true, automaticCompletionAfterMinutes: unloadGraceMinutes, delivery: updated \}\);/);
});

test("the delivery-detail popover's standalone 'Confirmer l'arrivée du camion' button is gone -- the table's group action replaced it", () => {
  assert.doesNotMatch(page, /Confirmer l’arrivée du camion/);
  assert.doesNotMatch(page, /Confirm truck arrival/);
});
