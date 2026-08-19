export const MAX_BULK_DELIVERY_ROWS = 100;

export type BulkDeliveryDraft = {
  rowNumber: number;
  customer: string;
  destination: string;
  originSiteId: string;
  destinationSiteId: string;
  plannedArrivalAt: string;
  contact: string;
  truck: string;
  sendatrackVehicleId: string;
  whatsappOptIn: boolean;
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
  "contact",
  "truck",
  "sendatrack_vehicle_id",
  "whatsapp_opt_in",
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
  for (const required of ["customer", "destination", "planned_arrival_at", "truck"]) {
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
    const truck = get(values, "truck");
    const planned = get(values, "planned_arrival_at");
    const plannedArrivalAt = normalizedIsoDate(planned);
    const whatsappRaw = get(values, "whatsapp_opt_in");
    const whatsappOptIn = boolValue(whatsappRaw);

    if (!customer) errors.push(`Row ${rowNumber}: customer is required`);
    if (!destination) errors.push(`Row ${rowNumber}: destination is required`);
    if (!truck) errors.push(`Row ${rowNumber}: truck is required`);
    if (!plannedArrivalAt) errors.push(`Row ${rowNumber}: planned_arrival_at is invalid`);
    if (whatsappOptIn === null) errors.push(`Row ${rowNumber}: whatsapp_opt_in must be true/false, yes/no, oui/non or 1/0`);
    if (!customer || !destination || !truck || !plannedArrivalAt || whatsappOptIn === null) continue;

    rows.push({
      rowNumber,
      customer,
      destination,
      originSiteId: get(values, "origin_site_id"),
      destinationSiteId: get(values, "destination_site_id"),
      plannedArrivalAt,
      contact: get(values, "contact"),
      truck,
      sendatrackVehicleId: get(values, "sendatrack_vehicle_id"),
      whatsappOptIn,
    });
  }
  return { rows, errors };
}

export const BULK_DELIVERY_CSV_TEMPLATE = [
  "customer,destination,planned_arrival_at,truck,contact,whatsapp_opt_in,origin_site_id,destination_site_id,sendatrack_vehicle_id",
  'Client Exemple,"Casablanca, Maroc",2026-08-20T14:00:00+02:00,TRUCK-01,+212600000000,false,,,',
].join("\n");
