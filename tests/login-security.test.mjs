import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const route = await readFile(new URL("../app/api/auth/login/route.ts", import.meta.url), "utf8");

test("public login rejects cross-origin requests", () => {
  assert.match(route, /request\.headers\.get\(["']origin["']\)/);
  assert.match(route, /new URL\(origin\)\.host === new URL\(request\.url\)\.host/);
  assert.match(route, /origin_not_allowed/);
  assert.match(route, /403/);
});

test("public login rate limits repeated provider authentication attempts", () => {
  assert.match(route, /loginWindowMs = 10 \* 60_000/);
  assert.match(route, /maxLoginAttempts = 8/);
  assert.match(route, /x-forwarded-for/);
  assert.match(route, /too_many_login_attempts/);
  assert.match(route, /retry-after/);
  assert.match(route, /429/);
});

test("successful login clears the local attempt bucket", () => {
  assert.match(route, /recentLoginAttempts\.delete\(key\)/);
});

test("login bounds untrusted credential field sizes before forwarding", () => {
  assert.match(route, /accountID:[^\n]*slice\(0, 120\)/);
  assert.match(route, /user:[^\n]*slice\(0, 120\)/);
  assert.match(route, /password:[^\n]*slice\(0, 512\)/);
});
