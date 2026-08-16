import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const previewRoute = fs.readFileSync(new URL("../app/api/whatsapp/preview/route.ts", import.meta.url), "utf8");
const automation = fs.readFileSync(new URL("../app/lib/whatsapp-automation.ts", import.meta.url), "utf8");

test("WhatsApp preview requires an authenticated company session", () => {
  assert.match(previewRoute, /getCompanySession\(request\)/);
  assert.match(previewRoute, /authentication_required/);
  assert.match(previewRoute, /status:\s*401/);
});

test("WhatsApp preview is a read-only dry run", () => {
  assert.doesNotMatch(previewRoute, /claimNotification\s*\(/);
  assert.doesNotMatch(previewRoute, /markNotificationSent\s*\(/);
  assert.doesNotMatch(previewRoute, /releaseNotification\s*\(/);
  assert.doesNotMatch(previewRoute, /method:\s*["']POST["']/);
  assert.doesNotMatch(previewRoute, /\/messages/);
  assert.match(previewRoute, /dryRun:\s*true/);
});

test("preview and real sending use the same payload builder", () => {
  assert.match(previewRoute, /buildAutomaticWhatsAppPayload/);
  assert.match(automation, /export function buildAutomaticWhatsAppPayload/);
  assert.match(automation, /const built = buildAutomaticWhatsAppPayload\(event, delivery, trackingUrl\)/);
  assert.match(automation, /body:\s*JSON\.stringify\(built\.payload\)/);
});

test("preview masks customer phone numbers", () => {
  assert.match(previewRoute, /maskRecipient/);
  assert.match(previewRoute, /value\.slice\(-4\)/);
  assert.doesNotMatch(previewRoute, /recipient:\s*built\.payload\.to[,\n]/);
});
