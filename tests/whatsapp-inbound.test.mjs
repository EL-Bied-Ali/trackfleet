import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { memoryStore } from "../app/lib/delivery-store.memory.ts";
import {
  buildFoundReply,
  buildNoMatchAskNameReply,
  parseInboundWhatsAppMessage,
  verifyWhatsAppWebhookSignature,
} from "../app/lib/whatsapp-inbound-message.ts";

function baseDeliveryInput(overrides) {
  const now = new Date();
  return {
    customer: "Jean Dupont", originSiteId: null, originLatitude: null, originLongitude: null,
    destinationSiteId: null, destination: "Casablanca", destinationLatitude: null, destinationLongitude: null,
    arrivalRadiusKm: 0.5, truck: "TRUCK-1", eta: "12:00", plannedArrivalAt: null, nextTruckDepartureAt: null,
    contact: "212612345678", recipientName: "", recipientContact: null, weightKg: 10, priceAmount: null, priceCurrency: null,
    whatsappOptIn: true, whatsappOptInAt: now, recipientWhatsappOptIn: false, recipientWhatsappOptInAt: null,
    sendatrackVehicleId: "", companyId: `inbound-test-${Date.now()}-${Math.random()}`, trackingToken: `tok-${Date.now()}-${Math.random()}`,
    driver: "TBD", status: "In transit", progress: 40, color: "#000",
    latitude: null, longitude: null, speed: 0, lastPositionAt: null, gpsSource: "simulation",
    ...overrides,
  };
}

// Feature (2026-08-26): a customer who messages the TrackFleet WhatsApp
// number first opens WhatsApp's free 24h customer service window, so
// TrackFleet can reply with their tracking link at no cost -- unlike the
// automatic push notifications (REGISTERED/ARRIVED_AT_SITE), which are
// business-initiated and billed. This is a genuinely separate, additive
// feature: it does not replace the automatic push side.

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

test("a genuine, correctly-signed inbound webhook verifies", async () => {
  const secret = "app_secret_test";
  const body = JSON.stringify({ entry: [] });
  const signature = await hmacHex(secret, body);
  const ok = await verifyWhatsAppWebhookSignature(body, `sha256=${signature}`, secret);
  assert.equal(ok, true);
});

test("a tampered body is rejected even with an otherwise-valid-looking signature header", async () => {
  const secret = "app_secret_test";
  const signature = await hmacHex(secret, JSON.stringify({ entry: [] }));
  const ok = await verifyWhatsAppWebhookSignature(JSON.stringify({ entry: [1] }), `sha256=${signature}`, secret);
  assert.equal(ok, false);
});

test("the wrong secret is rejected", async () => {
  const body = JSON.stringify({ entry: [] });
  const signature = await hmacHex("real_secret", body);
  const ok = await verifyWhatsAppWebhookSignature(body, `sha256=${signature}`, "wrong_secret");
  assert.equal(ok, false);
});

test("a signature header missing the sha256= prefix, or a missing header/secret entirely, is rejected rather than crashing", async () => {
  assert.equal(await verifyWhatsAppWebhookSignature("{}", "deadbeef", "secret"), false);
  assert.equal(await verifyWhatsAppWebhookSignature("{}", null, "secret"), false);
  assert.equal(await verifyWhatsAppWebhookSignature("{}", "sha256=deadbeef", ""), false);
});

test("parseInboundWhatsAppMessage extracts sender and text from a real Meta webhook payload shape", () => {
  const payload = {
    entry: [{
      changes: [{
        value: {
          messages: [{ from: "212612345678", text: { body: "Bonjour, où est mon colis ?" } }],
        },
      }],
    }],
  };
  const result = parseInboundWhatsAppMessage(payload);
  assert.deepEqual(result, { from: "212612345678", text: "Bonjour, où est mon colis ?" });
});

test("parseInboundWhatsAppMessage returns null for non-message webhook events (status updates, etc.) instead of crashing", () => {
  const statusPayload = {
    entry: [{ changes: [{ value: { statuses: [{ id: "wamid.xyz", status: "delivered" }] } }] }],
  };
  assert.equal(parseInboundWhatsAppMessage(statusPayload), null);
  assert.equal(parseInboundWhatsAppMessage({}), null);
  assert.equal(parseInboundWhatsAppMessage(null), null);
  assert.equal(parseInboundWhatsAppMessage({ entry: "not an array" }), null);
});

