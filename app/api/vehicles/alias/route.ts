import { getCompanySession } from "../../../lib/company-auth";
import { invalidJsonResponse, readJsonObject } from "../../../lib/request-json";
import { originRejectedResponse, requestIsSameOrigin } from "../../../lib/request-origin";
import { vehicleAliasStore } from "trackfleet-vehicle-alias-store";

export async function GET(request: Request) {
  const session = await getCompanySession(request);
  if (!session) return Response.json({ error: "authentication_required" }, { status: 401, headers: { "cache-control": "no-store" } });
  const aliases = await vehicleAliasStore.listForCompany(session.companyId);
  return Response.json({
    aliases: aliases.map((row) => ({ sendatrackVehicleId: row.sendatrackVehicleId, alias: row.alias })),
  }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  if (!requestIsSameOrigin(request)) return originRejectedResponse();
  const session = await getCompanySession(request);
  if (!session) return Response.json({ error: "authentication_required" }, { status: 401, headers: { "cache-control": "no-store" } });
  if (session.role !== "dispatcher") return Response.json({ error: "dispatcher_confirmation_required" }, { status: 403, headers: { "cache-control": "no-store" } });

  const payload = await readJsonObject(request);
  if (!payload) return invalidJsonResponse();
  const sendatrackVehicleId = String(payload.sendatrackVehicleId ?? "").trim();
  const alias = String(payload.alias ?? "").trim();
  if (!sendatrackVehicleId || sendatrackVehicleId.length > 100) {
    return Response.json({ error: "invalid_sendatrack_vehicle_id" }, { status: 400, headers: { "cache-control": "no-store" } });
  }
  if (!alias || alias.length > 60) {
    return Response.json({ error: "alias must be 1 to 60 characters" }, { status: 400, headers: { "cache-control": "no-store" } });
  }

  const saved = await vehicleAliasStore.set({ companyId: session.companyId, sendatrackVehicleId, alias });
  return Response.json({
    alias: { sendatrackVehicleId: saved.sendatrackVehicleId, alias: saved.alias },
  }, { status: 201, headers: { "cache-control": "no-store" } });
}
