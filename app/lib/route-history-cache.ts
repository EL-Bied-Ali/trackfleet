// Neon reported "network transfer allowance" at 100% (5/5 GB) while compute
// (10.71/100 CU-hrs) and storage (0.04/0.5 GB) were barely touched --
// confirmed live via Neon's own query-performance dashboard: the two worst
// offenders were listTripPositionsForRoute (up to 20,000 rows, ~9 columns
// each) and listEtaObservationsForRoute (up to 5,000 rows, ~15 columns
// each), both recomputing a slow-changing "historical learning" statistic
// (route dwell times / typical speed) from scratch on every call. The
// public customer tracking page polls its own delivery every 30s
// (app/page.tsx), and each poll was re-running both queries in full --
// the single biggest driver of egress, since a customer can leave that tab
// open for hours.
//
// Module-level (not per-request) on purpose: a Cloudflare Worker isolate
// serves many requests over its lifetime, so a cache here is genuinely
// reused across separate HTTP requests, not just within one. Route
// history/dwell statistics aggregate potentially weeks of historical
// trips -- being up to a few minutes stale has no meaningful effect on
// accuracy, unlike live GPS position or delivery status.
const DEFAULT_TTL_MS = 3 * 60_000;

type CacheEntry<T> = { value: Promise<T>; expiresAt: number };

const scopedCaches = new Map<string, Map<string, CacheEntry<unknown>>>();

export function cachedRouteQuery<T>(scope: string, key: string, compute: () => Promise<T>, ttlMs = DEFAULT_TTL_MS): Promise<T> {
  let scopeCache = scopedCaches.get(scope);
  if (!scopeCache) {
    scopeCache = new Map();
    scopedCaches.set(scope, scopeCache);
  }
  const now = Date.now();
  const existing = scopeCache.get(key);
  if (existing && existing.expiresAt > now) return existing.value as Promise<T>;

  const promise = compute();
  scopeCache.set(key, { value: promise, expiresAt: now + ttlMs });
  // A failed fetch must not poison the cache for the full TTL -- the next
  // call should retry immediately instead of repeating the same error.
  promise.catch(() => { if (scopeCache!.get(key)?.value === promise) scopeCache!.delete(key); });
  return promise;
}
