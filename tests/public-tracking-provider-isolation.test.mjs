import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("public tracking never refreshes SENDATRACK without tenant credentials", async () => {
  const source = await readFile(new URL("../app/api/deliveries/route.ts", import.meta.url), "utf8");
  const publicStart = source.indexOf('if (tracking) {');
  const authStart = source.indexOf('const session = await getCompanySession(request);', publicStart);
  assert.ok(publicStart >= 0 && authStart > publicStart);
  const publicBranch = source.slice(publicStart, authStart);
  assert.equal(publicBranch.includes("getSendatrackSnapshot("), false);
  assert.equal(publicBranch.includes("applySendatrackSnapshot("), false);
});
