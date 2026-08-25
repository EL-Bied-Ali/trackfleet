import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  isSubscriptionLifecycleEvent,
  parsePaddleSubscriptionEvent,
  verifyPaddleWebhookSignature,
} from "../app/lib/paddle-webhook.ts";

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

test("a genuine, correctly-signed webhook verifies", async () => {
  const secret = "whtest_secret";
  const body = JSON.stringify({ event_type: "subscription.updated" });
  const ts = Math.floor(Date.now() / 1000).toString();
  const signature = await hmacHex(secret, `${ts}:${body}`);
  const ok = await verifyPaddleWebhookSignature(body, `ts=${ts};h1=${signature}`, secret);
  assert.equal(ok, true);
});

test("a tampered body is rejected even with an otherwise-valid-looking signature header", async () => {
  const secret = "whtest_secret";
  const ts = Math.floor(Date.now() / 1000).toString();
  const signature = await hmacHex(secret, `${ts}:${JSON.stringify({ event_type: "subscription.updated" })}`);
  const ok = await verifyPaddleWebhookSignature(JSON.stringify({ event_type: "subscription.updated", status: "active" }), `ts=${ts};h1=${signature}`, secret);
  assert.equal(ok, false);
});

test("the wrong secret is rejected", async () => {
  const body = JSON.stringify({ event_type: "subscription.updated" });
  const ts = Math.floor(Date.now() / 1000).toString();
  const signature = await hmacHex("real_secret", `${ts}:${body}`);
  const ok = await verifyPaddleWebhookSignature(body, `ts=${ts};h1=${signature}`, "wrong_secret");
  assert.equal(ok, false);
});

test("a stale timestamp is rejected even with a correct signature for that (old) timestamp -- guards against replaying an old, genuinely-captured webhook", async () => {
  const secret = "whtest_secret";
  const body = JSON.stringify({ event_type: "subscription.updated" });
  const staleTs = (Math.floor(Date.now() / 1000) - 3600).toString();
  const signature = await hmacHex(secret, `${staleTs}:${body}`);
  const ok = await verifyPaddleWebhookSignature(body, `ts=${staleTs};h1=${signature}`, secret);
  assert.equal(ok, false);
});

test("missing header, missing secret, or malformed header all fail closed", async () => {
  assert.equal(await verifyPaddleWebhookSignature("{}", null, "secret"), false);
  assert.equal(await verifyPaddleWebhookSignature("{}", "ts=123;h1=abc", ""), false);
  assert.equal(await verifyPaddleWebhookSignature("{}", "not-a-valid-header", "secret"), false);
});

test("companyId and plan come only from custom_data on Paddle's own signed payload, never trusted from elsewhere", () => {
  const event = parsePaddleSubscriptionEvent({
    event_type: "subscription.updated",
    data: {
      id: "sub_123",
      customer_id: "ctm_456",
      status: "active",
      custom_data: { companyId: "company-abc", plan: "pro" },
      current_billing_period: { ends_at: "2026-09-25T00:00:00Z" },
    },
  });
  assert.deepEqual(event, {
    eventType: "subscription.updated",
    companyId: "company-abc",
    plan: "pro",
    paddleCustomerId: "ctm_456",
    paddleSubscriptionId: "sub_123",
    status: "active",
    currentPeriodEnd: new Date("2026-09-25T00:00:00Z"),
  });
});

test("an unrecognized custom_data.plan value parses as null instead of being trusted verbatim", () => {
  const event = parsePaddleSubscriptionEvent({
    event_type: "subscription.updated",
    data: { id: "sub_1", status: "active", custom_data: { companyId: "c1", plan: "enterprise" } },
  });
  assert.equal(event.plan, null);
});

test("Paddle's paused/past_due statuses both map onto the single past_due bucket TrackFleet's gate checks", () => {
  const paused = parsePaddleSubscriptionEvent({ event_type: "subscription.updated", data: { id: "s1", status: "paused" } });
  const pastDue = parsePaddleSubscriptionEvent({ event_type: "subscription.updated", data: { id: "s1", status: "past_due" } });
  assert.equal(paused.status, "past_due");
  assert.equal(pastDue.status, "past_due");
});

test("an event with no custom_data.companyId parses with companyId null rather than throwing, so the caller can decide how to handle it", () => {
  const event = parsePaddleSubscriptionEvent({ event_type: "subscription.created", data: { id: "sub_1", status: "trialing" } });
  assert.equal(event.companyId, null);
  assert.equal(event.status, "trialing");
});

test("malformed payloads return null instead of throwing", () => {
  assert.equal(parsePaddleSubscriptionEvent(null), null);
  assert.equal(parsePaddleSubscriptionEvent({}), null);
  assert.equal(parsePaddleSubscriptionEvent({ event_type: "subscription.updated" }), null);
  assert.equal(parsePaddleSubscriptionEvent({ data: {} }), null);
});

test("only subscription lifecycle events are treated as access-changing", () => {
  assert.equal(isSubscriptionLifecycleEvent("subscription.created"), true);
  assert.equal(isSubscriptionLifecycleEvent("subscription.updated"), true);
  assert.equal(isSubscriptionLifecycleEvent("subscription.canceled"), true);
  assert.equal(isSubscriptionLifecycleEvent("transaction.completed"), false);
  assert.equal(isSubscriptionLifecycleEvent("customer.created"), false);
});

test("the webhook route reads the raw body before parsing, verifies the signature before trusting anything, and never processes an event without both a companyId and a mapped status", async () => {
  const route = await readFile(new URL("../app/api/webhooks/paddle/route.ts", import.meta.url), "utf8");
  const rawBodyIndex = route.indexOf("const rawBody = await request.text();");
  const verifyIndex = route.indexOf("verifyPaddleWebhookSignature(rawBody");
  const parseIndex = route.indexOf("JSON.parse(rawBody)");
  assert.ok(rawBodyIndex >= 0 && verifyIndex > rawBodyIndex && parseIndex > verifyIndex, "expected raw-body-read, then verify, then parse, in that order");
  assert.match(route, /if \(!event\.companyId \|\| !event\.status\)/);
});

test("the webhook route persists which plan the subscription is on, so notification-runner.ts can gate WhatsApp by tier", async () => {
  const route = await readFile(new URL("../app/api/webhooks/paddle/route.ts", import.meta.url), "utf8");
  assert.match(route, /plan: event\.plan,/);
});
