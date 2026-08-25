import type { SubscriptionStatus } from "./subscription-store";
import { isPaddlePlan } from "./paddle-plan.ts";

// Paddle sends `Paddle-Signature: ts=<unix seconds>;h1=<hex hmac>`, computed
// as HMAC-SHA256 over `${ts}:${rawBody}` with the webhook's own secret key
// (per Paddle's docs -- distinct from the API key, and distinct from the
// client-side token used by Paddle.js in the browser). Verified against the
// RAW body text, before any JSON.parse -- re-serializing and re-hashing a
// parsed-then-stringified body is not guaranteed to reproduce the exact
// bytes Paddle signed.
function timingSafeEqualHex(a: string, b: string) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return difference === 0;
}

async function hmacSha256Hex(secret: string, message: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// The HMAC comparison is what actually authenticates the payload -- this
// window is only a replay-staleness guard against network/queue delay, so
// it's deliberately more generous than Paddle's own SDKs' tight default
// rather than risking false rejections of a genuine, slightly-delayed
// delivery.
const timestampToleranceSeconds = 300;

export async function verifyPaddleWebhookSignature(rawBody: string, signatureHeader: string | null, secret: string): Promise<boolean> {
  if (!signatureHeader || !secret) return false;
  const parts = new Map(signatureHeader.split(";").map((part) => {
    const [key, value] = part.split("=");
    return [key, value] as const;
  }));
  const timestamp = parts.get("ts");
  const signature = parts.get("h1");
  if (!timestamp || !signature) return false;
  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds) || Math.abs(Date.now() / 1000 - timestampSeconds) > timestampToleranceSeconds) return false;
  const expected = await hmacSha256Hex(secret, `${timestamp}:${rawBody}`);
  return timingSafeEqualHex(expected, signature);
}

export type PaddleSubscriptionEvent = {
  eventType: string;
  companyId: string | null;
  plan: string | null;
  paddleCustomerId: string | null;
  paddleSubscriptionId: string | null;
  status: SubscriptionStatus | null;
  currentPeriodEnd: Date | null;
};

// Paddle's own subscription statuses -- mapped onto TrackFleet's smaller set
// (see subscription-store.ts). "paused" and "past_due" both land on
// "past_due" here: either way the company should lose access, and there's
// no product need yet to tell those two apart in the gate itself.
const paddleStatusMap: Record<string, SubscriptionStatus> = {
  active: "active",
  trialing: "trialing",
  past_due: "past_due",
  paused: "past_due",
  canceled: "canceled",
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

// The company a subscription belongs to travels in `custom_data`, set once
// when the checkout transaction is created server-side (see
// paddle-checkout.ts) -- never trust a company id supplied by the client
// itself, only what Paddle echoes back on its own signed webhook payload.
export function parsePaddleSubscriptionEvent(payload: unknown): PaddleSubscriptionEvent | null {
  const root = asRecord(payload);
  const eventType = root?.event_type;
  const data = asRecord(root?.data);
  if (typeof eventType !== "string" || !data) return null;

  const customData = asRecord(data.custom_data);
  const companyId = typeof customData?.companyId === "string" ? customData.companyId : null;
  const plan = isPaddlePlan(customData?.plan) ? customData.plan : null;
  const paddleSubscriptionId = typeof data.id === "string" ? data.id : null;
  const paddleCustomerId = typeof data.customer_id === "string" ? data.customer_id : null;
  const rawStatus = typeof data.status === "string" ? data.status : null;
  const status = rawStatus ? paddleStatusMap[rawStatus] ?? null : null;
  const billingPeriod = asRecord(data.current_billing_period);
  const endsAt = typeof billingPeriod?.ends_at === "string" ? new Date(billingPeriod.ends_at) : null;

  return {
    eventType,
    companyId,
    plan,
    paddleCustomerId,
    paddleSubscriptionId,
    status,
    currentPeriodEnd: endsAt && !Number.isNaN(endsAt.getTime()) ? endsAt : null,
  };
}

// Only subscription lifecycle events actually change access -- everything
// else Paddle sends (transaction.*, customer.*, address.* ...) is
// acknowledged with a 200 so Paddle doesn't keep retrying, but doesn't
// touch the subscriptions table.
export function isSubscriptionLifecycleEvent(eventType: string) {
  return eventType === "subscription.created" || eventType === "subscription.updated" || eventType === "subscription.canceled";
}
