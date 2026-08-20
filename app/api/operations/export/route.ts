import { store } from "trackfleet-delivery-store-full";
import { siteStore } from "trackfleet-site-store";
import { getDispatcherSession } from "../../../lib/company-auth";
import { buildTenantDataExport } from "../../../lib/tenant-data-export";

export async function GET(request: Request) {
  const session = await getDispatcherSession(request);
  if (!session) {
    return Response.json(
      { error: "authentication_required" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const deliveries = await store.listForCompany(session.companyId);
    const [sites, trips, eventsByDelivery] = await Promise.all([
      siteStore.listForCompany(session.companyId),
      store.listTrips(session.companyId, 1000),
      Promise.all(deliveries.map((delivery) => store.listEvents(delivery.id))),
    ]);
    const payload = buildTenantDataExport({
      companyId: session.companyId,
      deliveries,
      events: eventsByDelivery.flat(),
      trips,
      sites,
    });
    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="trackfleet-export-${stamp}.json"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    console.error("[trackfleet:operations-export] export failed", {
      message: error instanceof Error ? error.message : "unknown_error",
    });
    return Response.json(
      { error: "export_unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
