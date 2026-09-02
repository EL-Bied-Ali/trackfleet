export type KnownSite = {
  id: string;
  label: string;
  city: string;
  country: "BE" | "MA";
  address: string;
  latitude: number | null;
  longitude: number | null;
  arrivalRadiusKm: number;
  roles: Array<"origin" | "dropoff" | "replenishment" | "destination">;
  // The agency's own contact number, in the same free-text format a
  // dispatcher would dial/message it (not necessarily E.164) -- unset for
  // most existing entries until backfilled. Distinct from a delivery's own
  // customer/recipient contact fields (see delivery-store.types.ts).
  whatsapp?: string | null;
  // Matches the physical color-coded paper ticket bins the client already
  // uses at the depot (a photo of the shelf was the source for the initial
  // values below) -- a hex string, editable per site in SiteManager. Unset
  // for a site means "no assigned color yet"; callers fall back to a shared
  // default (matching the physical bin's own catch-all "villes transfert"
  // color) rather than inventing a per-site color from scratch.
  color?: string | null;
  // True for regional destinations reached by a local/relay leg beyond one of
  // the two confirmed hub stops (Casablanca or the Tanger Med ferry
  // crossing -- see relayHubSiteId) that our GPS-tracked trucks never
  // physically visit -- confirmed from real fleet GPS history: those two
  // are the only sites with a sustained position cluster, everything else
  // Moroccan sees zero GPS presence. Live GPS pace, delay detection and ETA
  // confidence are meaningless for that leg, so callers must show an
  // explicit "not GPS-tracked" / relay-carrier note instead of a
  // possibly-stale or fabricated live estimate. See
  // app/lib/eta-display.ts (customerEtaNote) and app/lib/delay-detection.ts.
  finalLegTrackingUnavailable?: boolean;
  // The known site id where GPS coverage effectively ends for a
  // finalLegTrackingUnavailable destination -- the truck relay/handoff point.
  // Used to measure the manual-arrival duration estimate from "last seen at
  // the relay" rather than from the whole door-to-door journey, since the
  // relay-to-destination leg is the actually-unknown part (the leg up to the
  // relay already has a real GPS-based ETA). See manual-arrival-duration.postgres.ts.
  relayHubSiteId?: string;
};

