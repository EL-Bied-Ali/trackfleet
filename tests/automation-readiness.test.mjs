import assert from "node:assert/strict";
import test from "node:test";
import { automationStorageIsReady } from "../app/lib/automation-readiness.ts";

test("automation refuses ephemeral memory storage", () => {
  assert.equal(automationStorageIsReady({ mode: "memory", persistent: false, connected: true, error: null }), false);
});

test("automation refuses disconnected persistent storage", () => {
  assert.equal(automationStorageIsReady({ mode: "postgres", persistent: true, connected: false, error: "offline" }), false);
});

test("automation accepts connected persistent storage", () => {
  assert.equal(automationStorageIsReady({ mode: "postgres", persistent: true, connected: true, error: null }), true);
  assert.equal(automationStorageIsReady({ mode: "cloudflare-d1", persistent: true, connected: true, error: null }), true);
});
