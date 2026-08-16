import { getCompanySession } from "../../lib/company-auth";
import { knownSites } from "../../lib/known-sites";

export async function GET(request: Request) {
  const session = await getCompanySession(request);
  if (!session) {
    return Response.json({ error: "authentication_required" }, { status: 401, headers: { "cache-control": "no-store" } });
  }

  return Response.json({
    sites: knownSites.map((site) => ({
      id: site.id,
      label: site.label,
      address: site.address,
      country: site.country,
      latitude: site.latitude,
      longitude: site.longitude,
      arrivalRadiusKm: site.arrivalRadiusKm,
      geofenceReady: typeof site.latitude === "number" && typeof site.longitude === "number",
    })),
  }, { headers: { "cache-control": "no-store" } });
}
