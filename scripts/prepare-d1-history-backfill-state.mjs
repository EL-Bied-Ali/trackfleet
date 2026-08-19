import { execFileSync } from "node:child_process";

const databaseName = process.env.TRACKFLEET_D1_DATABASE_NAME?.trim() || "trackfleet-db";
const mode = process.argv.includes("--local") ? "--local" : "--remote";
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const sql = `
CREATE TABLE IF NOT EXISTS d1_history_backfill_state (
  company_id text PRIMARY KEY NOT NULL,
  cursor_created_at integer,
  cursor_id text,
  completed_at integer,
  updated_at integer NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_d1_history_backfill_completed
  ON d1_history_backfill_state(completed_at, updated_at);
`;

execFileSync(pnpm, [
  "exec", "wrangler", "d1", "execute", databaseName, mode, "--yes", "--command", sql,
], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"],
  env: process.env,
});

console.log(`[d1-history-schema] ready (${mode.slice(2)})`);
