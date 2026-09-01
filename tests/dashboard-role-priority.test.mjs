import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync("app/page.tsx", "utf8");

test("fleet-ops-only sections (active tours, frequent routes, recent trips) were removed from the dashboard entirely", () => {
  // Regression guard: these panels were already agency-hidden server-side
  // (stopPlans/routeHistory/trips are empty arrays for the agency role),
  // but still cluttered the dispatcher's own dashboard with data neither
  // the dispatcher nor an agency employee found useful in practice.
  assert.doesNotMatch(page, /Tournées actives/);
  assert.doesNotMatch(page, /Routes fréquentes/);
  assert.doesNotMatch(page, /Voyages récents/);
  // stopSequence( as a function call (from lib/tour-view) must be gone; the
  // unrelated suggestion.stopSequence property (from lib/trip-suggestion,
  // used by the still-present "Colis à affecter" feature) must stay.
  assert.doesNotMatch(page, /activeTourDisplayId|activeTourKey|stopSequence\(|tourCustomerCount|tourDeliveryCount/);
  assert.match(page, /suggestion\.stopSequence/);
  assert.doesNotMatch(page, /from "\.\/lib\/tour-view"/);
});

test("the trip-suggestion feature (Colis à affecter) keeps working -- only the display-only history panels were removed", () => {
  // trips/tripHistory still has a real consumer (suggestPlannedTrip), so it
  // must stay wired even though the "Voyages récents" display panel is gone.
  assert.match(page, /const \[trips, setTrips\] = useState<TripHistoryItem\[\]>\(\[\]\);/);
  assert.match(page, /suggestPlannedTrip\(delivery, trips\)/);
  assert.match(page, /Colis à affecter/);
});

test("agency employees see their own deliveries before the fleet map; dispatchers keep the map first", () => {
  const deliveriesPanelIndex = page.indexOf("const deliveriesPanel = (");
  const agencyPriorityIndex = page.indexOf('{company?.role === "agency" && deliveriesPanel}');
  const mapPanelIndex = page.indexOf('<div className="map-panel">');
  const dispatcherPositionIndex = page.indexOf('{company?.role !== "agency" && deliveriesPanel}');
  assert.ok(deliveriesPanelIndex >= 0, "deliveriesPanel must be defined once and reused");
  assert.ok(agencyPriorityIndex > deliveriesPanelIndex, "agency placement must come after the panel is defined");
  assert.ok(agencyPriorityIndex < mapPanelIndex, "agency's deliveries placement must render before the map panel");
  assert.ok(dispatcherPositionIndex > mapPanelIndex, "the dispatcher-visible placement must stay after the map panel, unchanged");
});

// The dedicated Agence column (which showed the origin site) was dropped
// entirely -- reported live as a column of nothing but "—" once its
// content moved to the group header, since a truck run is essentially
// always from one origin (unlike the destination, which genuinely varies
// on a multi-agency relay run). See delivery-truck-grouping.test.mjs's
// uniformOrigin test for where it lives now.
test("origin only ever appears hoisted in the group header, not as its own per-row column anymore", () => {
  assert.doesNotMatch(page, /<th>\{locale === "fr" \? "Agence" : locale === "nl" \? "Agentschap" : "Agency"\}<\/th>/);
  assert.match(page, /\{group\.uniformOrigin && <span>\{knownSites\.find\(\(site\) => site\.id === group\.uniformOrigin\)\?\.label \?\? "—"\}<\/span>\}/);
});
