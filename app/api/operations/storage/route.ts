import { getCompanySession } from "../../../lib/company-auth";
import { getTelemetryGrowthReport } from "../../../lib/telemetry-growth";

export async function GET(request: Request) {
  const session = await getCompanySession(request);
  if (!session) {
    return Response.json(
      { error: "authentication_required" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const report = await getTelemetryGrowthReport(session.companyId);
    return Response.json(report, { headers: { "cache-control": "private, max-age=300" } });
  } catch (error) {
    console.error("[trackfleet:operations-storage] report failed", {
      message: error instanceof Error ? error.message : "unknown_error",
    });
    return Response.json(
      { error: "storage_report_unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