test("a found delivery's reply includes the tracking link as plain body text, not a button -- freeform replies have no anti-phishing URL restriction, unlike the template-based automatic push side", () => {
  const delivery = { id: "TF-1", customer: "Jean Dupont", destination: "Casablanca" };
  const reply = buildFoundReply(delivery, "https://trackfleet.chronoplan.workers.dev/?tracking=abc123", "Jean Dupont");
  assert.match(reply, /Jean Dupont/);
  assert.match(reply, /TF-1/);
  assert.match(reply, /Casablanca/);
  assert.match(reply, /https:\/\/trackfleet\.chronoplan\.workers\.dev\/\?tracking=abc123/);
});

test("the reply greets whoever is passed as greetingName, not always delivery.customer -- lets the caller greet the recipient by their own name when they're the one who texted in", () => {
  const delivery = { id: "TF-1", customer: "Jean Dupont", destination: "Casablanca" };
  const reply = buildFoundReply(delivery, "https://trackfleet.chronoplan.workers.dev/?tracking=abc123", "Fatima Zahra");
  assert.match(reply, /Fatima Zahra/);
  assert.doesNotMatch(reply, /Jean Dupont/);
});

test("the no-match reply asks for a name, and is the same message whether it's a first hello or a name search that didn't find anything -- there's no conversation state to tell those apart", () => {
  const reply = buildNoMatchAskNameReply();
  assert.match(reply, /prénom/i);
  assert.match(reply, /nom/i);
});

// whatsapp-inbound.ts and the webhook route import trackfleet-runtime-env,
// whose bare specifier only resolves under Vite/vinext's aliasing --
// unresolvable from plain Node (matching this repo's established pattern),
// so their wiring is exercised via source-text assertions.
const [inboundLib, webhookRoute, deliveryStoreTypes] = await Promise.all([
  readFile(new URL("../app/lib/whatsapp-inbound.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/webhooks/whatsapp/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/delivery-store.types.ts", import.meta.url), "utf8"),
]);

test("the webhook route verifies the raw-body signature before ever parsing JSON, same discipline as the Paddle webhook", () => {
  assert.match(webhookRoute, /const rawBody = await request\.text\(\);/);
  assert.match(webhookRoute, /verifyWhatsAppWebhookSignature\(rawBody, signatureHeader, appSecret\)/);
  const signatureCheckIndex = webhookRoute.indexOf("verifyWhatsAppWebhookSignature(");
  const jsonParseIndex = webhookRoute.indexOf("JSON.parse(rawBody)");
  assert.ok(signatureCheckIndex >= 0 && jsonParseIndex > signatureCheckIndex);
  assert.match(webhookRoute, /status: 401/);
});

