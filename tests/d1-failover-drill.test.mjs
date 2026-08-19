import assert from "node:assert/strict";
import test from "node:test";
import {
  executeReadFailover,
  resolveD1ReadFailoverConfigured,
  shouldBlockMutationDuringReadFailover,
} from "../app/lib/d1-read-failover-policy.ts";

test("Cloudflare permits readiness-gated failover by default while Vercel does not", () => {
  assert.equal(resolveD1ReadFailoverConfigured(undefined, "cloudflare"), true);
  assert.equal(resolveD1ReadFailoverConfigured("", "cloudflare"), true);
  assert.equal(resolveD1ReadFailoverConfigured(undefined, "vercel"), false);
  assert.equal(resolveD1ReadFailoverConfigured("false", "cloudflare"), false);
  assert.equal(resolveD1ReadFailoverConfigured("true", "cloudflare"), true);
});

test("healthy primary never touches D1 standby", async () => {
  let approvals = 0;
  let standbyReads = 0;
  const result = await executeReadFailover({
    primaryRead: async () => "postgres",
    approveFailover: async () => { approvals += 1; return true; },
    standbyRead: async () => { standbyReads += 1; return "d1"; },
  });

  assert.equal(result, "postgres");
  assert.equal(approvals, 0);
  assert.equal(standbyReads, 0);
});

test("simulated Postgres outage serves D1 only after readiness approval", async () => {
  const primaryError = new Error("simulated_neon_unavailable");
  let standbyReads = 0;
  let failoverObserved = false;

  const result = await executeReadFailover({
    primaryRead: async () => { throw primaryError; },
    approveFailover: async () => true,
    standbyRead: async () => { standbyReads += 1; return "d1-standby"; },
    onFailover(error) { failoverObserved = error === primaryError; },
  });

  assert.equal(result, "d1-standby");
  assert.equal(standbyReads, 1);
  assert.equal(failoverObserved, true);
});

test("simulated Postgres outage does not fall back when D1 is not ready", async () => {
  const primaryError = new Error("simulated_neon_unavailable");
  let standbyReads = 0;

  await assert.rejects(() => executeReadFailover({
    primaryRead: async () => { throw primaryError; },
    approveFailover: async () => false,
    standbyRead: async () => { standbyReads += 1; return "should-not-run"; },
  }), (error) => error === primaryError);

  assert.equal(standbyReads, 0);
});

test("standby failure preserves the original primary outage error", async () => {
  const primaryError = new Error("simulated_neon_unavailable");
  const standbyError = new Error("simulated_d1_unavailable");
  let observedStandbyError = false;

  await assert.rejects(() => executeReadFailover({
    primaryRead: async () => { throw primaryError; },
    approveFailover: async () => true,
    standbyRead: async () => { throw standbyError; },
    onStandbyFailure(primary, standby) {
      observedStandbyError = primary === primaryError && standby === standbyError;
    },
  }), (error) => error === primaryError);

  assert.equal(observedStandbyError, true);
});

test("active read-only lease blocks mutations but keeps reads available", () => {
  assert.equal(shouldBlockMutationDuringReadFailover("GET", true), false);
  assert.equal(shouldBlockMutationDuringReadFailover("HEAD", true), false);
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    assert.equal(shouldBlockMutationDuringReadFailover(method, true), true);
  }
  assert.equal(shouldBlockMutationDuringReadFailover("POST", false), false);
});
