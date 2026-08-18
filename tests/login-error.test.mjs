import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { classifyLoginError, publicLoginFailure } from "../app/lib/login-error.ts";

const [loginRoute, sendatrack] = await Promise.all([
  readFile(new URL("../app/api/auth/login/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/sendatrack.ts", import.meta.url), "utf8"),
]);

test("classifies rejected SENDATRACK credentials separately from provider outages", () => {
  assert.equal(classifyLoginError(401, "authentication_failed"), "invalid_credentials");
  assert.equal(classifyLoginError(503, "sendatrack_unavailable"), "service_unavailable");
  assert.equal(classifyLoginError(500, "unexpected"), "login_failed");
});

test("sanitizes malformed and unexpected login failures", () => {
  assert.deepEqual(publicLoginFailure(new SyntaxError("Unexpected token secret details")), { status: 400, code: "invalid_request" });
  assert.deepEqual(publicLoginFailure(new Error("missing_credentials")), { status: 400, code: "missing_credentials" });
  assert.deepEqual(publicLoginFailure(new Error("authentication_failed")), { status: 401, code: "authentication_failed" });
  assert.deepEqual(publicLoginFailure(new Error("sendatrack_unavailable")), { status: 503, code: "sendatrack_unavailable" });
  assert.deepEqual(publicLoginFailure(new Error("database_connection_string_here")), { status: 503, code: "login_failed" });
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

test("public login uses the shared same-origin guard", () => {
  assert.match(loginRoute, /requestIsSameOrigin\(request\)/);
  assert.match(loginRoute, /origin_not_allowed/);
  assert.doesNotMatch(loginRoute, /new URL\(origin\)/);
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

test("login route returns only sanitized public failure codes", () => {
  assert.match(loginRoute, /publicLoginFailure\(error\)/);
  assert.match(loginRoute, /failure\.code/);
  assert.doesNotMatch(loginRoute, /error instanceof Error \? error\.message/);
});
