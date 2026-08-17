import assert from "node:assert/strict";
import test from "node:test";
import { originPreferenceKey, resolvePreferredOriginSite } from "../app/lib/origin-preference.ts";

test("origin preference is scoped by SENDATRACK account and user", () => {
  assert.notEqual(
    originPreferenceKey({ account: "ACME", user: "dispatcher-a" }),
    originPreferenceKey({ account: "ACME", user: "dispatcher-b" }),
  );
});

test("saved origin wins when it still exists", () => {
  assert.equal(resolvePreferredOriginSite("site-b", ["site-a", "site-b"]), "site-b");
});

test("falls back safely when saved origin no longer exists", () => {
  assert.equal(resolvePreferredOriginSite("removed", ["site-a", "site-b"]), "site-a");
});
