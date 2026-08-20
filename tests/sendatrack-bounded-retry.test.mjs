import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../app/lib/sendatrack.ts", import.meta.url), "utf8");

test("SENDATRACK snapshot retries transient provider failures only once", () => {
  assert.match(source, /const snapshotMaxAttempts = 2;/);
  assert.match(source, /const snapshotRetryDelayMs = 750;/);
  assert.match(source, /attempt <= snapshotMaxAttempts/);
  assert.match(source, /attempt < snapshotMaxAttempts && retryableSnapshotError\(code\)/);
  assert.match(source, /code === "authentication_failed" \|\| code === "service_unavailable" \|\| code === "unexpected_response"/);
});

test("retry clears cached authentication state and remains bounded", () => {
  assert.match(source, /cachedTokens\.delete\(credentialKey\(auth\)\);/);
  assert.match(source, /await waitBeforeSnapshotRetry\(\);/);
  assert.match(source, /snapshot failed.*attempts: attempt/s);
  assert.doesNotMatch(source, /while\s*\(true\)/);
});
