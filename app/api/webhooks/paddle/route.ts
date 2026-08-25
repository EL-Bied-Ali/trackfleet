import { runtimeEnv } from "trackfleet-runtime-env";
import {
  isSubscriptionLifecycleEvent,
  parsePaddleSubscriptionEvent,
  verifyPaddleWebhookSignature,
} from "../../../lib/paddle-webhook";
import { upsertSubscription } from "../../../lib/subscription-store";

const maxBodyBytes = 64 * 1024;

function json(body: Record<string, unknown>, status: number) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const secret = runtimeEnv.PADDLE_WEBHOOK_SECRET?.trim();
  if (!secret) return json({ error: "not_configured" }, 503);

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) return json({ error: "payload_too_large" }, 413);

  // Signature verification needs the exact raw bytes Paddle signed --
  // reading as text first, verifying, and only then JSON.parse-ing, rather
  // than letting the framework parse the body before it's been verified.
  const rawBody = await request.text();
  if (rawBody.length > maxBodyBytes) return json({ error: "payload_too_large" }, 413);

  const signatureHeader = request.headers.get("paddle-signature");
  const verified = await verifyPaddleWebhookSignature(rawBody, signatureHeader, secret);
  if (!verified) {
    console.error("[trackfleet:paddle] webhook signature verification failed");
    return json({ error: "invalid_signature" }, 401);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const event = parsePaddleSubscriptionEvent(payload);
  if (!event || !isSubscriptionLifecycleEvent(event.eventType)) {
    // Not a lifecycle event (or unparseable) -- acknowledged with 200 so
    // Paddle doesn't keep retrying something we deliberately don't act on.
    return json({ received: true }, 200);
  }

  if (!event.companyId || !event.status) {
    console.error("[trackfleet:paddle] subscription event missing companyId or status", {
      eventType: event.eventType,
      hasCompanyId: Boolean(event.companyId),
      hasStatus: Boolean(event.status),
    });
    return json({ received: true }, 200);
  }

  try {
    await upsertSubscription({
      companyId: event.companyId,
      status: event.status,
      plan: event.plan,
      paddleCustomerId: event.paddleCustomerId,
      paddleSubscriptionId: event.paddleSubscriptionId,
      currentPeriodEnd: event.currentPeriodEnd,
    });
  } catch (error) {
    console.error("[trackfleet:paddle] failed to update subscription from webhook", {
      message: error instanceof Error ? error.message : "unknown_error",
      companyId: event.companyId,
    });
    // A real 500 here makes Paddle retry the delivery -- appropriate for a
    // transient DB failure, unlike the "not applicable to us" cases above
    // which acknowledge with 200 on purpose.
    return json({ error: "storage_unavailable" }, 500);
  }

  console.info("[trackfleet:paddle] subscription updated from webhook", {
    eventType: event.eventType,
    companyId: event.companyId,
    status: event.status,
  });
  return json({ received: true }, 200);
}
