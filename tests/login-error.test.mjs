import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { classifyLoginError } from "../app/lib/login-error.ts";

const loginRoute = await readFile(new URL("../app/api/auth/login/route.ts", import.meta.url), "utf8");

test("classifies rejected SENDATRACK credentials separately from provider outages", () => {
  assert.equal(classifyLoginError(401, "authentication_failed"), "invalid_credentials");
  assert.equal(classifyLoginError(503, "sendatrack_unavailable"), "service_unavailable");
  assert.equal(classifyLoginError(500, "unexpected"), "login_failed");
});

test("public login rejects cross-origin requests", () => {
  assert.match(loginRoute, /request\.headers\.get\(["']origin["']\)/);
  assert.match(loginRoute, /new URL\(origin\)\.host === new URL\(request\.url\)\.host/);
  assert.match(loginRoute, /origin_not_allowed/);
});

test("public login rate limits repeated provider authentication attempts", () => {
  assert.match(loginRoute, /loginWindowMs = 10 \* 60_000/);
  assert.match(loginRoute, /maxLoginAttempts = 8/);
  assert.match(loginRoute, /x-forwarded-for/);
  assert.match(loginRoute, /too_many_login_attempts/);
  assert.match(loginRoute, /retry-after/);
});

test("successful login clears the local attempt bucket", () => {
  assert.match(loginRoute, /recentLoginAttempts\.delete\(key\)/);
});

test("login bounds untrusted credential field sizes before forwarding", () => {
  assert.match(loginRoute, /accountID:[^\n]*slice\(0, 120\)/);
  assert.match(loginRoute, /user:[^\n]*slice\(0, 120\)/);
  assert.match(loginRoute, /password:[^\n]*slice\(0, 512\)/);
});
