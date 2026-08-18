import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const sendatrackSource = fs.readFileSync(new URL("../app/lib/sendatrack.ts", import.meta.url), "utf8");
const historySource = fs.readFileSync(new URL("../app/lib/sendatrack-history-live.ts", import.meta.url), "utf8");

test("legacy history account candidates are provider-bounded and ordered", () => {
  const descIndex = sendatrackSource.indexOf('add(findStringByKey(payload, "Account_desc"), "account_desc")');
  const accountFallbackIndex = sendatrackSource.indexOf('add(vehicle.providerAccountId, "account")');
  const configuredFallbackIndex = sendatrackSource.indexOf('add(auth.accountID, "configured")');

  assert.ok(descIndex >= 0, "Account_desc candidate must be read from the authenticated fleet payload");
  assert.ok(accountFallbackIndex > descIndex, "Account must remain after Account_desc");
  assert.ok(configuredFallbackIndex > accountFallbackIndex, "configured accountID must remain the final candidate");
  assert.match(sendatrackSource, /seen\.has\(normalized\)/, "duplicate account values must be deduplicated");
});

test("history discovery stays bounded and only falls back to the APK eventsApp endpoint after account errors", () => {
  assert.match(historySource, /identities\.slice\(0, 3\)/);
  assert.match(historySource, /\/\\\(account\\\)\/i\.test/);
  assert.match(historySource, /replace\("\/events7\/", "\/eventsApp\/"\)/);
  assert.match(historySource, /userId: identity\.userId/);
  assert.match(historySource, /attempts/);
});
