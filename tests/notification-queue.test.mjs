import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { NotificationClaimState } from "../app/lib/notification-claim-state.ts";

const postgresStore = await readFile(new URL("../app/lib/delivery-store.postgres.ts", import.meta.url), "utf8");
const cloudflareStore = await readFile(new URL("../app/lib/delivery-store.cloudflare.ts", import.meta.url), "utf8");

test("Postgres and D1 stores never delete a notification claim on release, only on a genuine send", () => {
  // Same regression as the NotificationClaimState test below, at the actual
  // storage layer: deleting delivery_notifications on release discarded
  // attempted_at, so claimNotification's own stale-reclaim check ("attempted_at
  // < staleBefore") had nothing left to compare against and every failed send
  // became immediately retryable instead of waiting out the stale window.
  for (const source of [postgresStore, cloudflareStore]) {
    const releaseBody = source.slice(source.indexOf("async releaseNotification"), source.indexOf("async create"));
    assert.doesNotMatch(releaseBody, /DELETE FROM delivery_notifications/);
  }
});

test("notification claim is deduplicated, then final after success", () => {
  const state = new NotificationClaimState(5 * 60_000);
  const key = "TF-2841:PROGRESS_25:whatsapp";
  const now = 1_000_000;

  assert.equal(state.isPending(key, now), true);
  assert.equal(state.claim(key, now), true);
  assert.equal(state.claim(key, now + 1), false);
  assert.equal(state.isPending(key, now + 1), false);

  assert.equal(state.claim(key, now + 10 * 60_000), true);
  state.markSent(key, now + 10 * 60_000 + 1);
  assert.equal(state.isPending(key, now + 20 * 60_000), false);
  assert.equal(state.claim(key, now + 20 * 60_000), false);
});

test("releasing a failed claim does not make it immediately retryable -- only after the retry window", () => {
  // Regression guard: releasing used to delete the claim outright, which let
  // a permanently failing send (e.g. an expired provider token) be retried
  // on literally the very next call instead of waiting out retryAfterMs.
  // With a broken token that meant every scheduler tick re-attempted the
  // entire backlog from scratch, which is what blew through Cloudflare's
  // per-invocation subrequest limit in production.
  const state = new NotificationClaimState(5 * 60_000);
  const key = "TF-2841:PROGRESS_50:whatsapp";
  const now = 1_000_000;

  assert.equal(state.claim(key, now), true);
  state.release(key);
  assert.equal(state.isPending(key, now + 1), false, "must not be immediately retryable after release");
  assert.equal(state.claim(key, now + 1), false);
  assert.equal(state.isPending(key, now + 5 * 60_000), true, "must become retryable once the window elapses");
  assert.equal(state.claim(key, now + 5 * 60_000), true);
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
