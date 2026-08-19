import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const [events, runner, route, manager, schema] = await Promise.all([
  readFile(new URL("../app/lib/delivery-events.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/notification-runner.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/deliveries/whatsapp-consent/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/SiteManager.tsx", import.meta.url), "utf8"),
  readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
]);

test("consent withdrawal is an internal persistent delivery event", () => {
  assert.match(events, /WHATSAPP_OPT_OUT/);
  assert.match(events, /whatsappConsentWithdrawn/);
  assert.match(events, /event !== "WHATSAPP_OPT_OUT"/);
  assert.match(schema, /"WHATSAPP_OPT_OUT"/);
});

test("automatic notifications stop after consent withdrawal", () => {
  assert.match(runner, /whatsappConsentWithdrawn\(deliveryEvents\)/);
  assert.match(runner, /markNotificationSent\(item\.delivery\.id, item\.event\.type\)/);
});

test("withdrawal endpoint is authenticated, tenant-scoped and origin protected", () => {
  assert.match(route, /requestIsSameOrigin\(request\)/);
  assert.match(route, /originRejectedResponse\(\)/);
  assert.match(route, /getCompanySession\(request\)/);
  assert.match(route, /listForCompany\(session\.companyId\)/);
  assert.match(route, /recordEvent\(delivery\.id, "WHATSAPP_OPT_OUT"/);
});

test("dashboard exposes consent management and withdrawal", () => {
  assert.match(manager, /Consentements WhatsApp/);
  assert.match(manager, /\/api\/deliveries\/whatsapp-consent/);
  assert.match(manager, /withdrawConsent/);
});
