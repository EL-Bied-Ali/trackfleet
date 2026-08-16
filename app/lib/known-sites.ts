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
    roles: ["dropoff", "replenishment", "destination"],
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
    roles: ["dropoff", "replenishment", "destination"],
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
    roles: ["dropoff", "replenishment", "destination"],
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
    roles: ["dropoff", "replenishment", "destination"],
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
    roles: ["dropoff", "replenishment", "destination"],
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
    roles: ["dropoff", "replenishment", "destination"],
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
    roles: ["dropoff", "replenishment", "destination"],
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
    roles: ["dropoff", "replenishment", "destination"],
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
    roles: ["dropoff", "replenishment", "destination"],
  },
];

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
