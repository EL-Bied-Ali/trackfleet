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

  // Deliberately a no-op: deleting the claim here would let a permanently
  // failing send (e.g. an expired provider token) be retried on literally
  // the very next call instead of after retryAfterMs, since claim()'s own
  // stale-reclaim check has nothing left to compare against once the entry
  // is gone. Leaving the claim in place lets that existing check govern
  // retry timing correctly.
  release(_key: string) {}
}
