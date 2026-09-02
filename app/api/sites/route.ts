import { getCompanySession } from "../../lib/company-auth";
import { invalidJsonResponse, readJsonObject } from "../../lib/request-json";
import { originRejectedResponse, requestIsSameOrigin } from "../../lib/request-origin";
import { siteStore } from "trackfleet-site-store";
import { agencyBrowserLocationIsAcceptable } from "../../lib/agency-access";

type SiteRole = "origin" | "dropoff" | "replenishment" | "destination";

const allowedRoles = new Set<SiteRole>(["origin", "dropoff", "replenishment", "destination"]);
const defaultRoles: SiteRole[] = ["origin", "dropoff", "replenishment", "destination"];

function slug(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70);
}

function siteJson(site: Awaited<ReturnType<typeof siteStore.listForCompany>>[number]) {
  return {
    id: site.id,
    label: site.label,
    city: site.city,
    address: site.address,
    country: site.country,
    roles: site.roles,
    latitude: site.latitude,
    longitude: site.longitude,
    arrivalRadiusKm: site.arrivalRadiusKm,
    whatsapp: site.whatsapp ?? null,
    geofenceReady: typeof site.latitude === "number" && typeof site.longitude === "number",
  };
}

export async function GET(request: Request) {
  const session = await getCompanySession(request);
  if (!session) return Response.json({ error: "authentication_required" }, { status: 401, headers: { "cache-control": "no-store" } });
  const companySites = await siteStore.listForCompany(session.companyId);
  return Response.json({ sites: companySites.map(siteJson) }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  if (!requestIsSameOrigin(request)) return originRejectedResponse();
  const session = await getCompanySession(request);
  if (!session) return Response.json({ error: "authentication_required" }, { status: 401, headers: { "cache-control": "no-store" } });

  const payload = await readJsonObject(request);
  if (!payload) return invalidJsonResponse();
  if (session.role === "agency") {
    const site = (await siteStore.listForCompany(session.companyId)).find((candidate) => candidate.id === session.siteId);
    const requestedId = String(payload.id ?? "").trim();
    const latitude = Number(payload.latitude);
    const longitude = Number(payload.longitude);
    const accuracyMeters = Number(payload.coordinateAccuracyMeters);
    if (!site || requestedId !== session.siteId) return Response.json({ error: "agency_site_mismatch" }, { status: 403 });
    if (payload.coordinateSource !== "browser" || !agencyBrowserLocationIsAcceptable({ latitude, longitude, accuracyMeters })) {
      return Response.json({ error: "browser_location_not_precise_enough" }, { status: 400 });
    }
    const updated = await siteStore.upsert({
      ...site,
      latitude,
      longitude,
    });
    return Response.json({ site: siteJson(updated) }, { status: 201, headers: { "cache-control": "no-store" } });
  }

  const label = String(payload.label ?? "").trim();
  const city = String(payload.city ?? "").trim();
  const address = String(payload.address ?? "").trim();
  const country = String(payload.country ?? "").trim().toUpperCase();
  const requestedId = String(payload.id ?? "").trim();
  const id = requestedId || slug(`${city}-${address}`);
  const roles: SiteRole[] = Array.isArray(payload.roles)
    ? [...new Set(payload.roles.map(String).filter((role): role is SiteRole => allowedRoles.has(role as SiteRole)))]
    : [...defaultRoles];
  const latitude = payload.latitude === null || payload.latitude === undefined || payload.latitude === "" ? null : Number(payload.latitude);
  const longitude = payload.longitude === null || payload.longitude === undefined || payload.longitude === "" ? null : Number(payload.longitude);
  const requestedRadius = Number(payload.arrivalRadiusKm ?? 0.5);
  const whatsappRaw = String(payload.whatsapp ?? "").trim();
  const whatsapp = whatsappRaw || null;

  if (!id || !label || !city || !address || (country !== "BE" && country !== "MA") || roles.length === 0) {
    return Response.json({ error: "id, label, city, address, country BE/MA and at least one role are required" }, { status: 400 });
  }
  if (id.length > 100 || label.length > 160 || city.length > 120 || address.length > 500) {
    return Response.json({ error: "site fields exceed allowed length" }, { status: 400 });
  }
  if (whatsapp && whatsapp.length > 40) {
    return Response.json({ error: "whatsapp number exceeds allowed length" }, { status: 400 });
  }
  if ((latitude === null) !== (longitude === null)) return Response.json({ error: "latitude and longitude must be provided together" }, { status: 400 });
  if (latitude !== null && (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude! < -180 || longitude! > 180)) {
    return Response.json({ error: "invalid coordinates" }, { status: 400 });
  }
  if (!Number.isFinite(requestedRadius)) return Response.json({ error: "invalid arrival radius" }, { status: 400 });

  const site = await siteStore.upsert({
    companyId: session.companyId,
    id,
    label,
    city,
    country: country as "BE" | "MA",
    address,
    latitude,
    longitude,
    arrivalRadiusKm: Math.max(0.05, Math.min(10, requestedRadius)),
    roles,
    whatsapp,
  });
  return Response.json({ site: siteJson(site) }, { status: 201, headers: { "cache-control": "no-store" } });
}
