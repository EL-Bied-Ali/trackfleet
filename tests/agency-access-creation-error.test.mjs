import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const siteManager = fs.readFileSync("app/SiteManager.tsx", "utf8");

test("a clipboard or prompt failure never reports agency access as failed to create", () => {
  // Regression guard, reproduced live: the dispatcher clicked "Agency
  // access", the enrollment link was genuinely created by the server (a
  // valid, usable link), but the browser's clipboard write failed (this can
  // happen for reasons outside the app's control, e.g. the document losing
  // focus at the moment of the click) and the window.prompt fallback also
  // didn't complete cleanly. Both were caught by the SAME outer try/catch as
  // the actual creation request, so any UI-delivery failure after a
  // successful creation surfaced as "Could not create agency access." --
  // actively misleading, since access had in fact been created.
  const createFn = siteManager.slice(siteManager.indexOf("async function createAgencyAccess"));
  const body = createFn.slice(0, createFn.indexOf("\n  const copy ="));

  // The clipboard write and its prompt fallback must be in their own nested
  // try/catch, separate from the outer one that guards the actual creation
  // request -- so a UI-delivery failure can never be reported as a creation
  // failure.
  const clipboardTryIndex = body.indexOf("await navigator.clipboard.writeText(data.enrollmentUrl);");
  const promptIndex = body.indexOf("window.prompt(copy.accessCopyFallback, data.enrollmentUrl);");
  const outerCatchIndex = body.indexOf("setAccessMessage(copy.accessError);");
  assert.ok(clipboardTryIndex > 0 && promptIndex > clipboardTryIndex && outerCatchIndex > promptIndex,
    "expected clipboard write, then prompt fallback, then the outer creation-failure catch, in that order");

  // The prompt fallback itself must also be wrapped in its own try/catch
  // (window.prompt can throw, e.g. in a sandboxed/embedded context without
  // allow-modals) -- if it isn't, that failure would still incorrectly
  // reach the outer catch.
  const promptTryCatch = body.slice(clipboardTryIndex, outerCatchIndex);
  assert.match(promptTryCatch, /try\s*\{\s*window\.prompt\(copy\.accessCopyFallback, data\.enrollmentUrl\);\s*\}\s*catch/);

  // Even if every UI-delivery path fails, the already-created link must
  // still reach the dispatcher somehow, not just vanish behind a generic
  // error.
  assert.match(promptTryCatch, /setAccessMessage\(`\$\{copy\.accessCopyFallback\}: \$\{data\.enrollmentUrl\}`\)/);
});
