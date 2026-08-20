import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../app/lib/sendatrack.ts", import.meta.url), "utf8");
const wranglerConfig = await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");
const cloudflareRuntimeEnv = await readFile(new URL("../app/lib/runtime-env.cloudflare.ts", import.meta.url), "utf8");
const vercelRuntimeEnv = await readFile(new URL("../app/lib/runtime-env.vercel.ts", import.meta.url), "utf8");

test("the SENDATRACK token cache KV namespace is bound in production and typed on every platform", () => {
  assert.match(wranglerConfig, /"binding": "SENDATRACK_TOKEN_CACHE"/);
  assert.match(cloudflareRuntimeEnv, /SENDATRACK_TOKEN_CACHE\?: KVNamespace;/);
  assert.match(vercelRuntimeEnv, /SENDATRACK_TOKEN_CACHE\?: undefined;/);
});

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
  assert.match(loginBody, /const cachedToken = await readCachedToken\(key\);/);
  const readBody = source.slice(source.indexOf("async function readCachedToken"), source.indexOf("async function writeCachedToken"));
  assert.match(readBody, /cachedTokens\.get\(key\)/);
});

test("the token cache is backed by Cloudflare KV so it survives across stateless Worker isolates, not just an in-memory Map", () => {
  // Regression guard: a plain in-memory Map only helps within a single
  // isolate. Workers are stateless and isolates are recycled constantly, so
  // without a persistent backing store almost every poll re-authenticates
  // with SENDATRACK instead of reusing a token for the intended cache
  // window -- observed live as a fresh "login rejected" log on every single
  // request, seconds apart, well inside the 45-minute TTL.
  assert.match(source, /SENDATRACK_TOKEN_CACHE/);
  assert.match(source, /await kv\.get\(await kvCacheKey\(key\)\)/);
  assert.match(source, /await kv\.put\(await kvCacheKey\(key\), token, \{ expirationTtl: tokenCacheTtlSeconds \}\)/);
  assert.match(source, /await kv\.delete\(await kvCacheKey\(key\)\)/);
});

test("the KV cache key is hashed, never the raw password-bearing credential key", () => {
  const kvKeyBody = source.slice(source.indexOf("async function kvCacheKey"), source.indexOf("// cachedTokens is a plain"));
  assert.match(kvKeyBody, /sha256Hex\(key\)/);
  assert.doesNotMatch(kvKeyBody, /auth\.password/);
});

test("KV is optional: a missing binding (Vercel/local dev) falls back to the in-memory cache without throwing", () => {
  assert.match(source, /function tokenCacheKv\(\) \{\s*return \(runtimeEnv as unknown as \{ SENDATRACK_TOKEN_CACHE\?: TokenCacheKv \}\)\.SENDATRACK_TOKEN_CACHE \?\? null;\s*\}/);
  const readBody = source.slice(source.indexOf("async function readCachedToken"), source.indexOf("async function writeCachedToken"));
  assert.match(readBody, /if \(!kv\) return null;/);
});
