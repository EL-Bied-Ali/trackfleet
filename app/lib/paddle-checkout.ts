import { runtimeEnv } from "trackfleet-runtime-env";

const requestTimeoutMs = 10_000;

function paddleApiBase() {
  // Defaults to sandbox on purpose -- an unset/misconfigured environment
  // must never silently point at live and risk a real charge before this
  // has been deliberately switched over.
  return runtimeEnv.PADDLE_ENVIRONMENT?.trim() === "live"
    ? "https://api.paddle.com"
    : "https://sandbox-api.paddle.com";
}

export function paddleCheckoutConfigured() {
  return Boolean(runtimeEnv.PADDLE_API_KEY?.trim() && runtimeEnv.PADDLE_PRICE_ID?.trim());
}

// custom_data.companyId is how the webhook later knows which TrackFleet
// company a Paddle subscription belongs to (see paddle-webhook.ts) -- set
// here, server-side, from the authenticated session's own companyId, so it
// can never be spoofed by a client-supplied value.
export async function createPaddleCheckout(companyId: string): Promise<{ url: string } | null> {
  const apiKey = runtimeEnv.PADDLE_API_KEY?.trim();
  const priceId = runtimeEnv.PADDLE_PRICE_ID?.trim();
  if (!apiKey || !priceId) return null;

  const response = await fetch(`${paddleApiBase()}/transactions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      items: [{ price_id: priceId, quantity: 1 }],
      custom_data: { companyId },
    }),
    signal: AbortSignal.timeout(requestTimeoutMs),
  });

  if (!response.ok) {
    console.error("[trackfleet:paddle] checkout transaction creation failed", { status: response.status });
    return null;
  }

  const body = await response.json() as { data?: { checkout?: { url?: string } } };
  const url = body.data?.checkout?.url;
  return url ? { url } : null;
}
