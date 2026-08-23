export const MAX_BULK_DELIVERY_ROWS = 100;
const UNASSIGNED_TRUCK = "__unassigned__";

export type BulkDeliveryDraft = {
  rowNumber: number;
  customer: string;
  destination: string;
  originSiteId: string;
  destinationSiteId: string;
  plannedArrivalAt: string | null;
  nextTruckDepartureAt: string | null;
  contact: string;
  recipientName: string;
  recipientContact: string;
  truck: string;
  sendatrackVehicleId: string;
  whatsappOptIn: boolean;
  weightKg: number | null;
};

export type BulkDeliveryImportResult = {
  rows: BulkDeliveryDraft[];
  errors: string[];
};

const acceptedHeaders = new Set([
  "customer",
  "destination",
  "origin_site_id",
  "destination_site_id",
  "planned_arrival_at",
  "next_truck_departure_at",
  "contact",
  "recipient_name",
  "recipient_contact",
  "truck",
  "sendatrack_vehicle_id",
  "whatsapp_opt_in",
  "weight_kg",
]);

function parseCsvRows(input: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];
    if (char === '"') {
      if (quoted && next === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell.trim());
      cell = "";
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      continue;
    }
    cell += char;
  }
  if (quoted) throw new Error("Unclosed quoted CSV field");
  row.push(cell.trim());
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
}

function boolValue(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  if (["1", "true", "yes", "oui", "ja"].includes(normalized)) return true;
  if (["0", "false", "no", "non", "nee"].includes(normalized)) return false;
  return null;
}

function normalizedIsoDate(value: string) {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

export function parseBulkDeliveryCsv(input: string): BulkDeliveryImportResult {
  const errors: string[] = [];
  let parsed: string[][];
  try {
    parsed = parseCsvRows(input.replace(/^\uFEFF/, ""));
  } catch (error) {
    return { rows: [], errors: [error instanceof Error ? error.message : "Invalid CSV"] };
  }
  if (parsed.length < 2) return { rows: [], errors: ["CSV must contain a header and at least one delivery row"] };

  const headers = parsed[0].map((header) => header.trim().toLowerCase());
  const duplicateHeaders = headers.filter((header, index) => headers.indexOf(header) !== index);
  if (duplicateHeaders.length) errors.push(`Duplicate CSV header: ${duplicateHeaders[0]}`);
  for (const header of headers) {
    if (!acceptedHeaders.has(header)) errors.push(`Unsupported CSV header: ${header}`);
  }
  // planned_arrival_at/next_truck_departure_at are accepted columns but not
  // required ones -- like the single-delivery creation form, a dispatcher
  // doesn't need to know either date up front; both are editable afterward
  // from the delivery table (per parcel, or once per truck group when
  // several parcels share a destination).
  for (const required of ["customer", "destination", "origin_site_id"]) {
    if (!headers.includes(required)) errors.push(`Missing required CSV header: ${required}`);
  }
  if (errors.length) return { rows: [], errors };

  const dataRows = parsed.slice(1);
  if (dataRows.length > MAX_BULK_DELIVERY_ROWS) {
    return { rows: [], errors: [`CSV contains ${dataRows.length} rows; maximum is ${MAX_BULK_DELIVERY_ROWS}`] };
  }

  const indexOf = (name: string) => headers.indexOf(name);
  const get = (values: string[], name: string) => {
    const index = indexOf(name);
    return index < 0 ? "" : String(values[index] ?? "").trim();
  };

  const rows: BulkDeliveryDraft[] = [];
  for (let index = 0; index < dataRows.length; index += 1) {
    const values = dataRows[index];
    const rowNumber = index + 2;
    if (values.length > headers.length && values.slice(headers.length).some(Boolean)) {
      errors.push(`Row ${rowNumber}: too many columns`);
      continue;
    }
    const customer = get(values, "customer");
    const destination = get(values, "destination");
    const originSiteId = get(values, "origin_site_id");
    const truck = get(values, "truck");
    const planned = get(values, "planned_arrival_at");
    const plannedArrivalAt = planned ? normalizedIsoDate(planned) : null;
    const nextDeparture = get(values, "next_truck_departure_at");
    const nextTruckDepartureAt = nextDeparture ? normalizedIsoDate(nextDeparture) : null;
    const whatsappRaw = get(values, "whatsapp_opt_in");
    const recipientName = get(values, "recipient_name");
    const recipientContact = get(values, "recipient_contact");
    const whatsappOptIn = boolValue(whatsappRaw);
    const weightRaw = get(values, "weight_kg");
    const weightKg = weightRaw ? Number(weightRaw) : null;

    if (!customer) errors.push(`Row ${rowNumber}: customer is required`);
    if (!destination) errors.push(`Row ${rowNumber}: destination is required`);
    // Required so price (1.5 EUR/kg, or 15 MAD/kg from Morocco -- see
    // delivery-pricing.ts) is computed from the real origin instead of
    // silently defaulting to EUR for a blank/unresolved origin.
    if (!originSiteId) errors.push(`Row ${rowNumber}: origin_site_id is required`);
    if (planned && !plannedArrivalAt) errors.push(`Row ${rowNumber}: planned_arrival_at is invalid`);
    if (nextDeparture && !nextTruckDepartureAt) errors.push(`Row ${rowNumber}: next_truck_departure_at is invalid`);
    if (whatsappOptIn === null) errors.push(`Row ${rowNumber}: whatsapp_opt_in must be true/false, yes/no, oui/non or 1/0`);
    if (Boolean(recipientName) !== Boolean(recipientContact)) errors.push(`Row ${rowNumber}: recipient_name and recipient_contact must be supplied together`);
    if (weightRaw && (!Number.isFinite(weightKg) || weightKg! <= 0 || weightKg! > 100000)) errors.push(`Row ${rowNumber}: weight_kg must be greater than 0 and at most 100000`);
    if (!customer || !destination || !originSiteId || (planned && !plannedArrivalAt) || (nextDeparture && !nextTruckDepartureAt) || whatsappOptIn === null || Boolean(recipientName) !== Boolean(recipientContact) || (weightRaw && (!Number.isFinite(weightKg) || weightKg! <= 0 || weightKg! > 100000))) continue;

    rows.push({
      rowNumber,
      customer,
      destination,
      originSiteId,
      destinationSiteId: get(values, "destination_site_id"),
      plannedArrivalAt,
      nextTruckDepartureAt,
      contact: get(values, "contact"),
      recipientName,
      recipientContact,
      truck: truck || UNASSIGNED_TRUCK,
      sendatrackVehicleId: get(values, "sendatrack_vehicle_id"),
      whatsappOptIn,
      weightKg: weightKg === null ? null : Math.round(weightKg * 1000) / 1000,
    });
  }
  return { rows, errors };
}

export const BULK_DELIVERY_CSV_TEMPLATE = [
  "customer,destination,planned_arrival_at,next_truck_departure_at,truck,contact,recipient_name,recipient_contact,whatsapp_opt_in,weight_kg,origin_site_id,destination_site_id,sendatrack_vehicle_id",
  'Client Exemple,"Casablanca, Maroc",2026-08-20T14:00:00+02:00,2026-08-19T09:00:00+02:00,TRUCK-01,+212600000000,Destinataire Exemple,+212611111111,false,12.5,brussels-abattoir-45,,',
].join("\n");
