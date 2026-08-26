import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { automaticWhatsAppBodyMessage } from "../app/lib/whatsapp-message.ts";

// Incident (2026-08-26): every automatic WhatsApp send was failing with a
// Meta Graph API 400, confirmed live via wrangler tail against production.
// Root cause: Meta's Cloud API rejects a template body parameter that
// contains a raw URL (an anti-phishing restriction) -- REGISTERED and most
// other events always embedded the tracking link directly in the body
// text. ARRIVED had appeared to work because it only includes a link when
// a price is set, so unpriced ARRIVED sends never hit the bug. Fixed by
// moving the tracking link out of the body entirely, into the template's
// dynamic URL button component instead (see buildAutomaticWhatsAppPayload
// in whatsapp-automation.ts).

const sampleDelivery = { id: "TF-1", destination: "Casablanca" };

test("automaticWhatsAppBodyMessage never embeds a URL, for any customer-facing event -- this is the exact defect that broke every automatic send", () => {
  for (const event of ["REGISTERED", "DEPARTED", "PROGRESS_25", "PROGRESS_50", "PROGRESS_75", "NEAR_DESTINATION", "DELAY_DETECTED", "ARRIVED_AT_SITE", "ARRIVED"]) {
    const text = automaticWhatsAppBodyMessage(event, sampleDelivery);
    assert.doesNotMatch(text, /https?:\/\//, `${event}'s WhatsApp body text must not contain a URL`);
  }
});

test("automaticWhatsAppBodyMessage still produces real, non-empty status text for every customer-facing event", () => {
  for (const event of ["REGISTERED", "DEPARTED", "PROGRESS_25", "PROGRESS_50", "PROGRESS_75", "NEAR_DESTINATION", "DELAY_DETECTED", "ARRIVED_AT_SITE", "ARRIVED"]) {
    assert.ok(automaticWhatsAppBodyMessage(event, sampleDelivery).length > 0, `${event} must still produce body text`);
  }
});

test("a priced arrival still states the amount in the URL-free body text, without restating the tracking link", () => {
  const priced = automaticWhatsAppBodyMessage("ARRIVED", { ...sampleDelivery, priceAmount: 150, priceCurrency: "MAD" });
  assert.match(priced, /150\.00 MAD/);
  assert.doesNotMatch(priced, /https?:\/\//);
});

// whatsapp-automation.ts imports trackfleet-runtime-env, whose bare
// specifier only resolves under Vite/vinext's aliasing -- unresolvable from
// plain Node (matching this repo's established pattern), so its wiring is
// exercised via source-text assertions.
const whatsappAutomation = await readFile(new URL("../app/lib/whatsapp-automation.ts", import.meta.url), "utf8");

test("the tracking link travels as the template's dynamic URL button parameter, not as body text -- and only the token (not the full URL) is sent, since the button's base URL is configured once in the approved Meta template", () => {
  assert.match(whatsappAutomation, /import \{ automaticWhatsAppBodyMessage \} from "\.\/whatsapp-message";/);
  assert.match(whatsappAutomation, /const message = automaticWhatsAppBodyMessage\(event, delivery\);/);
  assert.match(whatsappAutomation, /type: "button";\s*\n\s*sub_type: "url";\s*\n\s*index: "0";/);
  assert.match(whatsappAutomation, /parameters: \[\{ type: "text", text: delivery\.trackingToken \}\],/);
  assert.doesNotMatch(whatsappAutomation, /automaticWhatsAppMessage\(event, delivery/);
});

test("buildAutomaticWhatsAppPayload and sendAutomaticWhatsAppNotification no longer take a trackingUrl parameter -- the token comes straight from delivery.trackingToken, and a missing token is refused up front", () => {
  assert.match(whatsappAutomation, /export function buildAutomaticWhatsAppPayload\(\s*\n\s*event: DeliveryEventType,\s*\n\s*delivery: DeliveryRow,\s*\n\)/);
  assert.match(whatsappAutomation, /export async function sendAutomaticWhatsAppNotification\(\s*\n\s*event: DeliveryEventType,\s*\n\s*delivery: DeliveryRow,\s*\n\)/);
  assert.match(whatsappAutomation, /if \(!delivery\.trackingToken\) return \{ payload: null, reason: "recipient_missing" \};/);
});

test("email keeps the tracking link inline in its own body text -- email has no anti-phishing URL restriction, so automaticWhatsAppMessage (URL included) is still exactly what it uses", async () => {
  const emailAutomation = await readFile(new URL("../app/lib/email-automation.ts", import.meta.url), "utf8");
  assert.match(emailAutomation, /import \{ automaticWhatsAppMessage \} from "\.\/whatsapp-message";/);
  assert.match(emailAutomation, /const message = automaticWhatsAppMessage\(event, delivery, trackingUrl\);/);
});
