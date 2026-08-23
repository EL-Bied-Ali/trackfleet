import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { arrivalConfirmationRecommendation } from "../app/lib/arrival-confirmation.ts";

const baseInput = {
  status: "In transit",
  progress: 95,
  plannedArrivalAt: null,
  destinationLatitude: null,
  destinationLongitude: null,
  gpsSource: "simulation",
  latitude: null,
  longitude: null,
  lastPositionAt: null,
  events: [],
};

test("a CTM-relay delivery is never recommended for manual confirmation once GPS naturally goes stale -- the automatic ~24h relay timer already handles it", () => {
  // Business-loop audit finding: GPS going stale/missing right after a
  // relay-hub destination is the *expected*, permanent state for that leg
  // (see KnownSite.finalLegTrackingUnavailable), not a problem. Before this
  // fix, arrivalConfirmationRecommendation didn't know about relay
  // destinations at all, so once GPS went stale it fell through to the same
  // "manual_recommended"/"gps_stale" branch as a genuinely stuck delivery --
  // prominently highlighted in the dispatcher's Arrivals panel. Clicking it
  // would fire the standard ~2h grace instead of the correct ~24h relay
  // window, sending the customer a premature "arrived" WhatsApp message
  // while the parcel was still genuinely in transit via the relay carrier.
  const result = arrivalConfirmationRecommendation({ ...baseInput, finalLegTrackingUnavailable: true });
  assert.deepEqual(result, { state: "automatic_pending", reason: "ctm_relay_in_progress" });
});

test("a CTM-relay flag does not override an already-confirmed arrival", () => {
  assert.deepEqual(
    arrivalConfirmationRecommendation({ ...baseInput, finalLegTrackingUnavailable: true, events: [{ type: "MANUAL_ARRIVAL_CONFIRMED" }] }),
    { state: "manual_confirmed", reason: "manual_already_confirmed" },
  );
  assert.deepEqual(
    arrivalConfirmationRecommendation({ ...baseInput, finalLegTrackingUnavailable: true, events: [{ type: "ARRIVED_AT_SITE" }] }),
    { state: "automatic_confirmed", reason: "gps_arrival_detected" },
  );
});

test("a CTM-relay delivery not yet plausibly arrived still shows the ordinary in-transit state, not the relay label prematurely", () => {
  assert.deepEqual(
    arrivalConfirmationRecommendation({ ...baseInput, status: "Loading", progress: 10, finalLegTrackingUnavailable: true }),
    { state: "automatic_pending", reason: "in_transit" },
  );
});

test("a non-relay delivery keeps the exact prior gps_unavailable/gps_stale manual-recommendation behavior", () => {
  assert.deepEqual(
    arrivalConfirmationRecommendation({ ...baseInput, finalLegTrackingUnavailable: false, destinationLatitude: 33.57, destinationLongitude: -7.59 }),
    { state: "manual_recommended", reason: "gps_unavailable" },
  );
  assert.deepEqual(
    arrivalConfirmationRecommendation({
      ...baseInput,
      finalLegTrackingUnavailable: false,
      destinationLatitude: 33.57,
      destinationLongitude: -7.59,
      gpsSource: "sendatrack",
      latitude: 33.5,
      longitude: -7.6,
      lastPositionAt: new Date(Date.now() - 45 * 60_000),
    }),
    { state: "manual_recommended", reason: "gps_stale" },
  );
});

test("the manual-completion endpoint resolves finalLegTrackingUnavailable from the delivery's own known destination site", () => {
  const route = fs.readFileSync("app/api/deliveries/manual-completion/route.ts", "utf8");
  assert.match(route, /import \{ knownSite \} from "\.\.\/\.\.\/\.\.\/lib\/known-sites";/);
  assert.match(route, /finalLegTrackingUnavailable: knownSite\(delivery\.destinationSiteId\)\?\.finalLegTrackingUnavailable === true,/);
});

test("the dispatcher Arrivals panel shows a distinct, non-urgent label for relay-in-progress instead of the prominent manual-recommended styling", () => {
  const siteManager = fs.readFileSync("app/SiteManager.tsx", "utf8");
  assert.match(siteManager, /delivery\.arrivalReason === "ctm_relay_in_progress"\s*\n\s*\? copy\.relayInProgress/);
  // The urgent primary-button styling is keyed off arrivalState alone, and
  // this case stays "automatic_pending" (not "manual_recommended") -- so it
  // never gets that class, even though the button remains available as a
  // deliberate manual override.
  assert.match(siteManager, /className=\{delivery\.arrivalState === "manual_recommended" \? "primary-button" : undefined\}/);
});
