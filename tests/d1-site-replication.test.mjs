import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync("app/lib/site-store.shared-postgres.ts", "utf8");

test("site upserts commit to Postgres before mirroring to D1", () => {
  assert.match(source, /const site = await primarySiteStore\.upsert\(input\);\s*await mirrorSite\(site\);\s*return site;/s);
  assert.match(source, /INSERT INTO sites/);
  assert.match(source, /ON CONFLICT\(company_id, id\) DO UPDATE/);
});

test("site reads remain on Postgres until broader failover is ready", () => {
  assert.match(source, /return primarySiteStore\.listForCompany\(companyId\);/);
});

test("D1 site replication is best-effort", () => {
  assert.match(source, /catch \(error\) \{\s*console\.error\("\[trackfleet:replication\] D1 site mirror failed"/s);
  assert.doesNotMatch(source, /throw error/);
});
