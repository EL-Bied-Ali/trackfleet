import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const sendatrackSource = fs.readFileSync(new URL("../app/lib/sendatrack.ts", import.meta.url), "utf8");
const normalizeSource = fs.readFileSync(new URL("../app/lib/sendatrack-normalize.ts", import.meta.url), "utf8");
const historySource = fs.readFileSync(new URL("../app/lib/sendatrack-history-live.ts", import.meta.url), "utf8");

test("legacy history account candidates are provider-bounded and prefer the OpenGTS account key", () => {
  const accountIndex = sendatrackSource.indexOf('add(vehicle.providerAccountId, "account")');
  const configuredIndex = sendatrackSource.indexOf('add(auth.accountID, "configured")');
  const descIndex = sendatrackSource.indexOf('add(findStringByKey(payload, "Account_desc"), "account_desc")');

  assert.ok(accountIndex >= 0, "provider Account must be considered");
  assert.ok(configuredIndex > accountIndex, "configured accountID must be the second candidate");
  assert.ok(descIndex > configuredIndex, "human-readable Account_desc must remain the last candidate");
  assert.match(sendatrackSource, /seen\.has\(normalized\)/, "duplicate account values must be deduplicated");
});

test("history identity keeps logical Device separate from shared DeviceCode", () => {
  assert.match(normalizeSource, /const providerDeviceId = stringFrom\(record\.Device, event\.Device\)/);
  assert.match(normalizeSource, /const providerDeviceCode = stringFrom\(record\.DeviceCode, event\.DeviceCode\)/);
  assert.match(normalizeSource, /providerDeviceId: providerDeviceId \|\| id/);
  assert.doesNotMatch(normalizeSource, /providerDeviceId = stringFrom\([^\n]*DeviceCode/);
  assert.match(historySource, /identities\.slice\(0, 3\)/);
  assert.match(historySource, /\["eventsApp2", "events7", "eventsApp"\]/);
  assert.match(historySource, /userId: identity\.userId/);
  assert.match(historySource, /password: identity\.password/);
  assert.match(historySource, /deviceId: identity\.deviceId/);
  assert.match(historySource, /result\.status === 429/);
  assert.match(historySource, /attempts/);
});

test("legacy history never sends a password over plaintext HTTP", () => {
  assert.match(historySource, /identity\.password && target\.protocol !== "https:"/);
  assert.match(historySource, /history_insecure_transport_blocked/);
  const guardIndex = historySource.indexOf('identity.password && target.protocol !== "https:"');
  const fetchIndex = historySource.indexOf("const response = await fetch(url");
  assert.ok(guardIndex >= 0 && fetchIndex > guardIndex, "transport guard must run before the network request");
});

test("legacy history diagnostics never log credential-bearing URLs", () => {
  assert.doesNotMatch(historySource, /console\.(?:log|info|warn|error)\([^\n]*url/);
  assert.doesNotMatch(historySource, /console\.(?:log|info|warn|error)\([^\n]*password/);
});
