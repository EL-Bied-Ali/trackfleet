import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../app/lib/sendatrack.ts", import.meta.url), "utf8");

test("SENDATRACK snapshot retries transient provider failures only once", () => {
  assert.match(source, /const snapshotMaxAttempts = 2;/);
  assert.match(source, /const snapshotRetryDelayMs = 750;/);
  assert.match(source, /attempt <= snapshotMaxAttempts/);
  assert.match(source, /attempt < snapshotMaxAttempts && retryableSnapshotError\(code\)/);
  assert.match(source, /code === "authentication_failed" \|\| code === "service_unavailable" \|\| code === "unexpected_response"/);
});

test("retry clears cached authentication state and remains bounded", () => {
  assert.match(source, /await deleteCachedToken\(credentialKey\(auth\)\);/);
  assert.match(source, /await waitBeforeSnapshotRetry\(\);/);
  assert.match(source, /snapshot failed.*attempts: attempt/s);
  assert.doesNotMatch(source, /while\s*\(true\)/);
});

test("the whole snapshot call (every attempt, every within-attempt auth retry) shares one wall-clock deadline instead of each fetch getting its own fresh allowance", () => {
  // Two attempts, each with an inner auth-retry, each doing a login + a
  // list call -- if every one of those got its own independent 12s
  // timeout, worst case ran past a minute, long enough for Cloudflare's
  // own platform-level cancellation to kill the whole invocation before
  // this function's own graceful "service_unavailable" return could ever
  // fire (observed live: a real production request canceled by the
  // platform at ~20s wall time with ~8ms CPU used -- a hung-upstream
  // failure mode, not a CPU/resource-limit one).
  assert.match(source, /const snapshotOverallTimeoutMs = 15_000;/);
  assert.match(source, /const signal = AbortSignal\.timeout\(snapshotOverallTimeoutMs\);/);
  // login/requestFleetPayload/requestFleet all take the shared signal as a
  // parameter now, not a per-call AbortSignal.timeout(12_000) of their own.
  assert.match(source, /async function login\(auth: SendatrackCredentials, signal: AbortSignal\)/);
  assert.match(source, /async function requestFleetPayload\(token: string, auth: SendatrackCredentials, signal: AbortSignal\)/);
  assert.match(source, /async function requestFleet\(token: string, auth: SendatrackCredentials, signal: AbortSignal\)/);
  assert.doesNotMatch(source, /AbortSignal\.timeout\(12_000\)/);
  // Every login/requestFleet call site (both attempts, both the initial
  // and the within-attempt auth-retry call) threads the same `signal`
  // variable through -- not a fresh one per call.
  const callSites = [...source.matchAll(/(?:login|requestFleet(?:Payload)?)\(\s*(?:auth|token,\s*auth)\s*,\s*signal\s*\)/g)];
  assert.ok(callSites.length >= 5, `expected every login/requestFleet call site to pass the shared signal, found ${callSites.length}`);
});
