"use client";

import { useEffect, useRef, useState } from "react";
import type { GeoJSONSource, LngLatLike, Map as MapLibreMap, Marker as MapLibreMarker } from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { belgiumMoroccoCorridor as corridor, destinationPointFor, routeForDestination } from "./lib/route-progress";

type MapLibreModule = typeof import("maplibre-gl");

type MapDelivery = {
  id: string;
  originLatitude?: number | null;
  originLongitude?: number | null;
  destination: string;
  destinationLatitude?: number | null;
  destinationLongitude?: number | null;
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

function hasExactPosition(delivery: MapDelivery) {
  return typeof delivery.latitude === "number" && typeof delivery.longitude === "number";
}

function exactDestination(delivery: MapDelivery): [number, number] | null {
  return typeof delivery.destinationLatitude === "number" && typeof delivery.destinationLongitude === "number"
    ? [delivery.destinationLongitude, delivery.destinationLatitude]
    : null;
}
function exactOrigin(delivery: MapDelivery): [number, number] | null {
  return typeof delivery.originLatitude === "number" && typeof delivery.originLongitude === "number"
    ? [delivery.originLongitude, delivery.originLatitude]
    : null;
}

function keepMarkerMapPositioning(element: HTMLElement) {
  element.style.position = "absolute";
}

function compactVehicleLabel(name: string) {
  const normalized = name.trim();
  if (!normalized) return "Vehicle";
  return normalized.length > 14 ? `${normalized.slice(0, 12)}…` : normalized;
}

function overlapOffset(position: [number, number], occurrences: Map<string, number>): [number, number] {
  const key = `${position[0].toFixed(5)}:${position[1].toFixed(5)}`;
  const index = occurrences.get(key) ?? 0;
  occurrences.set(key, index + 1);
  if (index === 0) return [0, 0];
  const ringIndex = index - 1;
  const angle = (ringIndex % 8) * (Math.PI / 4);
  const radius = 30 + Math.floor(ringIndex / 8) * 24;
  return [Math.round(Math.cos(angle) * radius), Math.round(Math.sin(angle) * radius)];
}

export default function InteractiveFleetMap({ deliveries, liveVehicles = [], selectedId, customerMode = false, label, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onSelectRef = useRef(onSelect);
  const maplibreRef = useRef<MapLibreModule | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<MapLibreMarker[]>([]);
  const destinationMarkerRef = useRef<MapLibreMarker | null>(null);
  const [mapRevision, setMapRevision] = useState(0);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    let disposed = false;
    let map: MapLibreMap | null = null;

    void (async () => {
      const maplibregl = await import("maplibre-gl");
      if (disposed || !containerRef.current) return;

      maplibreRef.current = maplibregl;
      maplibregl.setWorkerUrl(maplibreWorkerUrl);
      map = new maplibregl.Map({
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
      mapRef.current = map;

      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      map.on("load", () => {
        if (disposed || !map) return;
        map.addSource("corridor", {
          type: "geojson",
          data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: corridor } },
        });
        map.addLayer({ id: "corridor-casing", type: "line", source: "corridor", paint: { "line-color": "#ffffff", "line-width": 7, "line-opacity": 0.9 } });
        map.addLayer({ id: "corridor-line", type: "line", source: "corridor", paint: { "line-color": "#26755b", "line-width": 4, "line-dasharray": [2, 1] } });
        map.addSource("ferry", {
          type: "geojson",
          data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [corridor[4], corridor[5]] } },
        });
        map.addLayer({ id: "ferry-line", type: "line", source: "ferry", paint: { "line-color": "#268f9b", "line-width": 5, "line-dasharray": [1, 1] } });
        map.fitBounds([[-10.5, 29.5], [6.0, 51.8]], { padding: customerMode ? 42 : 34, duration: 0 });
        setMapRevision((revision) => revision + 1);
      });
    })();

    return () => {
      disposed = true;
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      destinationMarkerRef.current?.remove();
      destinationMarkerRef.current = null;
      mapRef.current = null;
      maplibreRef.current = null;
      map?.remove();
    };
  }, [customerMode]);

  useEffect(() => {
    const map = mapRef.current;
    const maplibregl = maplibreRef.current;
    if (!map || !maplibregl) return;
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];
    destinationMarkerRef.current?.remove();
    destinationMarkerRef.current = null;

    const selected = deliveries.find((delivery) => delivery.id === selectedId) ?? deliveries[0];
    const routeCoordinates = selected ? routeForDestination(selected.destination, exactDestination(selected), exactOrigin(selected)) : corridor;
    const corridorSource = map.getSource("corridor") as GeoJSONSource | undefined;
    corridorSource?.setData({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: routeCoordinates } });

    // Never invent a truck position on the customer view. Until real GPS is
    // available the route and destination remain visible without a fake marker.
    const shownDeliveries = customerMode
      ? deliveries.filter((delivery) => delivery.id === selectedId && hasExactPosition(delivery))
      : deliveries;
    const markerOccurrences = new Map<string, number>();
    const markers = shownDeliveries.map((delivery, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `maplibre-truck ${delivery.id === selectedId ? "selected" : ""}`;
      keepMarkerMapPositioning(button);
      button.setAttribute("aria-label", `${delivery.truck} · ${delivery.destination}`);
      button.innerHTML = `<span aria-hidden="true">▰</span><em>${compactVehicleLabel(delivery.truck)}</em>`;
      button.addEventListener("click", () => onSelectRef.current?.(delivery.id));
      const position = positionFor(delivery, index);
      return new maplibregl.Marker({ element: button, anchor: "bottom", offset: overlapOffset(position, markerOccurrences) }).setLngLat(position).addTo(map);
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
        keepMarkerMapPositioning(marker);
        marker.setAttribute("role", "img");
        marker.setAttribute("aria-label", `${vehicle.name} · ${vehicle.speed} km/h`);
        marker.innerHTML = `<span aria-hidden="true">▰</span><em>${compactVehicleLabel(vehicle.name)}</em>`;
        const position: [number, number] = [vehicle.longitude, vehicle.latitude];
        markers.push(new maplibregl.Marker({ element: marker, anchor: "bottom", offset: overlapOffset(position, markerOccurrences) }).setLngLat(position).addTo(map));
      }
    }

    if (customerMode && selected) {
      const pin = document.createElement("div");
      pin.className = "maplibre-destination";
      keepMarkerMapPositioning(pin);
      pin.innerHTML = "◆";
      pin.setAttribute("aria-label", selected.destination);
      destinationMarkerRef.current = new maplibregl.Marker({ element: pin, anchor: "bottom" })
        .setLngLat(destinationPointFor(selected.destination, exactDestination(selected)))
        .addTo(map);
    }
    markersRef.current = markers;
  }, [customerMode, deliveries, liveVehicles, mapRevision, selectedId]);

  return <div ref={containerRef} className="interactive-map-canvas" role="application" aria-label={label} />;
}
