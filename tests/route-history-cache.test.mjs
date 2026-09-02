import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { cachedRouteQuery } from "../app/lib/route-history-cache.ts";

// Live incident: Neon reported "network transfer allowance" maxed out
// (5/5 GB) while compute (10.71/100 CU-hrs) and storage (0.04/0.5 GB)
// stayed nearly empty. Investigated live via Neon's own query-performance
// dashboard (console.neon.tech, with the user's permission to use their
// browser): the two worst offenders by call count were
// listTripPositionsForRoute (up to 20,000 rows, ~9 columns) and
// listEtaObservationsForRoute (up to 5,000 rows, ~15 columns), both
// recomputing a slow-changing historical statistic (route dwell time /
// typical speed) from scratch on every single call -- including the
// public customer tracking page's own 30-second poll (app/page.tsx),
// which a customer can leave open for hours.

test("cachedRouteQuery reuses the in-flight/cached promise for the same scope+key instead of recomputing", async () => {
  let calls = 0;
  const compute = async () => { calls += 1; return `result-${calls}`; };
  const first = await cachedRouteQuery("test-scope", "key-a", compute, 60_000);
  const second = await cachedRouteQuery("test-scope", "key-a", compute, 60_000);
  assert.equal(first, "result-1");
  assert.equal(second, "result-1");
  assert.equal(calls, 1);
});

test("cachedRouteQuery keeps different keys (and different scopes) fully independent", async () => {
  let calls = 0;
  const compute = async () => { calls += 1; return calls; };
  const a = await cachedRouteQuery("scope-x", "key-1", compute, 60_000);
  const b = await cachedRouteQuery("scope-x", "key-2", compute, 60_000);
  const c = await cachedRouteQuery("scope-y", "key-1", compute, 60_000);
  assert.deepEqual([a, b, c].sort(), [1, 2, 3]);
});

test("cachedRouteQuery recomputes once the TTL has expired", async () => {
  let calls = 0;
  const compute = async () => { calls += 1; return calls; };
  const first = await cachedRouteQuery("ttl-scope", "key", compute, 10);
  await new Promise((resolve) => setTimeout(resolve, 25));
  const second = await cachedRouteQuery("ttl-scope", "key", compute, 10);
  assert.equal(first, 1);
  assert.equal(second, 2);
});

test("a failed compute does not poison the cache -- the next call retries instead of repeating the same error", async () => {
  let attempt = 0;
  const compute = async () => {
    attempt += 1;
    if (attempt === 1) throw new Error("transient_failure");
    return "recovered";
  };
  await assert.rejects(cachedRouteQuery("failure-scope", "key", compute, 60_000));
  const result = await cachedRouteQuery("failure-scope", "key", compute, 60_000);
  assert.equal(result, "recovered");
  assert.equal(attempt, 2);
});

test("both listTripPositionsForRoute and listEtaObservationsForRoute call sites in the deliveries route go through cachedRouteQuery, including the previously-uncached public tracking path", async () => {
  const route = await readFile(new URL("../app/api/deliveries/route.ts", import.meta.url), "utf8");
  assert.match(route, /import \{ cachedRouteQuery \} from "\.\.\/\.\.\/lib\/route-history-cache";/);
  // learnedStopMinutes (used by both the public tracking path and the
  // dashboard's cachedLearnedDwell) -- the 20,000-row query.
  assert.match(route, /cachedRouteQuery\(\s*\n\s*"trip-positions-for-route",\s*\n\s*`\$\{companyId\}\|\$\{routeTemplateId\}`,\s*\n\s*\(\) => store\.listTripPositionsForRoute\(companyId, routeTemplateId, 20000\),\s*\n\s*\)/);
  // The public tracking GET branch's own historyRows fetch -- previously
  // called store.listEtaObservationsForRoute directly with no caching at
  // all, unlike the dashboard branch which already deduped within a
  // single request via its own local Map.
  assert.match(route, /cachedRouteQuery\(\s*\n\s*"eta-observations-for-route",\s*\n\s*`\$\{row\.companyId\}\|\$\{routeContext\.routeTemplateId\}\|\$\{routeContext\.destinationSiteId\}`,\s*\n\s*\(\) => store\.listEtaObservationsForRoute\(row\.companyId, routeContext\.routeTemplateId, routeContext\.destinationSiteId\),\s*\n\s*\)/);
  // The dashboard's cachedEtaHistory now goes through the same
  // cross-request cache instead of a plain per-request Map, so a second
  // dispatcher (or a second refresh) within the TTL window reuses it too.
  assert.match(route, /const cachedEtaHistory = \(routeTemplateId: string, destinationSiteId: string\) => cachedRouteQuery\(\s*\n\s*"eta-observations-for-route",\s*\n\s*`\$\{session\.companyId\}\|\$\{routeTemplateId\}\|\$\{destinationSiteId\}`,\s*\n\s*\(\) => store\.listEtaObservationsForRoute\(session\.companyId, routeTemplateId, destinationSiteId\),\s*\n\s*\);/);
  assert.doesNotMatch(route, /const etaHistoryCache = new Map/);
});
