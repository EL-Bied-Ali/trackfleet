import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(new URL("../scripts/prepare-postgres-schema.mjs", import.meta.url));

test("without DATABASE_URL, the pre-deploy Postgres schema gate skips cleanly instead of failing the deploy", async () => {
  const { stdout } = await execFileAsync(process.execPath, [scriptPath], {
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: "" },
  });
  assert.match(stdout, /DATABASE_URL not set, skipping/);
});

test("the gate probes storage-schema-contract.ts's actual required tables/columns, not a hardcoded copy", async () => {
  const source = await readFile(new URL("../scripts/prepare-postgres-schema.mjs", import.meta.url), "utf8");
  assert.match(source, /import\(["']\.\.\/app\/lib\/storage-schema-contract\.ts["']\)/);
  assert.match(source, /REQUIRED_POSTGRES_TABLES/);
  assert.match(source, /REQUIRED_POSTGRES_COLUMNS/);
  assert.match(source, /information_schema\.tables/);
  assert.match(source, /information_schema\.columns/);
  // Detected drift must fail the step (blocking the deploy), not just warn.
  assert.match(source, /process\.exit\(1\)/);
});

test("the deploy workflow verifies the real Postgres schema before the new Worker version can go live", async () => {
  const workflow = await readFile(new URL("../.github/workflows/cloudflare-production-deploy.yml", import.meta.url), "utf8");
  const gateIndex = workflow.indexOf("scripts/prepare-postgres-schema.mjs");
  const deployIndex = workflow.indexOf("cloudflare/wrangler-action@v3");
  assert.ok(gateIndex >= 0, "deploy workflow must run the Postgres schema gate");
  assert.ok(deployIndex > gateIndex, "the schema gate must run before the Worker is actually deployed");
  assert.match(workflow, /DATABASE_URL: \$\{\{ secrets\.DATABASE_URL \}\}/);
});
