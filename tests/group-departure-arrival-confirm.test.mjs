import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [page, manualCompletionRoute, css] = await Promise.all([
  readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/deliveries/manual-completion/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
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

// Reported live: a truck can relay to several different agencies on one
// run, and the group-level arrival button was marking every parcel on the
// truck as arrived at once, regardless of which agency it actually reached.
// Arrival is scoped per destination subgroup instead -- one button per
// agency actually present in the group, each only touching that agency's
// parcels. Departure stays whole-group (see the test above): the truck
// leaving the depot is a single physical event for every parcel on it,
// unlike arrival which happens at a specific agency.
test("the arrival button is scoped per destination subgroup, not the whole group -- a truck relaying to several agencies gets one button per agency it actually reached", () => {
  assert.match(page, /const destinationSubgroups: \{ destination: string; deliveries: Delivery\[\] \}\[\] = Array\.from\(/);
  assert.match(page, /\{company && group\.destinationSubgroups\.map\(\(subgroup\) => \{/);
  assert.match(page, /const eligible = subgroup\.deliveries\.filter\(\(delivery\) => delivery\.status !== "Delivered" && delivery\.status !== "Loading"\);/);
  assert.match(page, /if \(!eligible\.length\) return null;/);
  assert.match(page, /const arrivalKey = `\$\{group\.label\}::\$\{subgroup\.destination\}`;/);
  assert.match(page, /disabled=\{groupArrivalPending === arrivalKey\}/);
  assert.match(page, /void confirmGroupArrival\(arrivalKey, eligible\.map\(\(delivery\) => delivery\.id\)\)/);
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

// Reported live: the icon-only action buttons (🚚, ✎, →, ✓, ↗) gave no clue
// what they did before clicking, and were tiny (no explicit size -- they
// just inherited the table's ~9.5px body text size). aria-label already
// covered screen readers; title is what actually produces a hover tooltip
// in a mouse-driven browser, which is what was missing.
test("every icon-only table action button now has a hover tooltip (title) matching its aria-label, not just an aria-label", () => {
  const buttonPatterns = [
    /className="more-button group-truck-editor-trigger" title=\{locale === "fr" \? "Changer le camion pour tout le groupe"/,
    /className="more-button group-schedule-editor-trigger" title=\{locale === "fr" \? "Modifier les dates pour ce camion"/,
    /disabled=\{groupDeparturePending === group\.label\} title=\{locale === "fr" \? "Confirmer le départ pour tout le groupe"/,
    /disabled=\{groupArrivalPending === arrivalKey\} title=\{locale === "fr" \? `Confirmer l’arrivée à \$\{subgroup\.destination\}`/,
    /className="more-button journey-editor-trigger" title=\{locale === "fr" \? "Modifier le trajet"/,
    /className="more-button" title=\{t\.copyTrackingFor\(delivery\.id\)\} aria-label=\{t\.copyTrackingFor\(delivery\.id\)\}/,
  ];
  for (const pattern of buttonPatterns) assert.match(page, pattern, `expected a title alongside this button's existing aria-label: ${pattern}`);
});

test("icon-only action buttons are a comfortable click target now, not the table's tiny inherited body text size, with visible hover/disabled feedback", () => {
  assert.match(css, /\.more-button \{ border: 0; background: transparent; color: #8c9791; cursor: pointer; font-size: 15px; line-height: 1; padding: 5px; border-radius: 6px; \}/);
  assert.match(css, /\.more-button:hover:not\(:disabled\) \{ background: #eef2f0; color: #52635b; \}/);
  assert.match(css, /\.more-button:disabled \{ opacity: \.4; cursor: default; \}/);
});
