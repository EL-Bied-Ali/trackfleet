import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// subscription-store.ts imports trackfleet-runtime-env transitively (via
// pg-client.ts, needed for Postgres/Hyperdrive access), whose bare specifier
// only resolves under Vite/vinext's aliasing -- unresolvable from plain Node
// (matching this repo's established pattern for every other runtimeEnv-
// dependent module), so grantTrialIfNewCompany is exercised via source-text
// assertions instead of a direct import.
const storeSource = await readFile(new URL("../app/lib/subscription-store.ts", import.meta.url), "utf8");
const grantTrialBody = storeSource.slice(storeSource.indexOf("export async function grantTrialIfNewCompany"));

test("granting a trial is an INSERT ... ON CONFLICT DO NOTHING -- safe to call on every login without first checking whether the company already has a subscription row", () => {
  assert.match(grantTrialBody, /INSERT INTO subscriptions/);
  assert.match(grantTrialBody, /'trialing'/);
  assert.match(grantTrialBody, /ON CONFLICT \(company_id\) DO NOTHING/);
});

test("a trial is granted at the Pro plan, so a new company experiences the full product (including WhatsApp) rather than the cheaper tier by default", () => {
  assert.match(grantTrialBody, /'pro'/);
});

test("company-auth.ts grants a trial on every successful createCompanySession call (login, Google link, or admin impersonation reusing it), and its failure never blocks the login itself", async () => {
  const source = await readFile(new URL("../app/lib/company-auth.ts", import.meta.url), "utf8");
  assert.match(source, /import \{ grantTrialIfNewCompany \} from "\.\/subscription-store";/);
  assert.match(source, /await grantTrialIfNewCompany\(companyId\)\.catch\(\(error\) => \{/);
  // Must appear before the function returns its session result, and inside
  // createCompanySession specifically (the one function every login path --
  // regular login, Google callback, Google link, admin impersonation --
  // funnels through).
  const fnStart = source.indexOf("export async function createCompanySession");
  const fnBody = source.slice(fnStart, source.indexOf("\n}", fnStart));
  assert.match(fnBody, /grantTrialIfNewCompany/);
});
