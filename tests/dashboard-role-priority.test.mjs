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

test("the delivery table shows which agency registered each parcel, but only for the dispatcher who oversees every agency", () => {
  assert.match(page, /company\?\.role === "dispatcher" && <th>\{locale === "fr" \? "Agence"/);
  assert.match(page, /company\?\.role === "dispatcher" && <td>\{knownSites\.find\(\(site\) => site\.id === delivery\.originSiteId\)\?\.label \?\? "—"\}<\/td>/);
});
