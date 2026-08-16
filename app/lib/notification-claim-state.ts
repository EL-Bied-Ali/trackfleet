export type NotificationClaim = { attemptedAt: number; sent: boolean };

export class NotificationClaimState {
  private readonly claims = new Map<string, NotificationClaim>();
  private readonly retryAfterMs: number;

  constructor(retryAfterMs = 5 * 60_000) {
    this.retryAfterMs = retryAfterMs;
  }

  isPending(key: string, now = Date.now()) {
    const claim = this.claims.get(key);
    if (!claim) return true;
    if (claim.sent) return false;
    return now - claim.attemptedAt >= this.retryAfterMs;
  }

  claim(key: string, now = Date.now()) {
    const existing = this.claims.get(key);
    if (existing?.sent) return false;
    if (existing && now - existing.attemptedAt < this.retryAfterMs) return false;
    this.claims.set(key, { attemptedAt: now, sent: false });
    return true;
  }

  markSent(key: string, now = Date.now()) {
    this.claims.set(key, { attemptedAt: now, sent: true });
  }

  release(key: string) {
    if (!this.claims.get(key)?.sent) this.claims.delete(key);
  }
}
