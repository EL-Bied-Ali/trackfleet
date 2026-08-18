import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { classifyLoginError } from "../app/lib/login-error.ts";

const [loginRoute, sendatrack] = await Promise.all([
  readFile(new URL("../app/api/auth/login/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/sendatrack.ts", import.meta.url), "utf8"),
]);

test("classifies rejected SENDATRACK credentials separately from provider outages", () => {
  assert.equal(classifyLoginError(401, "authentication_failed"), "invalid_credentials");
  assert.equal(classifyLoginError(503, "sendatrack_unavailable"), "service_unavailable");
  assert.equal(classifyLoginError(500, "unexpected"), "login_failed");
});

test("SENDATRACK login treats only 401 and 403 as credential rejection", () => {
  assert.match(sendatrack, /return status === 401 \|\| status === 403/);
  assert.match(sendatrack, /providerUnavailableStatus\(response\.status\)/);
  assert.match(sendatrack, /authenticationRejectedStatus\(response\.status\)/);
  assert.match(sendatrack, /throw new Error\(["']unexpected_response["']\)/);
});

test("SENDATRACK temporary statuses remain provider outages", () => {
  assert.match(sendatrack, /status === 408/);
  assert.match(sendatrack, /status === 425/);
  assert.match(sendatrack, /status === 429/);
  assert.match(sendatrack, /status >= 500/);
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
