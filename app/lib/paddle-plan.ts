// Standard: email/SMS tracking only. Pro: WhatsApp customer notifications
// included -- see app/lib/notification-runner.ts, which gates automatic
// WhatsApp sends on this same plan value once a subscription is active.
//
// Deliberately its own file with no runtimeEnv dependency: both
// paddle-checkout.ts (which does depend on runtimeEnv, for reading price
// ids) and paddle-webhook.ts (which is imported directly in tests, and must
// stay resolvable from plain Node) need these, and paddle-webhook.ts must
// not pick up a transitive runtimeEnv dependency just to reuse this type.
export type PaddlePlan = "standard" | "pro";
export type PaddleInterval = "monthly" | "yearly";

export function isPaddlePlan(value: unknown): value is PaddlePlan {
  return value === "standard" || value === "pro";
}

export function isPaddleInterval(value: unknown): value is PaddleInterval {
  return value === "monthly" || value === "yearly";
}
