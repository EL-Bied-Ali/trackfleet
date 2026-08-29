import { vehicleAliasStore } from "trackfleet-vehicle-alias-store";
import type { SendatrackSnapshot } from "./sendatrack.ts";

// The dispatcher's chosen alias for a vehicle (vehicle-alias-store.ts,
// /api/vehicles/alias) was previously applied only where the live vehicle
// picker list gets built (app/api/deliveries/route.ts's integration.vehicles).
// The moment a vehicle actually gets used -- linked to a delivery, matched
// automatically by applySendatrackSnapshot, or logged to fleet position
// history -- every one of those call sites read the raw snapshot straight
// from SENDATRACK, so a renamed truck reverted to its real fleet id in the
// delivery table, WhatsApp messages, and position history the instant it
// stopped being merely "in the picker". Applying the alias once, right after
// the snapshot is fetched, means every downstream consumer of that snapshot
// object gets the aliased name for free -- no per-call-site lookup to forget.
export async function applyVehicleAliases(snapshot: SendatrackSnapshot, companyId: string): Promise<SendatrackSnapshot> {
  if (!snapshot.connected || !snapshot.vehicles.length) return snapshot;
  const aliases = await vehicleAliasStore.listForCompany(companyId);
  if (!aliases.length) return snapshot;
  const aliasById = new Map(aliases.map((item) => [item.sendatrackVehicleId, item.alias]));
  return {
    ...snapshot,
    vehicles: snapshot.vehicles.map((vehicle) => {
      const alias = aliasById.get(vehicle.id);
      return alias ? { ...vehicle, name: alias } : vehicle;
    }),
  };
}
