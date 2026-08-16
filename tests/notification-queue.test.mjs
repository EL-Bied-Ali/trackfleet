import assert from "node:assert/strict";
import test from "node:test";
import { NotificationClaimState } from "../app/lib/notification-claim-state.ts";

test("notification claim is deduplicated, retryable, then final after success", () => {
  const state = new NotificationClaimState(5 * 60_000);
  const key = "TF-2841:PROGRESS_25:whatsapp";
  const now = 1_000_000;

  assert.equal(state.isPending(key, now), true);
  assert.equal(state.claim(key, now), true);
  assert.equal(state.claim(key, now + 1), false);
  assert.equal(state.isPending(key, now + 1), false);

  state.release(key);
  assert.equal(state.isPending(key, now + 2), true);

  assert.equal(state.claim(key, now + 3), true);
  state.markSent(key, now + 4);
  assert.equal(state.isPending(key, now + 10 * 60_000), false);
  assert.equal(state.claim(key, now + 10 * 60_000), false);
});

test("an abandoned claim becomes retryable after the timeout", () => {
  const state = new NotificationClaimState(5 * 60_000);
  const key = "TF-2841:PROGRESS_50:whatsapp";
  const now = 2_000_000;

  assert.equal(state.claim(key, now), true);
  assert.equal(state.isPending(key, now + 4 * 60_000), false);
  assert.equal(state.isPending(key, now + 5 * 60_000), true);
  assert.equal(state.claim(key, now + 5 * 60_000), true);
});
