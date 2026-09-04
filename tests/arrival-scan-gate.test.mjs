import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [manualCompletionRoute, page, siteManager] = await Promise.all([
  readFile(new URL("../app/api/deliveries/manual-completion/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/SiteManager.tsx", import.meta.url), "utf8"),
]);

// Client asked (from a photo of the depot's own paper process): a parcel
// should only move to history/out of the active table once it was actually
// scanned at both the depot and the hub -- previously clicking "Arrivé"
// worked regardless of scan history, silently losing the paper trail for a
// parcel that skipped a real checkpoint.

test("POST /api/deliveries/manual-completion checks both scan checkpoints before accepting confirmArrival, and refuses with a structured 409 naming which one is missing -- unless the dispatcher explicitly bypasses it", () => {
  assert.match(manualCompletionRoute, /const \[scanSummary\] = await store\.listScanSummaries\(session\.companyId, \[deliveryId\]\);/);
  assert.match(manualCompletionRoute, /const missingLoadedScan = !scanSummary\?\.loadedAt;/);
  assert.match(manualCompletionRoute, /const missingHubScan = !scanSummary\?\.hubArrivedAt;/);
  assert.match(manualCompletionRoute, /if \(\(missingLoadedScan \|\| missingHubScan\) && payload\.bypassMissingScans !== true\) \{\s*\n\s*return noStore\(\{ error: "arrival_blocked_missing_scans", missingLoadedScan, missingHubScan \}, 409\);/);
  // An explicit bypass still proceeds, but leaves a server-side trail --
  // the whole point of the original rule was an honest paper trail, so an
  // override shouldn't be silent.
  assert.match(manualCompletionRoute, /console\.warn\("\[trackfleet:deliveries\] arrival confirmed despite missing scans \(explicit bypass\)", \{/);
  // The gate must run after the existing not-found/role checks but before
  // the actual status-changing call, so a bad deliveryId or a mismatched
  // agency still gets its own specific error rather than being masked by
  // a scan-summary lookup for a delivery that isn't even confirmable.
  const gateIndex = manualCompletionRoute.indexOf("listScanSummaries");
  const notFoundIndex = manualCompletionRoute.indexOf("delivery_not_found_or_already_delivered");
  const confirmIndex = manualCompletionRoute.indexOf("confirmArrivalManually(session.companyId");
  assert.ok(notFoundIndex < gateIndex && gateIndex < confirmIndex, "expected: not-found check, then the scan gate, then the actual completion call");
});

test("the dispatcher's per-destination group arrival button surfaces exactly which delivery and which checkpoint(s) blocked it, and offers an explicit, separate bypass confirm rather than silently excluding them", () => {
  assert.match(page, /let blocked = responses\.filter\(\(result\) => result\.error === "arrival_blocked_missing_scans"\);/);
  assert.match(page, /if \(blocked\.length\) \{/);
  assert.match(page, /missingScansDetail\(result\)/);
  // The bypass prompt is a SEPARATE window.confirm from the original
  // "confirm arrival + notify?" one, never folded into the same click.
  assert.match(page, /if \(window\.confirm\(bypassPrompt\)\) \{/);
  assert.match(page, /postArrivalConfirmation\(result\.deliveryId, true\)/);
});

test("a partial success (some parcels blocked, others confirmed) still merges the confirmed ones and notifies for them, rather than discarding everything", () => {
  assert.match(page, /let updated = responses\.map\(\(result\) => result\.delivery\)\.filter\(\(delivery\): delivery is Delivery => Boolean\(delivery\)\);/);
  assert.match(page, /if \(!updated\.length\) return;\s*\n\s*\}\s*\n\s*if \(!updated\.length\) \{/);
});

// Live follow-up: the agency's expected-parcel panel used to have its own
// bespoke confirm-arrival implementation (agency-only, no WhatsApp notify,
// no bypass) -- unified onto confirmSingleArrival, the same standalone
// single-parcel function the main dashboard popover uses, rather than
// maintaining two different single-parcel confirm-arrival behaviors.
test("the agency's expected-parcel panel now uses the same standalone single-parcel confirm as the main dashboard popover, not its own separate implementation", () => {
  assert.doesNotMatch(page, /async function confirmArrivalForDelivery/);
  assert.match(page, /onClick=\{\(\) => void confirmSingleArrival\(delivery\.id\)\}/);
});

test("confirmSingleArrival offers the same explicit, separate bypass confirm as the group flow, then notifies the customer once actually confirmed", () => {
  assert.match(page, /async function confirmSingleArrival\(deliveryId: string\) \{/);
  const fn = page.slice(page.indexOf("async function confirmSingleArrival"), page.indexOf("async function confirmSingleArrival") + 2000);
  assert.match(fn, /if \(result\.error === "arrival_blocked_missing_scans"\) \{/);
  assert.match(fn, /if \(!window\.confirm\(bypassPrompt\)\) \{/);
  assert.match(fn, /result = await postArrivalConfirmation\(deliveryId, true\);/);
  assert.match(fn, /fetch\("\/api\/deliveries\/notify-arrival", \{/);
});

test("SiteManager's dispatcher-facing 'Arrivées' ops panel also surfaces the specific missing-checkpoint message, localized in all 3 languages", () => {
  assert.match(siteManager, /if \(response\.status === 409 && data\?\.error === "arrival_blocked_missing_scans"\) \{/);
  assert.match(siteManager, /setArrivalBlockedScans\(\{ missingLoaded: Boolean\(data\.missingLoadedScan\), missingHub: Boolean\(data\.missingHubScan\) \}\);/);
  assert.match(siteManager, /arrivalBlocked: \(missingLoaded: boolean, missingHub: boolean\) => `Arrivée bloquée : colis non scanné \$\{missingLoaded && missingHub \? "au dépôt et au hub" : missingLoaded \? "au dépôt" : "au hub"\}\.`/);
  assert.match(siteManager, /arrivalBlocked: \(missingLoaded: boolean, missingHub: boolean\) => `Aankomst geblokkeerd: pakket niet gescand/);
  assert.match(siteManager, /arrivalBlocked: \(missingLoaded: boolean, missingHub: boolean\) => `Arrival blocked: parcel not scanned/);
});

test("SiteManager's completion-error banner shows the specific scan-blocked message when that's the cause, falling back to the generic message for every other completion-panel error code", () => {
  assert.match(siteManager, /\{completionError && <p className="login-error">\{completionError === "arrival_blocked_missing_scans" && arrivalBlockedScans \? copy\.arrivalBlocked\(arrivalBlockedScans\.missingLoaded, arrivalBlockedScans\.missingHub\) : copy\.completionError\}<\/p>\}/);
});
