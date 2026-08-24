import "./postgres-runtime-bootstrap";
import { neon } from "@neondatabase/serverless";

export const DELIVERY_HISTORY_DEFAULT_PAGE_SIZE = 50;
export const DELIVERY_HISTORY_MAX_PAGE_SIZE = 100;

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required for delivery history reads");
const sql = neon(databaseUrl);

export type DeliveryHistoryItem = {
  id: string;
  customer: string;
  destination: string;
  truck: string;
  contact: string;
  recipientName: string;
  recipientContact: string;
  weightKg: number | null;
  priceAmount: number | null;
  priceCurrency: "EUR" | "MAD" | null;
  itemDescription: string | null;
  plannedArrivalAt: string | null;
  createdAt: string;
};

export type DeliveryHistoryCursor = {
  beforeCreatedAt: string;
  beforeId: string;
};

type RawHistoryRow = {
  id: string;
  customer: string;
  destination: string;
  truck: string;
  contact: string;
  recipient_name: string | null;
  recipient_contact: string | null;
  weight_kg: number | string | null;
  price_amount: number | string | null;
  price_currency: "EUR" | "MAD" | null;
  item_description: string | null;
  planned_arrival_at: string | Date | null;
  created_at: string | Date;
};

function toIso(value: string | Date | null) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function normalizePageSize(limit?: number) {
  const parsed = Number(limit ?? DELIVERY_HISTORY_DEFAULT_PAGE_SIZE);
  if (!Number.isFinite(parsed)) return DELIVERY_HISTORY_DEFAULT_PAGE_SIZE;
  return Math.max(1, Math.min(DELIVERY_HISTORY_MAX_PAGE_SIZE, Math.round(parsed)));
}

function hydrate(row: RawHistoryRow): DeliveryHistoryItem {
  return {
    id: row.id,
    customer: row.customer,
    destination: row.destination,
    truck: row.truck,
    contact: row.contact,
    recipientName: row.recipient_name ?? "",
    recipientContact: row.recipient_contact ?? "",
    weightKg: row.weight_kg == null ? null : Number(row.weight_kg),
    priceAmount: row.price_amount == null ? null : Number(row.price_amount),
    priceCurrency: row.price_currency === "EUR" || row.price_currency === "MAD" ? row.price_currency : null,
    itemDescription: row.item_description ?? null,
    plannedArrivalAt: toIso(row.planned_arrival_at),
    createdAt: toIso(row.created_at)!,
  };
}

export async function listDeliveredHistory(
  companyId: string,
  options: { limit?: number; cursor?: DeliveryHistoryCursor | null; siteId?: string | null } = {},
) {
  const limit = normalizePageSize(options.limit);
  const queryLimit = limit + 1;
  const cursor = options.cursor ?? null;
  const siteId = options.siteId ?? null;
  const rows = cursor
    ? await sql`
        SELECT id, customer, destination, truck, contact, recipient_name, recipient_contact, weight_kg, price_amount, price_currency, item_description, planned_arrival_at, created_at
        FROM deliveries
        WHERE company_id = ${companyId}
          AND status = 'Delivered'
          AND (${siteId}::text IS NULL OR origin_site_id = ${siteId} OR destination_site_id = ${siteId})
          AND (
            created_at < ${cursor.beforeCreatedAt}
            OR (created_at = ${cursor.beforeCreatedAt} AND id < ${cursor.beforeId})
          )
        ORDER BY created_at DESC, id DESC
        LIMIT ${queryLimit}
      ` as RawHistoryRow[]
    : await sql`
        SELECT id, customer, destination, truck, contact, recipient_name, recipient_contact, weight_kg, price_amount, price_currency, item_description, planned_arrival_at, created_at
        FROM deliveries
        WHERE company_id = ${companyId}
          AND status = 'Delivered'
          AND (${siteId}::text IS NULL OR origin_site_id = ${siteId} OR destination_site_id = ${siteId})
        ORDER BY created_at DESC, id DESC
        LIMIT ${queryLimit}
      ` as RawHistoryRow[];

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const items = pageRows.map(hydrate);
  const last = items.at(-1) ?? null;
  return {
    items,
    nextCursor: hasMore && last ? { beforeCreatedAt: last.createdAt, beforeId: last.id } : null,
  };
}
