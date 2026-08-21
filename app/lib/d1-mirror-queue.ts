import { runtimeEnv } from "trackfleet-runtime-env";

// D1 mirroring in shared-postgres mode used to issue one db.prepare().run()
// subrequest per mirrored record. A single automation tick easily mirrors
// 15-20+ records (one fleet position per vehicle, plus ETA observations,
// trip positions and delivery/event updates per delivery) on top of the
// equivalent Postgres writes and everything else the tick does -- reliably
// exceeding Cloudflare's per-invocation subrequest limit and tripping the
// D1 read-only failover safety net app-wide, confirmed live via wrangler
// tail. D1's batch() API exists exactly for this: bundle many prepared
// statements into one round trip instead of one subrequest each. Postgres
// (the actual source of truth) is untouched by this -- only the D1 mirror,
// which is already best-effort and periodically fully reconciled by the
// */15 cron (see d1-reconciliation.ts), is deferred and batched.
//
// Trade-off worth knowing: batch() runs as one implicit transaction, so a
// single bad statement rolls back everything queued alongside it, whereas
// today one failing mirror write doesn't affect the others. Given these are
// already non-authoritative, self-healing-via-reconciliation writes, that's
// an acceptable trade for the subrequest savings.
type D1MirrorStatement = {
  bind(...values: unknown[]): D1MirrorStatement;
  run(): Promise<unknown>;
};

type D1MirrorBinding = {
  prepare(query: string): D1MirrorStatement;
  batch(statements: D1MirrorStatement[]): Promise<unknown>;
};

function d1() {
  return (runtimeEnv as unknown as { DB?: D1MirrorBinding }).DB ?? null;
}

let pending: D1MirrorStatement[] = [];

export function d1MirrorBinding() {
  return d1();
}

export function queueD1Mirror(statement: D1MirrorStatement) {
  pending.push(statement);
}

export async function flushD1MirrorQueue() {
  if (pending.length === 0) return;
  const batch = pending;
  pending = [];
  const db = d1();
  if (!db) return;
  try {
    await db.batch(batch);
  } catch (error) {
    console.error("[trackfleet:replication] D1 mirror batch flush failed", {
      message: error instanceof Error ? error.message : "unknown_error",
      statementCount: batch.length,
    });
  }
}
