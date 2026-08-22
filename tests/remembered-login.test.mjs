import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

function fakeLocalStorage() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: (key) => { store.delete(key); },
  };
}

globalThis.window = { localStorage: fakeLocalStorage() };
const { readRememberedLogin, saveRememberedLogin, clearRememberedLogin } = await import("../app/lib/remembered-login.ts");

test("round-trips a remembered account and username", () => {
  assert.equal(readRememberedLogin(), null);
  saveRememberedLogin({ accountID: "ACME-01", user: "dispatcher1" });
  assert.deepEqual(readRememberedLogin(), { accountID: "ACME-01", user: "dispatcher1" });
});

test("clearing removes the remembered login", () => {
  saveRememberedLogin({ accountID: "ACME-01", user: "dispatcher1" });
  clearRememberedLogin();
  assert.equal(readRememberedLogin(), null);
});

test("ignores malformed stored data instead of throwing", () => {
  window.localStorage.setItem("trackfleet-remembered-login", "{not json");
  assert.equal(readRememberedLogin(), null);
  window.localStorage.setItem("trackfleet-remembered-login", JSON.stringify({ accountID: "only-one-field" }));
  assert.equal(readRememberedLogin(), null);
});

test("the RememberedLogin type and stored shape never include a password field", async () => {
  const source = await readFile(new URL("../app/lib/remembered-login.ts", import.meta.url), "utf8");
  assert.match(source, /export type RememberedLogin = \{ accountID: string; user: string \};/);
  assert.doesNotMatch(source, /\.password\b/);
  assert.doesNotMatch(source, /"password"/);
});

test("the login form only remembers accountID and user -- the password field is left entirely to the browser's own password manager", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /saveRememberedLogin\(\{ accountID, user \}\)/);
  assert.doesNotMatch(page, /saveRememberedLogin\(\{[^}]*password/);
  // The password input itself must keep using the browser's native autofill,
  // not our own remember-login mechanism.
  assert.match(page, /name="password" type="password" autoComplete="current-password" required/);
});

test("the remember-me checkbox defaults to checked and prefills the account/user fields from any existing remembered login", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /const remembered = readRememberedLogin\(\);/);
  assert.match(page, /name="accountID"[^>]*defaultValue=\{remembered\?\.accountID \?\? ""\}/);
  assert.match(page, /name="user"[^>]*defaultValue=\{remembered\?\.user \?\? ""\}/);
  assert.match(page, /type="checkbox" name="rememberLogin" defaultChecked/);
});
