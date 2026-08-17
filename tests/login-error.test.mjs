import assert from "node:assert/strict";
import test from "node:test";
import { classifyLoginError } from "../app/lib/login-error.ts";

test("classifies rejected SENDATRACK credentials separately from provider outages", () => {
  assert.equal(classifyLoginError(401, "authentication_failed"), "invalid_credentials");
  assert.equal(classifyLoginError(503, "sendatrack_unavailable"), "service_unavailable");
  assert.equal(classifyLoginError(500, "unexpected"), "login_failed");
});
