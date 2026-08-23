import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const map = fs.readFileSync("app/InteractiveFleetMap.tsx", "utf8");
const page = fs.readFileSync("app/page.tsx", "utf8");
const css = fs.readFileSync("app/globals.css", "utf8");

test("a live GPS truck with no delivery currently riding it is still a clickable marker, not a dead end", () => {
  // Reported live: only delivery-linked markers opened the truck popover --
  // an idle truck (GPS-linked but no active delivery) did nothing when
  // clicked. The element itself is now a real <button> (was a plain <div
  // role="img">) with its own click handler, matching the pattern already
  // used for delivery-linked markers.
  assert.match(map, /onSelectVehicle\?: \(vehicleId: string\) => void;/);
  assert.match(map, /const onSelectVehicleRef = useRef\(onSelectVehicle\);/);
  assert.match(map, /const marker = document\.createElement\("button"\);\s*\n\s*marker\.type = "button";/);
  assert.match(map, /marker\.addEventListener\("click", \(\) => onSelectVehicleRef\.current\?\.\(vehicle\.id\)\);/);
  assert.doesNotMatch(map, /marker\.setAttribute\("role", "img"\);/);
});

test("the idle-truck marker gets the same selected/pulse treatment as a delivery-linked marker once picked", () => {
  assert.match(map, /marker\.className = `maplibre-truck gps-only \$\{vehicle\.id === selectedVehicleId \? "selected" : ""\}`;/);
  assert.match(map, /selectedVehicleId = null,/);
  assert.doesNotMatch(css, /\.maplibre-truck\.gps-only \{ cursor: default;/);
});

test("page.tsx tracks the vehicle-only selection independently of the delivery selection, clearing whichever one isn't active", () => {
  assert.match(page, /const \[selectedVehicleId, setSelectedVehicleId\] = useState<string \| null>\(null\);/);
  assert.match(page, /const selectedVehicle = selectedVehicleId \? liveVehiclesWithNumbers\.find\(\(vehicle\) => vehicle\.id === selectedVehicleId\) \?\? null : null;/);
  assert.match(page, /onSelect=\{\(deliveryId\) => \{ setSelectedId\(deliveryId\); setSelectedVehicleId\(null\); setShowPopover\(true\); \}\}/);
  assert.match(page, /onSelectVehicle=\{\(vehicleId\) => \{ setSelectedVehicleId\(vehicleId\); setShowPopover\(true\); \}\}/);
});

test("the truck popover renders for a vehicle-only selection even when there are zero deliveries, and shows a lightweight no-delivery view", () => {
  assert.match(page, /\(selectedVehicle \|\| deliveries\.length > 0\) && <div className="truck-popover">/);
  assert.match(page, /\{selectedVehicle \? <>/);
  assert.match(page, /<small>\{locale === "fr" \? "Aucune livraison en cours" : locale === "nl" \? "Geen actieve levering" : "No active delivery"\}<\/small>/);
  assert.match(page, /<dt>\{locale === "fr" \? "Vitesse" : locale === "nl" \? "Snelheid" : "Speed"\}<\/dt><dd>\{selectedVehicle\.speed\} km\/h<\/dd>/);
});

test("the vehicle-only popover reuses the same rename-vehicle flow as the delivery popover, not a separate one", () => {
  assert.match(page, /renamingVehicleId && renamingVehicleId === selectedVehicle\.id/);
  assert.match(page, /onClick=\{\(\) => \{ setRenamingVehicleId\(selectedVehicle\.id\); setRenameDraft\(selectedVehicle\.name\); \}\}/);
});

test("the truck-badge icon is colored to match the truck's own badge color in both popover variants, instead of a fixed generic color", () => {
  assert.match(page, /<span className="truck-badge" style=\{selectedVehicle\.truckColor \? \{ background: selectedVehicle\.truckColor \} : undefined\}>▰<\/span>/);
  assert.match(page, /<span className="truck-badge" style=\{selected\.sendatrackVehicleId \? \{ background: truckBadgeColor\(vehicleTruckNumbers\.get\(selected\.sendatrackVehicleId\) \?\? null\) \} : undefined\}>▰<\/span>/);
});
