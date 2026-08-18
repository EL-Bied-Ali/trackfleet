import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const sendatrackSource = fs.readFileSync(new URL("../app/lib/sendatrack.ts", import.meta.url), "utf8");
const historySource = fs.readFileSync(new URL("../app/lib/sendatrack-history-live.ts", import.meta.url), "utf8");

test("legacy history identity prefers Account_desc without exposing its value", () => {
  const descIndex = sendatrackSource.indexOf('findStringByKey(payload, "Account_desc")');
  const accountFallbackIndex = sendatrackSource.indexOf("vehicle.providerAccountId");
  const configuredFallbackIndex = sendatrackSource.indexOf("accountId: auth.accountID");

  assert.ok(descIndex >= 0, "Account_desc candidate must be read from the authenticated fleet payload");
  assert.ok(accountFallbackIndex > descIndex, "Account must remain a fallback after Account_desc");
  assert.ok(configuredFallbackIndex > accountFallbackIndex, "configured accountID must remain the final fallback");
  assert.match(historySource, /accountSource/);
  assert.equal(historySource.includes("identity.accountId,"), true);
});
