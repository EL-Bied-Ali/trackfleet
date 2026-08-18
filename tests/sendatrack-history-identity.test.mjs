import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const sendatrackSource = fs.readFileSync(new URL("../app/lib/sendatrack.ts", import.meta.url), "utf8");
const normalizeSource = fs.readFileSync(new URL("../app/lib/sendatrack-normalize.ts", import.meta.url), "utf8");
const historySource = fs.readFileSync(new URL("../app/lib/sendatrack-history-live.ts", import.meta.url), "utf8");
const probeRouteSource = fs.readFileSync(new URL("../app/api/automation/sendatrack-history-probe-v2/route.ts", import.meta.url), "utf8");

test("legacy history account candidates are provider-bounded and prefer the OpenGTS account key", () => {
  const accountIndex = sendatrackSource.indexOf('add(vehicle.providerAccountId, "account")');
  const configuredIndex = sendatrackSource.indexOf('add(auth.accountID, "configured")');
  const descIndex = sendatrackSource.indexOf('add(findStringByKey(payload, "Account_desc"), "account_desc")');

  assert.ok(accountIndex >= 0, "provider Account must be considered");
  assert.ok(configuredIndex > accountIndex, "configured accountID must be the second candidate");
  assert.ok(descIndex > configuredIndex, "human-readable Account_desc must remain the last candidate");
  assert.match(sendatrackSource, /seen\.has\(normalized\)/, "duplicate account values must be deduplicated");
});

test("history identity uses logical Device and discovery stays bounded to confirmed endpoint family", () => {
  assert.match(normalizeSource, /providerDeviceId: stringFrom\(record\.Device, event\.Device, record\.DeviceCode/);
  assert.match(historySource, /identities\.slice\(0, 3\)/);
  assert.match(historySource, /\["eventsApp2", "events7", "eventsApp"\]/);
  assert.match(historySource, /userId: identity\.userId/);
  assert.match(historySource, /password: identity\.password/);
  assert.match(historySource, /deviceId: identity\.deviceId/);
  assert.match(historySource, /result\.status === 429/);
  assert.match(historySource, /attempts/);
});

test("history probe remains CRON_SECRET protected and never logs credential values", () => {
  assert.match(probeRouteSource, /runtimeEnv\.CRON_SECRET/);
  assert.match(probeRouteSource, /authorization/);
  assert.match(probeRouteSource, /usedPassword/);
  assert.equal(probeRouteSource.includes("result.password"), false);
  assert.equal(probeRouteSource.includes("identity.password"), false);
  assert.equal(probeRouteSource.includes("accountId"), false);
  assert.equal(probeRouteSource.includes("userId"), false);
});
