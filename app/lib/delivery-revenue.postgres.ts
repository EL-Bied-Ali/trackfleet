import { neon } from "@neondatabase/serverless";
import { runtimeEnv } from "trackfleet-runtime-env";

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

export type DeliveryRevenueReport = {
  available: boolean;
  generatedAt: string;
  windows: DeliveryRevenueWindow[];
  bySite: DeliveryRevenueSiteBreakdown[];
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

const windowKeys: DeliveryRevenueWindowKey[] = ["today", "last7d", "last30d", "allTime"];

function emptyWindows(): DeliveryRevenueWindow[] {
  return windowKeys.map((key) => ({ key, totals: [], unpricedCount: 0 }));
}

export async function getDeliveryRevenueReport(
  companyId: string,
  options: { siteId?: string | null } = {},
): Promise<DeliveryRevenueReport> {
  const databaseUrl = runtimeEnv.DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
  if (!databaseUrl) return { available: false, generatedAt: new Date().toISOString(), windows: emptyWindows(), bySite: [] };

  const sql = neon(databaseUrl);
  const siteId = options.siteId ?? null;

  const [totalRows, unpricedRows] = await Promise.all([
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
  ]) as [RawWindowTotalRow[], RawWindowUnpricedRow[]];

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
    ]) as [RawSiteTotalRow[], RawSiteUnpricedRow[]];

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

  return { available: true, generatedAt: new Date().toISOString(), windows, bySite };
}
