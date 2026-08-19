import assert from "node:assert/strict";
import test from "node:test";
import { D1_STANDBY_MAX_SYNC_AGE_MS, getD1StandbyReadiness } from "../app/lib/d1-standby-readiness.ts";

function dbReturning(row) {
  return {
    prepare() {
      return { first: async () => row };
    },
  };
}

const now = 2_000_000_000_000;
const fresh = now - 5 * 60_000;

test("standby is ready only when both replication streams are fresh and history is complete", async () => {
  const result = await getD1StandbyReadiness(dbReturning({
    operational_success_at: fresh,
    operational_failure_at: null,
    telemetry_success_at: fresh,
    telemetry_failure_at: null,
    company_count: 2,
    completed_company_count: 2,
    incomplete_company_count: 0,
  }), now);
  assert.equal(result.ready, true);
  assert.equal(result.reason, "ready");
  assert.equal(result.history.complete, true);
});

test("a newer failed maintenance run makes an otherwise fresh standby stale", async () => {
  const result = await getD1StandbyReadiness(dbReturning({
    operational_success_at: fresh,
    operational_failure_at: fresh + 1,
    telemetry_success_at: fresh,
    telemetry_failure_at: null,
    company_count: 1,
    completed_company_count: 1,
    incomplete_company_count: 0,
  }), now);
  assert.equal(result.ready, false);
  assert.equal(result.reason, "replication_stale");
  assert.equal(result.operationalFresh, false);
});

test("a successful replication older than the freshness window is stale", async () => {
  const old = now - D1_STANDBY_MAX_SYNC_AGE_MS - 1;
  const result = await getD1StandbyReadiness(dbReturning({
    operational_success_at: old,
    operational_failure_at: null,
    telemetry_success_at: fresh,
    telemetry_failure_at: null,
    company_count: 1,
    completed_company_count: 1,
    incomplete_company_count: 0,
  }), now);
  assert.equal(result.ready, false);
  assert.equal(result.reason, "replication_stale");
});

test("fresh replication still stays unready while historical backfill is incomplete", async () => {
  const result = await getD1StandbyReadiness(dbReturning({
    operational_success_at: fresh,
    operational_failure_at: null,
    telemetry_success_at: fresh,
    telemetry_failure_at: null,
    company_count: 2,
    completed_company_count: 1,
    incomplete_company_count: 1,
  }), now);
  assert.equal(result.ready, false);
  assert.equal(result.reason, "history_backfill_incomplete");
});

test("standby does not become ready before both reconciliation streams have run", async () => {
  const result = await getD1StandbyReadiness(dbReturning({
    operational_success_at: null,
    operational_failure_at: null,
    telemetry_success_at: null,
    telemetry_failure_at: null,
    company_count: 0,
    completed_company_count: 0,
    incomplete_company_count: 0,
  }), now);
  assert.equal(result.ready, false);
  assert.equal(result.reason, "replication_not_started");
});