test("an unverified GET subscription handshake is rejected, and a verified one echoes hub.challenge back", () => {
  assert.match(webhookRoute, /verifyWhatsAppWebhookSubscription\(mode, token\)/);
  assert.match(webhookRoute, /return new Response\(challenge, \{ status: 200/);
  assert.match(webhookRoute, /status: 403/);
});

test("the GET handshake token is compared against a configured secret, not hardcoded or always-true", () => {
  assert.match(inboundLib, /const configured = runtimeEnv\.WHATSAPP_WEBHOOK_VERIFY_TOKEN\?\.trim\(\);/);
  assert.match(inboundLib, /Boolean\(configured\) && mode === "subscribe" && token === configured/);
});

test("a reply is sent as a freeform text message (type: text), never a template, matching the free customer-service-window rules", () => {
  assert.match(inboundLib, /type: "text",/);
  assert.match(inboundLib, /text: \{ body: text \}/);
  assert.doesNotMatch(inboundLib, /type: "template"/);
});

test("consent withdrawal deliberately does not suppress this reply -- the customer is the one initiating contact, a different context from the automatic push side", () => {
  assert.match(webhookRoute, /Consent withdrawal deliberately does NOT suppress this reply/);
  assert.doesNotMatch(webhookRoute, /whatsappConsentWithdrawn/);
});

test("a delivery match tries the phone number first (either the sender or the recipient), then falls back to a name search using the message text -- both scoped globally (unscoped by company), matching getPublic's existing pattern, since the webhook has no company context", () => {
  assert.match(webhookRoute, /store\.findMostRecentActiveDeliveryByContact\(phone\)/);
  assert.match(webhookRoute, /store\.findMostRecentActiveDeliveryByCustomerNameQuery\(inbound\.text\)/);
  assert.match(deliveryStoreTypes, /findMostRecentActiveDeliveryByContact\(phone: string\): Promise<DeliveryRow \| null>;/);
  assert.match(deliveryStoreTypes, /findMostRecentActiveDeliveryByCustomerNameQuery\(query: string\): Promise<DeliveryRow \| null>;/);
});

test("the recipient texting in is greeted by their own name, not the sender's -- explicit product decision: either party can look up the same delivery", () => {
  assert.match(webhookRoute, /delivery\.recipientContact && delivery\.recipientContact === phone && delivery\.contact !== phone/);
  assert.match(webhookRoute, /\(delivery\.recipientName \|\| delivery\.customer\)/);
  assert.match(webhookRoute, /: delivery\.customer;/);
});

test("the webhook always acknowledges 200 once the payload is verified and parsed, even if the reply send itself fails -- a failed send must never make Meta retry-storm the same inbound message", () => {
  const postFn = webhookRoute.slice(webhookRoute.indexOf("export async function POST"));
  assert.match(postFn, /catch \(error\) \{/);
  assert.match(postFn, /return Response\.json\(\{ received: true \}, \{ status: 200 \}\);\s*\n\}/);
});

test("findMostRecentActiveDeliveryByContact matches the sender's phone against the stored contact, and skips a Delivered parcel in favor of an active one", async () => {
  const phone = `21261${Date.now()}`.slice(0, 12);
  const delivered = await memoryStore.create(baseDeliveryInput({ contact: phone, status: "Delivered" }));
  await new Promise((resolve) => setTimeout(resolve, 2));
  const active = await memoryStore.create(baseDeliveryInput({ contact: phone, status: "In transit" }));

  const match = await memoryStore.findMostRecentActiveDeliveryByContact(phone);
  assert.equal(match?.id, active.id);
  assert.notEqual(match?.id, delivered.id);
});

test("findMostRecentActiveDeliveryByContact returns the most recent match when a sender has several active parcels", async () => {
  const phone = `21262${Date.now()}`.slice(0, 12);
  const older = await memoryStore.create(baseDeliveryInput({ contact: phone }));
  await new Promise((resolve) => setTimeout(resolve, 2));
  const newer = await memoryStore.create(baseDeliveryInput({ contact: phone }));

  const match = await memoryStore.findMostRecentActiveDeliveryByContact(phone);
  assert.equal(match?.id, newer.id);
  assert.notEqual(match?.id, older.id);
});

test("findMostRecentActiveDeliveryByContact returns null for an unknown number", async () => {
  const match = await memoryStore.findMostRecentActiveDeliveryByContact("999999999999999");
  assert.equal(match, null);
});

test("findMostRecentActiveDeliveryByContact also matches the recipient's phone, not just the sender's -- explicit product decision: either party texting in is a legitimate lookup", async () => {
  const recipientPhone = `21263${Date.now()}`.slice(0, 12);
  const delivery = await memoryStore.create(baseDeliveryInput({ contact: "212699999999", recipientContact: recipientPhone, recipientName: "Fatima Zahra" }));

  const match = await memoryStore.findMostRecentActiveDeliveryByContact(recipientPhone);
  assert.equal(match?.id, delivery.id);
});

test("findMostRecentActiveDeliveryByCustomerNameQuery does a case-insensitive substring match on the customer name, among active deliveries only", async () => {
  const uniqueName = `Amina Testcustomer ${Date.now()}`;
  const delivered = await memoryStore.create(baseDeliveryInput({ customer: uniqueName, status: "Delivered" }));
  const active = await memoryStore.create(baseDeliveryInput({ customer: uniqueName, status: "In transit" }));

  const match = await memoryStore.findMostRecentActiveDeliveryByCustomerNameQuery(uniqueName.toLowerCase());
  assert.equal(match?.id, active.id);
  assert.notEqual(match?.id, delivered.id);
});

test("findMostRecentActiveDeliveryByCustomerNameQuery returns null for a blank or non-matching query instead of matching everything", async () => {
  assert.equal(await memoryStore.findMostRecentActiveDeliveryByCustomerNameQuery(""), null);
  assert.equal(await memoryStore.findMostRecentActiveDeliveryByCustomerNameQuery("   "), null);
  assert.equal(await memoryStore.findMostRecentActiveDeliveryByCustomerNameQuery(`nobody-named-this-${Date.now()}`), null);
});