// Operational addresses supplied by the business. Coordinates stay null until
// each exact map pin / truck entrance is geocoded and confirmed. Keeping the
// address and site identity separate from coordinates lets TrackFleet model the
// stop network now without pretending that a city-centre fallback is the depot.
export const knownSites: KnownSite[] = [
  {
    id: "brussels-abattoir-45",
    label: "Bruxelles · Boulevard de l'Abattoir",
    city: "Bruxelles",
    country: "BE",
    address: "45 Boulevard de l'Abattoir, 1000 Bruxelles, Belgique",
    latitude: null,
    longitude: null,
    arrivalRadiusKm: 0.5,
    roles: ["origin", "destination"],
  },
  {
    id: "tanger-med-ksar-al-majaz",
    label: "Port Tanger Med · Ksar Al Majaz",
    city: "Tanger Med",
    country: "MA",
    address: "Oued Ghlala, Ksar Al Majaz, 93000 Tanger Med, Maroc",
    latitude: null,
    longitude: null,
    arrivalRadiusKm: 0.5,
    roles: ["origin", "dropoff", "replenishment", "destination"],
    whatsapp: "+212 7 00 06 18 40",
    color: "#2563eb",
  },
  {
    id: "tanger-ville-said-kotb-19a",
    label: "Tanger Ville · Boulevard Said Kotb",
    city: "Tanger",
    country: "MA",
    address: "N°19 A Résidence Jouba, Boulevard Said Kotb, Tanger, Maroc",
    latitude: null,
    longitude: null,
    arrivalRadiusKm: 0.5,
    roles: ["origin", "dropoff", "replenishment", "destination"],
    finalLegTrackingUnavailable: true,
    relayHubSiteId: "tanger-med-ksar-al-majaz",
    whatsapp: "+212 6 62 12 02 59",
    color: "#2563eb",
  },
  {
    id: "tetouan-cortoba-146",
    label: "Tétouan · Avenue Cortoba",
    city: "Tétouan",
    country: "MA",
    address: "146 Avenue Cortoba, 93000 Tétouan, Maroc",
    latitude: null,
    longitude: null,
    arrivalRadiusKm: 0.5,
    roles: ["origin", "dropoff", "replenishment", "destination"],
    finalLegTrackingUnavailable: true,
    relayHubSiteId: "tanger-med-ksar-al-majaz",
    whatsapp: "+212 6 68 37 77 51",
  },
  {
    id: "sale-hay-nasser-12bis",
    label: "Salé · Hay Nasser",
    city: "Salé",
    country: "MA",
    address: "12 Bis, Hay Nasser rue N°1, Route de Kénitra, sortie Akkari, Salé, Maroc",
    latitude: null,
    longitude: null,
    arrivalRadiusKm: 0.5,
    roles: ["origin", "dropoff", "replenishment", "destination"],
    finalLegTrackingUnavailable: true,
    relayHubSiteId: "casablanca-mohammed-vi-959",
    whatsapp: "+212 6 66 73 82 20",
    color: "#f97316",
  },
  {
    id: "marrakech-essaouira-12",
    label: "Marrakech · Boulevard Essaouira",
    city: "Marrakech",
    country: "MA",
    address: "12 Boulevard Essaouira, Douar el Asker, Derb el Makina, Marrakech, Maroc",
    latitude: null,
    longitude: null,
    arrivalRadiusKm: 0.5,
    roles: ["origin", "dropoff", "replenishment", "destination"],
    finalLegTrackingUnavailable: true,
    relayHubSiteId: "casablanca-mohammed-vi-959",
    whatsapp: "+212 6 62 12 14 48",
    color: "#dc2626",
  },
  {
    id: "agadir-zaitoune-tikiouine-103a",
    label: "Agadir · Zaitoune Tikiouine",
    city: "Agadir",
    country: "MA",
    address: "Lot 103/A Zaitoune Tikiouine, Agadir, Maroc",
    latitude: null,
    longitude: null,
    arrivalRadiusKm: 0.5,
    roles: ["origin", "dropoff", "replenishment", "destination"],
    finalLegTrackingUnavailable: true,
    relayHubSiteId: "casablanca-mohammed-vi-959",
    whatsapp: "+212 6 66 57 22 66",
    color: "#166534",
  },
  {
    id: "khouribga-mohamed-vi-30",
    label: "Khouribga · Boulevard Mohamed VI",
    city: "Khouribga",
    country: "MA",
    address: "30 Boulevard Mohamed VI, ex Zallaka, Khouribga, Maroc",
    latitude: null,
    longitude: null,
    arrivalRadiusKm: 0.5,
    roles: ["origin", "dropoff", "replenishment", "destination"],
    finalLegTrackingUnavailable: true,
    relayHubSiteId: "casablanca-mohammed-vi-959",
    whatsapp: "+212 6 62 12 50 03",
  },
  {
    id: "fquih-ben-salah-allal-ben-abdellah-197",
    label: "Fquih Ben Salah · Avenue Allal Ben Abdellah",
    city: "Fquih Ben Salah",
    country: "MA",
    address: "197 Avenue Allal Ben Abdellah, Fquih Ben Salah, Maroc",
    latitude: null,
    longitude: null,
    arrivalRadiusKm: 0.5,
    roles: ["origin", "dropoff", "replenishment", "destination"],
    finalLegTrackingUnavailable: true,
    relayHubSiteId: "casablanca-mohammed-vi-959",
    whatsapp: "+212 6 62 12 52 09",
  },
  {
    id: "casablanca-mohammed-vi-959",
    label: "Casablanca · Boulevard Mohammed VI",
    city: "Casablanca",
    country: "MA",
    address: "959 Boulevard Mohammed VI, ex Route Médiouna, Casablanca, Maroc",
    latitude: null,
    longitude: null,
    arrivalRadiusKm: 0.5,
    roles: ["origin", "dropoff", "replenishment", "destination"],
    whatsapp: "+212 6 62 72 53 29",
    // The physical bin is labeled "blanc" (white) -- a literal white swatch
    // would be invisible against this app's light UI, so a light neutral
    // gray with a visible border stands in for it (see the color picker's
    // own border, which every swatch gets regardless of its own color).
    color: "#e2e8f0",
  },
];

// No explicit color assigned yet (e.g. a newly-added "Autre" agency, or
// Kenitra/Rabat before their real details are on file) -- matches the
// physical bin's own catch-all "villes transfert" (mauve) color rather
// than inventing a per-site color from scratch.
export const defaultSiteColor = "#a855f7";

function normalizeSiteText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function knownSite(id: string | null | undefined) {
  if (!id) return null;
  return knownSites.find((site) => site.id === id) ?? null;
}

export function resolveKnownSite(value: string | null | undefined) {
  if (!value) return null;
  const byId = knownSite(value);
  if (byId) return byId;
  const normalized = normalizeSiteText(value);
  return knownSites.find((site) =>
    normalizeSiteText(site.address) === normalized
    || normalizeSiteText(site.label) === normalized
    || normalizeSiteText(site.city) === normalized
  ) ?? null;
}
