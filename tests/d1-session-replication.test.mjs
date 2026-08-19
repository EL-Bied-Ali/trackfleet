import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync("app/lib/auth-session-store.shared-postgres.ts", "utf8");

test("shared Postgres sessions mirror successful creates and deletes to D1", () => {
  assert.match(source, /await createPrimarySession\(input\);\s*await mirrorCreate\(input\);/s);
  assert.match(source, /await deletePrimarySession\(tokenHash\);\s*await mirrorDelete\(tokenHash\);/s);
  assert.match(source, /INSERT INTO sessions/);
  assert.match(source, /DELETE FROM sessions WHERE token_hash = \?/);
});

test("D1 mirror failures stay best-effort and do not replace the Postgres result", () => {
  assert.match(source, /catch \(error\) \{\s*console\.error\("\[trackfleet:replication\] D1 session mirror failed"/s);
  assert.doesNotMatch(source, /throw error/);
});

test("session reads remain on Postgres until broader D1 replication is ready", () => {
  assert.match(source, /export \{ getServerSession \};/);
});
