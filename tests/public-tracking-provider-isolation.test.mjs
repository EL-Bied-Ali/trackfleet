import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

async function publicTrackingBranch() {
  const source = await readFile(new URL("../app/api/deliveries/route.ts", import.meta.url), "utf8");
  const publicStart = source.indexOf('if (tracking) {');
  const authStart = source.indexOf('const session = await getCompanySession(request);', publicStart);
  assert.ok(publicStart >= 0 && authStart > publicStart);
  return source.slice(publicStart, authStart);
}

test("public tracking never refreshes SENDATRACK without tenant credentials", async () => {
  const publicBranch = await publicTrackingBranch();
  assert.equal(publicBranch.includes("getSendatrackSnapshot("), false);
  assert.equal(publicBranch.includes("applySendatrackSnapshot("), false);
});

test("public tracking is read-only and cannot trigger outbound notifications", async () => {
  const publicBranch = await publicTrackingBranch();
  assert.equal(publicBranch.includes("enrichAndDetectDelay("), false);
  assert.equal(publicBranch.includes("recordEvent("), false);
  assert.equal(publicBranch.includes("processPendingNotifications("), false);
  assert.equal(publicBranch.includes("enrichDelivery("), true);
});
