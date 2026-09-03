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
  // Prefix for this site's printed-label short code when it's the
  // destination (e.g. "CAS" -> "CAS 00", "CAS 01", ...), editable per site
  // in SiteManager. Unlike color, there's no shared fallback -- an
  // unrequested, fabricated prefix for a site the client never gave one
  // risks conflicting with a prefix they pick later, so a delivery to a
  // site with no prefix set simply gets no short code at all
  // (assignShortCode is only called when one exists). The prefixes below
  // for every site except the newest ones were explicitly requested live
  // ("tu peux les inventer c pg") rather than guessed silently.
  shortCodePrefix?: string | null;
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
    shortCodePrefix: "BXL",
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
    shortCodePrefix: "PORT_TAN",
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
    shortCodePrefix: "TAN",
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
    shortCodePrefix: "TET",
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
    shortCodePrefix: "SALE",
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
    shortCodePrefix: "MARR",
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
    shortCodePrefix: "AGA",
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
    shortCodePrefix: "KHO",
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
    shortCodePrefix: "FBS",
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
    shortCodePrefix: "CAS",
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

const combiningDiacriticsPattern = new RegExp("[\\u0300-\\u036f]", "g");

function alphaWords(value: string): string[] {
  return value
    .normalize("NFD")
    .replace(combiningDiacriticsPattern, "")
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter(Boolean);
}

// A best-effort, deterministic prefix guess for a brand-new agency (e.g. one
// a dispatcher adds inline via "Autre" at delivery creation) -- derived from
// the city's own name, not fabricated arbitrarily, and checked against every
// prefix already in use so it can never silently collide with one the client
// picks later. Multi-word cities (e.g. "Fquih Ben Salah") try initials
// first, matching the pattern already used for the client's own real
// entries; everything else tries increasingly long prefixes of the first
// word. Returns null (no suggestion, dispatcher can set one manually later
// via SiteManager) rather than looping forever if every candidate collides.
export function suggestShortCodePrefix(city: string, existingPrefixes: Iterable<string | null | undefined>): string | null {
  const words = alphaWords(city);
  if (words.length === 0) return null;
  const taken = new Set(
    Array.from(existingPrefixes)
      .filter((prefix): prefix is string => Boolean(prefix))
      .map((prefix) => prefix.toUpperCase())
  );
  const candidates: string[] = [];
  if (words.length > 1) candidates.push(words.map((word) => word[0]).join(""));
  const base = words[0];
  for (let length = 3; length <= Math.min(6, base.length); length++) candidates.push(base.slice(0, length));
  for (const candidate of candidates) {
    if (candidate.length >= 2 && !taken.has(candidate)) return candidate;
  }
  return null;
}
