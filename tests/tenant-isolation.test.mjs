import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const files = [
  "app/lib/delivery-store.memory.ts",
  "app/lib/delivery-store.postgres.ts",
  "app/lib/delivery-store.cloudflare.ts",
];

test("production company queries never include demo deliveries", () => {
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");

    const dangerousPatterns = [
      /companyId\s*===\s*companyId\s*\|\|[^\n]*demo/,
      /companyId\s*!==\s*companyId\s*&&[^\n]*demo/,
      /company_id\s*=\s*\$\{companyId\}\s*OR\s*company_id\s*=\s*'demo'/,
      /\(company_id\s*=\s*\$\{companyId\}\s*OR\s*company_id\s*=\s*'demo'\)/,
      /\(d\.company_id\s*=\s*\$\{companyId\}\s*OR\s*d\.company_id\s*=\s*'demo'\)/,
      /company_id\s*=\s*\?\s*OR\s*company_id\s*=\s*'demo'/,
      /\(company_id\s*=\s*\?\s*OR\s*company_id\s*=\s*'demo'\)/,
      /\(d\.company_id\s*=\s*\?\s*OR\s*d\.company_id\s*=\s*'demo'\)/,
    ];

    for (const pattern of dangerousPatterns) {
      assert.equal(pattern.test(source), false, `${file} still mixes demo rows into real company scope: ${pattern}`);
    }
  }
});
