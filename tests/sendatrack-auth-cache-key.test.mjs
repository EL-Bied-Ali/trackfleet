import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../app/lib/sendatrack.ts", import.meta.url), "utf8");

test("the SENDATRACK token cache key includes the password", () => {
  // Regression guard: credentialKey() previously hashed only accountID+user.
  // That let a cached token from one successful login answer login() for
  // ANY password submitted for the same account+user within the 45-minute
  // cache window, because the submitted password was never re-checked
  // against SENDATRACK on a cache hit. The key must bind to the exact
  // credentials that produced the cached token.
  const functionBody = source.slice(
    source.indexOf("function credentialKey"),
    source.indexOf("function providerUnavailableStatus"),
  );
  assert.match(functionBody, /auth\.accountID/);
  assert.match(functionBody, /auth\.user/);
  assert.match(functionBody, /auth\.password/);
});

test("login() only trusts a cached token, never a submitted password, when the cache key already matches", () => {
  const loginBody = source.slice(source.indexOf("async function login"), source.indexOf("async function requestFleetPayload"));
  assert.match(loginBody, /const key = credentialKey\(auth\);/);
  assert.match(loginBody, /cachedTokens\.get\(key\)/);
});
