import { getSqlOrNull } from "./pg-client.ts";

export type DeliveryRevenueCurrencyTotal = {
  currency: "EUR" | "MAD";
  totalAmount: number;
  parcelCount: number;
};

export type DeliveryRevenueWindowKey = "today" | "last7d" | "last30d" | "allTime";

export type DeliveryRevenueWindow = {
  key: DeliveryRevenueWindowKey;
  totals: DeliveryRevenueCurrencyTotal[];
  unpricedCount: number;
};

export type DeliveryRevenueSiteBreakdown = {
  siteId: string | null;
  totals: DeliveryRevenueCurrencyTotal[];
  unpricedCount: number;
};

export type DeliveryRevenueParcel = {
  id: string;
  customer: string;
  createdAt: string;
  weightKg: number | null;
  priceAmount: number | null;
  priceCurrency: "EUR" | "MAD" | null;
  status: string;
};

export type DeliveryRevenueReport = {
  available: boolean;
  generatedAt: string;
  windows: DeliveryRevenueWindow[];
  bySite: DeliveryRevenueSiteBreakdown[];
  recentParcels: DeliveryRevenueParcel[];
};

type RawWindowTotalRow = {
  window_key: DeliveryRevenueWindowKey;
  currency: "EUR" | "MAD";
  total_amount: number | string;
  parcel_count: number | string;
};

type RawWindowUnpricedRow = {
  window_key: DeliveryRevenueWindowKey;
  unpriced_count: number | string;
};

type RawSiteTotalRow = {
  origin_site_id: string | null;
  currency: "EUR" | "MAD";
  total_amount: number | string;
  parcel_count: number | string;
};

type RawSiteUnpricedRow = {
  origin_site_id: string | null;
  unpriced_count: number | string;
};

type RawParcelRow = {
  id: string;
  customer: string;
  created_at: string | Date;
  weight_kg: number | string | null;
  price_amount: number | string | null;
  price_currency: "EUR" | "MAD" | null;
  status: string;
};

const windowKeys: DeliveryRevenueWindowKey[] = ["today", "last7d", "last30d", "allTime"];

// Itemized parcels are for a human to read on the revenue page, not for
// bulk analysis -- bounded to the most recent 200 so this stays a single
// indexed scan regardless of how much history a company accumulates.
const RECENT_PARCELS_LIMIT = 200;

function emptyWindows(): DeliveryRevenueWindow[] {
  return windowKeys.map((key) => ({ key, totals: [], unpricedCount: 0 }));
}

