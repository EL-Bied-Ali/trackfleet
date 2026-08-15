"use client";

import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, LngLatLike } from "maplibre-gl";

type MapDelivery = {
  id: string;
  destination: string;
  truck: string;
  status: string;
  latitude?: number | null;
  longitude?: number | null;
  sendatrackVehicleId?: string;
};

type LiveVehicle = {
  id: string;
  name: string;
  speed: number;
  latitude: number;
  longitude: number;
};

type Props = {
  deliveries: MapDelivery[];
  liveVehicles?: LiveVehicle[];
  selectedId: string;
  customerMode?: boolean;
  label: string;
  onSelect?: (deliveryId: string) => void;
};

const corridor: Array<[number, number]> = [
  [4.3517, 50.8503],
  [2.3522, 48.8566],
  [-0.5792, 44.8378],
  [-3.7038, 40.4168],
  [-5.453, 36.1408],
  [-5.8128, 35.7673],
  [-6.8498, 33.9716],
  [-7.5898, 33.5731],
];

const vehiclePositions: Record<string, [number, number]> = {
  "TF-2841": [-5.55, 35.92],
  "TF-2839": [-3.7, 40.42],
  "TF-2837": [-0.58, 44.84],
  "TF-2835": [-7.59, 33.57],
  "TF-2832": [4.35, 50.85],
};

function positionFor(delivery: MapDelivery, index: number): [number, number] {
  if (typeof delivery.latitude === "number" && typeof delivery.longitude === "number") return [delivery.longitude, delivery.latitude];
  return vehiclePositions[delivery.id] ?? corridor[Math.min(index + 1, corridor.length - 1)];
}

function destinationFor(delivery: MapDelivery): [number, number] {
  if (delivery.destination.includes("Casablanca")) return [-7.5898, 33.5731];
  if (delivery.destination.includes("Tangier")) return [-5.8128, 35.7673];
  if (delivery.destination.includes("Antwerp")) return [4.4025, 51.2194];
  if (delivery.destination.includes("Liège")) return [5.5797, 50.6326];
  return [4.3517, 50.8503];
}

export default function InteractiveFleetMap({ deliveries, liveVehicles = [], selectedId, customerMode = false, label, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onSelectRef = useRef(onSelect);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    if (!containerRef.current) return;
    const selected = deliveries.find((delivery) => delivery.id === selectedId) ?? deliveries[0];
    const routeCoordinates = selected?.destination.endsWith(", BE") ? [...corridor].reverse() : corridor;
    const map = new maplibregl.Map({
      container: containerRef.current,
      center: [-1.6, 42.6] as LngLatLike,
      zoom: customerMode ? 3.2 : 3.1,
      minZoom: 2.2,
      maxZoom: 15,
      attributionControl: { compact: true },
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors",
          },
        },
        layers: [{ id: "osm", type: "raster", source: "osm" }],
      },
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => {
      map.addSource("corridor", {
        type: "geojson",
        data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: routeCoordinates } },
      });
      map.addLayer({ id: "corridor-casing", type: "line", source: "corridor", paint: { "line-color": "#ffffff", "line-width": 7, "line-opacity": 0.9 } });
      map.addLayer({ id: "corridor-line", type: "line", source: "corridor", paint: { "line-color": "#26755b", "line-width": 4, "line-dasharray": [2, 1] } });
      map.addSource("ferry", {
        type: "geojson",
        data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [corridor[4], corridor[5]] } },
      });
      map.addLayer({ id: "ferry-line", type: "line", source: "ferry", paint: { "line-color": "#268f9b", "line-width": 5, "line-dasharray": [1, 1] } });
      (map.getSource("corridor") as GeoJSONSource)?.setData({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: routeCoordinates } });
      map.fitBounds([[-8.5, 32.7], [6.0, 51.8]], { padding: customerMode ? 42 : 34, duration: 0 });
    });

    const shownDeliveries = customerMode ? deliveries.filter((delivery) => delivery.id === selectedId) : deliveries.slice(0, 5);
    const markers = shownDeliveries.map((delivery, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `maplibre-truck ${delivery.id === selectedId ? "selected" : ""}`;
      button.setAttribute("aria-label", `${delivery.truck} · ${delivery.destination}`);
      button.innerHTML = `<span>▰</span><b>${delivery.truck.replace("TRK-0", "")}</b>`;
      button.addEventListener("click", () => onSelectRef.current?.(delivery.id));
      return new maplibregl.Marker({ element: button, anchor: "bottom" }).setLngLat(positionFor(delivery, index)).addTo(map);
    });

    if (!customerMode) {
      const linkedVehicleIds = new Set(deliveries.flatMap((delivery) => {
        if (delivery.sendatrackVehicleId) return [delivery.sendatrackVehicleId];
        const matching = liveVehicles.find((vehicle) => vehicle.name === delivery.truck);
        return matching ? [matching.id] : [];
      }));
      for (const vehicle of liveVehicles) {
        if (linkedVehicleIds.has(vehicle.id)) continue;
        const marker = document.createElement("div");
        marker.className = "maplibre-truck gps-only";
        marker.setAttribute("role", "img");
        marker.setAttribute("aria-label", `${vehicle.name} · ${vehicle.speed} km/h`);
        marker.innerHTML = `<span>▰</span><b>GPS</b><em>${vehicle.name}</em>`;
        markers.push(new maplibregl.Marker({ element: marker, anchor: "bottom" }).setLngLat([vehicle.longitude, vehicle.latitude]).addTo(map));
      }
    }

    let destinationMarker: maplibregl.Marker | undefined;
    if (customerMode && selected) {
      const pin = document.createElement("div");
      pin.className = "maplibre-destination";
      pin.innerHTML = "◆";
      pin.setAttribute("aria-label", selected.destination);
      destinationMarker = new maplibregl.Marker({ element: pin, anchor: "bottom" }).setLngLat(destinationFor(selected)).addTo(map);
    }

    return () => {
      markers.forEach((marker) => marker.remove());
      destinationMarker?.remove();
      map.remove();
    };
  }, [customerMode, deliveries, liveVehicles, selectedId]);

  return <div ref={containerRef} className="interactive-map-canvas" role="application" aria-label={label} />;
}
