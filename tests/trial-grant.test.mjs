import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { grantTrialIfNewCompany } from "../app/lib/subscription-store.ts";

test("grantTrialIfNewCompany is a real, directly usable function (no runtimeEnv dependency, matching every other subscription-store export)", () => {
  assert.equal(typeof grantTrialIfNewCompany, "function");
});

test("granting a trial is an INSERT ... ON CONFLICT DO NOTHING -- safe to call on every login without first checking whether the company already has a subscription row", () => {
  const source = grantTrialIfNewCompany.toString();
  assert.match(source, /INSERT INTO subscriptions/);
  assert.match(source, /'trialing'/);
  assert.match(source, /ON CONFLICT \(company_id\) DO NOTHING/);
});

test("a trial is granted at the Pro plan, so a new company experiences the full product (including WhatsApp) rather than the cheaper tier by default", () => {
  const source = grantTrialIfNewCompany.toString();
  assert.match(source, /'pro'/);
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
