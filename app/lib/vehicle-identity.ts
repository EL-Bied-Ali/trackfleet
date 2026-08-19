export function normalizePhysicalVehicleName(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function providerIdentity(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9._:-]+/g, "");
}

export function hasPhysicalVehicleName(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^v\d+$/i.test(trimmed)) return false;
  if (/^fmb\d+$/i.test(trimmed)) return false;
  return normalizePhysicalVehicleName(trimmed).length >= 3;
}

export function canonicalFleetVehicleId(vehicleName: string, providerId = "") {
  if (hasPhysicalVehicleName(vehicleName)) {
    return `physical:${normalizePhysicalVehicleName(vehicleName)}`;
  }
  const fallback = providerIdentity(providerId);
  return fallback ? `provider:${fallback}` : "provider:unknown";
}

export function samePhysicalVehicle(left: string, right: string) {
  if (!hasPhysicalVehicleName(left) || !hasPhysicalVehicleName(right)) return false;
  return normalizePhysicalVehicleName(left) === normalizePhysicalVehicleName(right);
}
