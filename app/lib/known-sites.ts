export type KnownSite = {
  id: string;
  label: string;
  country: "BE" | "MA";
  address: string;
  latitude: number | null;
  longitude: number | null;
  arrivalRadiusKm: number;
};

// Verified operational addresses supplied by the business. Coordinates stay
// null until they are geocoded/confirmed precisely; the route engine keeps its
// existing city fallback in the meantime instead of pretending an approximate
// point is the real depot.
export const knownSites: KnownSite[] = [
  {
    id: "brussels-abattoir-45",
    label: "Bruxelles · Boulevard de l'Abattoir",
    country: "BE",
    address: "45 Boulevard de l'Abattoir, 1000 Bruxelles, Belgique",
    latitude: null,
    longitude: null,
    arrivalRadiusKm: 0.5,
  },
  {
    id: "casablanca-mohammed-vi-959",
    label: "Casablanca · Boulevard Mohammed VI",
    country: "MA",
    address: "959 Boulevard Mohammed VI, Casablanca, Maroc",
    latitude: null,
    longitude: null,
    arrivalRadiusKm: 0.5,
  },
];

export function knownSite(id: string | null | undefined) {
  if (!id) return null;
  return knownSites.find((site) => site.id === id) ?? null;
}