export async function getDeliveryRevenueReport(
  companyId: string,
  options: { siteId?: string | null } = {},
): Promise<DeliveryRevenueReport> {
  const sql = getSqlOrNull();
  if (!sql) return { available: false, generatedAt: new Date().toISOString(), windows: emptyWindows(), bySite: [], recentParcels: [] };

  const siteId = options.siteId ?? null;

  const [totalRows, unpricedRows, parcelRows] = await Promise.all([
    sql`
      WITH scoped AS (
        SELECT price_amount, price_currency, created_at
        FROM deliveries
        WHERE company_id = ${companyId}
          AND (${siteId}::text IS NULL OR origin_site_id = ${siteId})
          AND price_amount IS NOT NULL
          AND price_currency IS NOT NULL
      )
      SELECT 'today'::text AS window_key, price_currency AS currency, SUM(price_amount) AS total_amount, COUNT(*) AS parcel_count
        FROM scoped WHERE created_at >= date_trunc('day', now()) GROUP BY price_currency
      UNION ALL
      SELECT 'last7d'::text, price_currency, SUM(price_amount), COUNT(*)
        FROM scoped WHERE created_at >= now() - INTERVAL '7 days' GROUP BY price_currency
      UNION ALL
      SELECT 'last30d'::text, price_currency, SUM(price_amount), COUNT(*)
        FROM scoped WHERE created_at >= now() - INTERVAL '30 days' GROUP BY price_currency
      UNION ALL
      SELECT 'allTime'::text, price_currency, SUM(price_amount), COUNT(*)
        FROM scoped GROUP BY price_currency
    `,
    sql`
      WITH scoped AS (
        SELECT created_at
        FROM deliveries
        WHERE company_id = ${companyId}
          AND (${siteId}::text IS NULL OR origin_site_id = ${siteId})
          AND (price_amount IS NULL OR price_currency IS NULL)
      )
      SELECT 'today'::text AS window_key, COUNT(*) AS unpriced_count FROM scoped WHERE created_at >= date_trunc('day', now())
      UNION ALL
      SELECT 'last7d'::text, COUNT(*) FROM scoped WHERE created_at >= now() - INTERVAL '7 days'
      UNION ALL
      SELECT 'last30d'::text, COUNT(*) FROM scoped WHERE created_at >= now() - INTERVAL '30 days'
      UNION ALL
      SELECT 'allTime'::text, COUNT(*) FROM scoped
    `,
    sql`
      SELECT id, customer, created_at, weight_kg, price_amount, price_currency, status
      FROM deliveries
      WHERE company_id = ${companyId}
        AND (${siteId}::text IS NULL OR origin_site_id = ${siteId})
      ORDER BY created_at DESC
      LIMIT ${RECENT_PARCELS_LIMIT}
    `,
  ]) as unknown as [RawWindowTotalRow[], RawWindowUnpricedRow[], RawParcelRow[]];

  const recentParcels: DeliveryRevenueParcel[] = parcelRows.map((row) => ({
    id: row.id,
    customer: row.customer,
    createdAt: new Date(row.created_at).toISOString(),
    weightKg: row.weight_kg == null ? null : Number(row.weight_kg),
    priceAmount: row.price_amount == null ? null : Number(row.price_amount),
    priceCurrency: row.price_currency,
    status: row.status,
  }));

  const windows: DeliveryRevenueWindow[] = windowKeys.map((key) => ({
    key,
    totals: totalRows
      .filter((row) => row.window_key === key)
      .map((row) => ({ currency: row.currency, totalAmount: Number(row.total_amount) || 0, parcelCount: Number(row.parcel_count) || 0 })),
    unpricedCount: Number(unpricedRows.find((row) => row.window_key === key)?.unpriced_count) || 0,
  }));

  let bySite: DeliveryRevenueSiteBreakdown[] = [];
  if (!siteId) {
    const [siteTotalRows, siteUnpricedRows] = await Promise.all([
      sql`
        SELECT origin_site_id, price_currency AS currency, SUM(price_amount) AS total_amount, COUNT(*) AS parcel_count
        FROM deliveries
        WHERE company_id = ${companyId} AND price_amount IS NOT NULL AND price_currency IS NOT NULL
        GROUP BY origin_site_id, price_currency
      `,
      sql`
        SELECT origin_site_id, COUNT(*) AS unpriced_count
        FROM deliveries
        WHERE company_id = ${companyId} AND (price_amount IS NULL OR price_currency IS NULL)
        GROUP BY origin_site_id
      `,
    ]) as unknown as [RawSiteTotalRow[], RawSiteUnpricedRow[]];

    const siteIds = new Set<string | null>([
      ...siteTotalRows.map((row) => row.origin_site_id),
      ...siteUnpricedRows.map((row) => row.origin_site_id),
    ]);
    bySite = Array.from(siteIds).map((currentSiteId) => ({
      siteId: currentSiteId,
      totals: siteTotalRows
        .filter((row) => row.origin_site_id === currentSiteId)
        .map((row) => ({ currency: row.currency, totalAmount: Number(row.total_amount) || 0, parcelCount: Number(row.parcel_count) || 0 })),
      unpricedCount: Number(siteUnpricedRows.find((row) => row.origin_site_id === currentSiteId)?.unpriced_count) || 0,
    }));
  }

  return { available: true, generatedAt: new Date().toISOString(), windows, bySite, recentParcels };
}
