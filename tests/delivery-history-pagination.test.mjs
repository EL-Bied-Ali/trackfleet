import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const queryUrl = new URL("../app/lib/delivery-history.postgres.ts", import.meta.url);
const routeUrl = new URL("../app/api/operations/history/route.ts", import.meta.url);
const pageUrl = new URL("../app/operations/history/page.tsx", import.meta.url);

test("delivery history uses tenant-scoped keyset pagination and never OFFSET", async () => {
  const source = await readFile(queryUrl, "utf8");
  assert.match(source, /WHERE company_id = \$\{companyId\}/);
  assert.match(source, /status = 'Delivered'/);
  assert.match(source, /created_at < \$\{cursor\.beforeCreatedAt\}/);
  assert.match(source, /created_at = \$\{cursor\.beforeCreatedAt\} AND id < \$\{cursor\.beforeId\}/);
  assert.match(source, /ORDER BY created_at DESC, id DESC/);
  assert.doesNotMatch(source, /\bOFFSET\b/i);
});

test("history page size is bounded and fetches one lookahead row", async () => {
  const source = await readFile(queryUrl, "utf8");
  assert.match(source, /DELIVERY_HISTORY_DEFAULT_PAGE_SIZE = 50/);
  assert.match(source, /DELIVERY_HISTORY_MAX_PAGE_SIZE = 100/);
  assert.match(source, /const queryLimit = limit \+ 1/);
  assert.match(source, /rows\.length > limit/);
});

test("history API requires authentication and validates complete cursor pairs", async () => {
  const source = await readFile(routeUrl, "utf8");
  assert.match(source, /getDispatcherSession\(request\)/);
  assert.match(source, /status: 401/);
  assert.match(source, /if \(!beforeCreatedAt \|\| !beforeId/);
  assert.match(source, /invalid_history_cursor/);
  assert.match(source, /cache-control": "no-store"/);
});

test("history UI appends pages using the server cursor rather than refetching the full archive", async () => {
  const source = await readFile(pageUrl, "utf8");
  assert.match(source, /beforeCreatedAt/);
  assert.match(source, /beforeId/);
  assert.match(source, /append \? \[\.\.\.current, \.\.\.page\.items\] : page\.items/);
  assert.match(source, /limit: "50"/);
});
