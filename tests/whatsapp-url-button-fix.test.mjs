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

// Live audit finding: a shipment's representative send now carries the
// group's true size (see groupActionableByShipment in notification-policy.ts)
// so the other parcels aren't silently dropped from what the customer sees.
test("automaticWhatsAppBodyMessage mentions the linked-parcel count only when the parcel isn't traveling alone, same wording as the inbound-reply flow", () => {
  const solo = automaticWhatsAppBodyMessage("REGISTERED", sampleDelivery);
  assert.doesNotMatch(solo, /colis liés/);
  const soloExplicit = automaticWhatsAppBodyMessage("REGISTERED", sampleDelivery, 1);
  assert.doesNotMatch(soloExplicit, /colis liés/);
  const grouped = automaticWhatsAppBodyMessage("REGISTERED", sampleDelivery, 3);
  assert.match(grouped, /\(3 colis liés à cet envoi\)/);
});

// whatsapp-automation.ts imports trackfleet-runtime-env, whose bare
// specifier only resolves under Vite/vinext's aliasing -- unresolvable from
// plain Node (matching this repo's established pattern), so its wiring is
// exercised via source-text assertions.
const whatsappAutomation = await readFile(new URL("../app/lib/whatsapp-automation.ts", import.meta.url), "utf8");

test("the tracking link travels as the template's dynamic URL button parameter, not as body text -- and only the token (not the full URL) is sent, since the button's base URL is configured once in the approved Meta template", () => {
  assert.match(whatsappAutomation, /import \{ automaticWhatsAppBodyMessage \} from "\.\/whatsapp-message";/);
  assert.match(whatsappAutomation, /const message = automaticWhatsAppBodyMessage\(event, delivery, parcelCount\);/);
  assert.match(whatsappAutomation, /type: "button";\s*\n\s*sub_type: "url";\s*\n\s*index: "0";/);
  assert.match(whatsappAutomation, /parameters: \[\{ type: "text", text: delivery\.trackingToken \}\],/);
  assert.doesNotMatch(whatsappAutomation, /automaticWhatsAppMessage\(event, delivery/);
});

test("buildAutomaticWhatsAppPayload and sendAutomaticWhatsAppNotification no longer take a trackingUrl parameter -- the token comes straight from delivery.trackingToken, and a missing token is refused up front", () => {
  assert.match(whatsappAutomation, /export function buildAutomaticWhatsAppPayload\(\s*\n\s*event: DeliveryEventType,\s*\n\s*delivery: DeliveryRow,\s*\n\s*parcelCount = 1,\s*\n\)/);
  assert.match(whatsappAutomation, /export async function sendAutomaticWhatsAppNotification\(\s*\n\s*event: DeliveryEventType,\s*\n\s*delivery: DeliveryRow,\s*\n\s*parcelCount = 1,\s*\n\)/);
  assert.match(whatsappAutomation, /if \(!delivery\.trackingToken\) return \{ payload: null, reason: "recipient_missing" \};/);
});

test("email keeps the tracking link inline in its own body text -- email has no anti-phishing URL restriction, so automaticWhatsAppMessage (URL included) is still exactly what it uses", async () => {
  const emailAutomation = await readFile(new URL("../app/lib/email-automation.ts", import.meta.url), "utf8");
  assert.match(emailAutomation, /import \{ automaticWhatsAppMessage \} from "\.\/whatsapp-message";/);
  assert.match(emailAutomation, /const message = automaticWhatsAppMessage\(event, delivery, trackingUrl, parcelCount\);/);
});

// Live audit finding: Meta's Cloud API rejects template body parameters
// containing newlines/tabs/repeated spaces. customer/destination are only
// length-validated at intake, never character-filtered, so a name with one
// of these characters would make every send attempt for that delivery fail
// identically forever (classified as the deliberately-retryable
// "provider_error", so nothing would ever stop retrying it) with no
// operator-visible signal that this specific delivery can never succeed.
test("every text parameter sent to Meta's template API is run through sanitizeTemplateParam first, stripping newlines/tabs/repeated spaces without touching the stored data itself", () => {
  assert.match(whatsappAutomation, /function sanitizeTemplateParam\(text: string\) \{/);
  assert.match(whatsappAutomation, /return text\.replace\(\/\[\\r\\n\\t\]\+\/g, " "\)\.replace\(\/ \{2,\}\/g, " "\)\.trim\(\);/);
  assert.match(whatsappAutomation, /\{ type: "text", text: sanitizeTemplateParam\(recipient\.name\) \}/);
  assert.match(whatsappAutomation, /\{ type: "text", text: sanitizeTemplateParam\(delivery\.id\) \}/);
  assert.match(whatsappAutomation, /\{ type: "text", text: sanitizeTemplateParam\(message\) \}/);
  assert.match(whatsappAutomation, /\{ type: "text" as const, text: sanitizeTemplateParam\(recipient\.name\) \}/);
});
