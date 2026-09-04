import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { memoryStore } from "../app/lib/delivery-store.memory.ts";
import {
  buildFoundReply,
  buildNoMatchAskNameReply,
  buildOptOutConfirmationReply,
  isOptOutMessage,
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

test("the reply greets whoever is passed as greetingName, not always delivery.customer -- lets the caller greet the recipient by their own name when they're the one who texted in, but the sender still shows in the Expéditeur line regardless", () => {
  const delivery = { id: "TF-1", customer: "Jean Dupont", destination: "Casablanca" };
  const reply = buildFoundReply(delivery, "https://trackfleet.chronoplan.workers.dev/?tracking=abc123", "Fatima Zahra");
  assert.match(reply, /^Bonjour Fatima Zahra,/);
  assert.match(reply, /Expéditeur : Jean Dupont/);
});

test("the reply is signed with the shipping company's own configured name, when it has one -- a customer has no other way to know an unfamiliar WhatsApp number is really TrackFleet's tracking SaaS behind their own shipper", () => {
  const delivery = { id: "TF-1", customer: "Jean Dupont", destination: "Casablanca" };
  const signed = buildFoundReply(delivery, "https://trackfleet.chronoplan.workers.dev/?tracking=abc123", "Jean Dupont", "Net Transport");
  assert.match(signed, /— Net Transport$/);
});

test("the reply is not signed at all when the company hasn't configured a brand name -- omitted, not a placeholder", () => {
  const delivery = { id: "TF-1", customer: "Jean Dupont", destination: "Casablanca" };
  const unsigned = buildFoundReply(delivery, "https://trackfleet.chronoplan.workers.dev/?tracking=abc123", "Jean Dupont");
  assert.doesNotMatch(unsigned, /—/);
  const explicitlyNull = buildFoundReply(delivery, "https://trackfleet.chronoplan.workers.dev/?tracking=abc123", "Jean Dupont", null);
  assert.equal(unsigned, explicitlyNull);
});

// Requested live: a customer's first message should get the full picture
// (sender, recipient, agency, weight/description, price, both estimated
// dates), not just a bare tracking link -- still the same free
// customer-service-window reply, so no added cost to including more.
test("the reply includes sender, recipient, agency, weight, price and both estimated dates when the delivery has them", () => {
  const delivery = {
    id: "TF-1", customer: "Jean Dupont", recipientName: "Fatima Zahra", destination: "Casablanca",
    destinationSiteId: "tetouan-cortoba-146", weightKg: 12.5, priceAmount: 45.5, priceCurrency: "EUR",
    nextTruckDepartureAt: new Date("2026-09-01T08:00:00.000Z"), plannedArrivalAt: new Date("2026-09-07T08:00:00.000Z"),
  };
  const reply = buildFoundReply(delivery, "https://trackfleet.chronoplan.workers.dev/?tracking=abc123", "Jean Dupont");
  assert.match(reply, /Expéditeur : Jean Dupont/);
  assert.match(reply, /Destinataire : Fatima Zahra/);
  assert.match(reply, /Agence : Tétouan · Avenue Cortoba/);
  assert.match(reply, /Poids : 12,5 kg/);
  assert.match(reply, /Prix : 45,50 EUR/);
  assert.match(reply, /Départ estimé : 01 sept\. 2026/);
  assert.match(reply, /Arrivée estimée : 07 sept\. 2026.*estimation, peut évoluer/);
});

test("falls back to the destination address (not the site label) when destinationSiteId doesn't resolve to a known site", () => {
  const delivery = { id: "TF-1", customer: "Jean Dupont", destination: "Casablanca" };
  const reply = buildFoundReply(delivery, "https://trackfleet.chronoplan.workers.dev/?tracking=abc123", "Jean Dupont");
  assert.match(reply, /Agence : Casablanca/);
});

test("shows the item description instead of a weight for an unweighed bulky item, and omits both lines entirely when neither is on file", () => {
  const described = { id: "TF-1", customer: "Jean Dupont", destination: "Casablanca", itemDescription: "Machine à laver" };
  const reply = buildFoundReply(described, "https://trackfleet.chronoplan.workers.dev/?tracking=abc123", "Jean Dupont");
  assert.match(reply, /Contenu : Machine à laver/);
  assert.doesNotMatch(reply, /Poids :/);

  const neither = { id: "TF-1", customer: "Jean Dupont", destination: "Casablanca" };
  const bareReply = buildFoundReply(neither, "https://trackfleet.chronoplan.workers.dev/?tracking=abc123", "Jean Dupont");
  assert.doesNotMatch(bareReply, /Poids :|Contenu :/);
});

test("mentions the estimate is not firm when either date is missing, rather than inventing one", () => {
  const delivery = { id: "TF-1", customer: "Jean Dupont", destination: "Casablanca" };
  const reply = buildFoundReply(delivery, "https://trackfleet.chronoplan.workers.dev/?tracking=abc123", "Jean Dupont");
  assert.match(reply, /Départ estimé : à confirmer/);
  assert.match(reply, /Arrivée estimée : à confirmer.*estimation, peut évoluer/);
});

test("mentions the parcel count only when the customer's parcel isn't traveling alone", () => {
  const delivery = { id: "TF-1", customer: "Jean Dupont", destination: "Casablanca" };
  const solo = buildFoundReply(delivery, "https://trackfleet.chronoplan.workers.dev/?tracking=abc123", "Jean Dupont");
  assert.doesNotMatch(solo, /colis liés/);
  const grouped = buildFoundReply(delivery, "https://trackfleet.chronoplan.workers.dev/?tracking=abc123", "Jean Dupont", null, 3);
  assert.match(grouped, /Colis : 3 colis liés à cet envoi/);
});

test("the no-match reply asks for a name, and is the same message whether it's a first hello or a name search that didn't find anything -- there's no conversation state to tell those apart", () => {
  const reply = buildNoMatchAskNameReply();
  assert.match(reply, /prénom/i);
  assert.match(reply, /nom/i);
});

// Live audit finding: Meta requires honoring a customer's own opt-out
// request sent directly via WhatsApp -- the only way to withdraw consent
// used to be a dispatcher clicking a button in the internal dashboard, with
// no customer-facing self-service mechanism at all.
test("isOptOutMessage recognizes an exact STOP/ARRET-family word (case-insensitive, trailing punctuation ignored), in French or English", () => {
  for (const text of ["stop", "STOP", "Stop", "stop.", "stop!", "arret", "arrêt", "Arrêt !", "desabonner", "désabonner", "unsubscribe"]) {
    assert.equal(isOptOutMessage(text), true, `"${text}" should be recognized as an opt-out`);
  }
});

test("isOptOutMessage does NOT match on a mere substring -- an ordinary message that happens to contain one of these words as part of a longer sentence is not misread as an opt-out", () => {
  assert.equal(isOptOutMessage("Où est mon colis, j'ai peur qu'il s'arrête en route"), false);
  assert.equal(isOptOutMessage("stop spamming me is not what I meant"), false);
  assert.equal(isOptOutMessage("Jean Dupont"), false);
  assert.equal(isOptOutMessage(""), false);
  assert.equal(isOptOutMessage("   "), false);
});

test("buildOptOutConfirmationReply confirms the opt-out without asking a question or offering to resend", () => {
  const reply = buildOptOutConfirmationReply();
  assert.match(reply, /WhatsApp/);
  assert.doesNotMatch(reply, /\?/);
});

// whatsapp-inbound.ts and the webhook route import trackfleet-runtime-env,
// whose bare specifier only resolves under Vite/vinext's aliasing --
// unresolvable from plain Node (matching this repo's established pattern),
// so their wiring is exercised via source-text assertions.
const [inboundLib, webhookRoute, deliveryStoreTypes, postgresStore, cloudflareStore] = await Promise.all([
  readFile(new URL("../app/lib/whatsapp-inbound.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/webhooks/whatsapp/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/delivery-store.types.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/delivery-store.postgres.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/delivery-store.cloudflare.ts", import.meta.url), "utf8"),
]);

test("the Postgres and D1 backends both require an exact (case-insensitive) customer-name match, not a % wildcard substring", () => {
  // Scoped to the name-query function itself, not the whole file -- both
  // backends separately use a legitimate, already company-scoped "customer
  // LIKE" for demo-delivery cleanup (matching DEMO_DELIVERY_CUSTOMER_PREFIX%),
  // unrelated to this inbound-webhook lookup.
  const postgresFn = postgresStore.slice(postgresStore.indexOf("async findMostRecentActiveDeliveryByCustomerNameQuery"), postgresStore.indexOf("async applySendatrackSnapshot"));
  assert.match(postgresFn, /lower\(customer\) = lower\(\$\{trimmed\}\)/);
  assert.doesNotMatch(postgresFn, /ILIKE/);
  const cloudflareFn = cloudflareStore.slice(cloudflareStore.indexOf("async findMostRecentActiveDeliveryByCustomerNameQuery"), cloudflareStore.indexOf("async applySendatrackSnapshot"));
  assert.match(cloudflareFn, /lower\(customer\) = lower\(\?\)/);
  assert.doesNotMatch(cloudflareFn, / LIKE /);
});

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

test("consent withdrawal deliberately does not suppress the found/no-match reply -- the customer is the one initiating contact, a different context from the automatic push side. whatsappConsentWithdrawn IS used elsewhere in this route now (the opt-out branch, to avoid double-recording), just not to gate this reply", () => {
  assert.match(webhookRoute, /Consent withdrawal deliberately does NOT suppress this reply/);
  const foundNoMatchSection = webhookRoute.slice(webhookRoute.indexOf("Consent withdrawal deliberately does NOT"), webhookRoute.indexOf("await sendWhatsAppTextReply(inbound.from, reply);"));
  assert.doesNotMatch(foundNoMatchSection, /whatsappConsentWithdrawn/);
});

test("a delivery match tries the phone number first (either the sender or the recipient), then falls back to a name search using the message text -- both scoped globally (unscoped by company), matching getPublic's existing pattern, since the webhook has no company context", () => {
  assert.match(webhookRoute, /store\.findMostRecentActiveDeliveryByContact\(phone\)/);
  assert.match(webhookRoute, /store\.findMostRecentActiveDeliveryByCustomerNameQuery\(inbound\.text\)/);
  assert.match(deliveryStoreTypes, /findMostRecentActiveDeliveryByContact\(phone: string\): Promise<DeliveryRow \| null>;/);
  assert.match(deliveryStoreTypes, /findMostRecentActiveDeliveryByCustomerNameQuery\(query: string\): Promise<DeliveryRow \| null>;/);
});

// Live audit finding: a customer had no self-service way to opt out via
// WhatsApp itself. Checked before the found/no-match lookup, and covers
// EVERY active delivery for the phone (not just the most recent one),
// since whatsappConsentWithdrawn is checked per-delivery from that
// delivery's own event log.
test("the webhook checks for an opt-out message first, records WHATSAPP_OPT_OUT on every currently-active delivery for that phone, and replies with a confirmation instead of the normal found/no-match reply", () => {
  assert.match(webhookRoute, /if \(isOptOutMessage\(inbound\.text\)\) \{/);
  assert.match(webhookRoute, /const activeDeliveries = await store\.listActiveDeliveriesByContact\(phone\);/);
  assert.match(webhookRoute, /if \(!whatsappConsentWithdrawn\(activeEvents\)\) \{\s*\n\s*await store\.recordEvent\(activeDelivery\.id, "WHATSAPP_OPT_OUT", activeDelivery\.progress\);/);
  assert.match(webhookRoute, /await sendWhatsAppTextReply\(inbound\.from, buildOptOutConfirmationReply\(\)\);/);
  // Must be checked before the found/no-match lookup, not after.
  const optOutIndex = webhookRoute.indexOf("isOptOutMessage(inbound.text)");
  const lookupIndex = webhookRoute.indexOf("store.findMostRecentActiveDeliveryByContact(phone)");
  assert.ok(optOutIndex >= 0 && lookupIndex > optOutIndex);
  assert.match(deliveryStoreTypes, /listActiveDeliveriesByContact\(phone: string\): Promise<DeliveryRow\[\]>;/);
});

test("the recipient texting in is greeted by their own name, not the sender's -- explicit product decision: either party can look up the same delivery", () => {
  assert.match(webhookRoute, /delivery\.recipientContact && delivery\.recipientContact === phone && delivery\.contact !== phone/);
  assert.match(webhookRoute, /\(delivery\.recipientName \|\| delivery\.customer\)/);
  assert.match(webhookRoute, /: delivery\.customer;/);
});

test("the reply is signed with the matched delivery's own company branding, looked up only once a delivery is actually found", () => {
  assert.match(webhookRoute, /import \{ getCompanyBranding \} from "trackfleet-auth-session-store";/);
  assert.match(webhookRoute, /const branding = await getCompanyBranding\(delivery\.companyId\);/);
  assert.match(webhookRoute, /buildFoundReply\(delivery, trackingUrl\.toString\(\), greetingName, branding\?\.name \?\? null, parcelCount\);/);
});

// Requested live: mention how many parcels share this shipment, when it's
// more than one -- looked up here (not in whatsapp-inbound-message.ts,
// which stays store-free) since it needs a company-wide query.
test("counts sibling parcels sharing the same shipmentId, but only bothers querying when the matched delivery actually has one", () => {
  assert.match(webhookRoute, /const parcelCount = delivery\.shipmentId\s*\n\s*\? \(await store\.listForCompany\(delivery\.companyId\)\)\.filter\(\(item\) => item\.shipmentId === delivery\.shipmentId\)\.length\s*\n\s*: 1;/);
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

// Regression coverage for the opt-out feature: unlike
// findMostRecentActiveDeliveryByContact (single most-recent match, used for
// the normal found/no-match reply), listActiveDeliveriesByContact returns
// EVERY active delivery for a phone, so an opt-out can cover all of them.
test("listActiveDeliveriesByContact returns every active delivery for a phone (not just the most recent), matching either the sender or the recipient, and excludes Delivered ones", async () => {
  const phone = `21264${Date.now()}`.slice(0, 12);
  const delivered = await memoryStore.create(baseDeliveryInput({ contact: phone, status: "Delivered" }));
  const older = await memoryStore.create(baseDeliveryInput({ contact: phone, status: "In transit" }));
  const asRecipient = await memoryStore.create(baseDeliveryInput({ contact: "212699999999", recipientContact: phone, status: "Loading" }));

  const matches = await memoryStore.listActiveDeliveriesByContact(phone);
  const matchedIds = matches.map((delivery) => delivery.id).sort();
  assert.deepEqual(matchedIds, [asRecipient.id, older.id].sort());
  assert.ok(!matchedIds.includes(delivered.id));
});

test("listActiveDeliveriesByContact returns an empty array, not null, for an unknown number", async () => {
  const matches = await memoryStore.listActiveDeliveriesByContact("999999999999998");
  assert.deepEqual(matches, []);
});

test("findMostRecentActiveDeliveryByCustomerNameQuery does a case-insensitive EXACT match on the customer name, among active deliveries only", async () => {
  const uniqueName = `Amina Testcustomer ${Date.now()}`;
  const delivered = await memoryStore.create(baseDeliveryInput({ customer: uniqueName, status: "Delivered" }));
  const active = await memoryStore.create(baseDeliveryInput({ customer: uniqueName, status: "In transit" }));

  const match = await memoryStore.findMostRecentActiveDeliveryByCustomerNameQuery(uniqueName.toLowerCase());
  assert.equal(match?.id, active.id);
  assert.notEqual(match?.id, delivered.id);
});

// Security fix, live audit finding: this runs against EVERY company sharing
// the WhatsApp Business number, with no phone check at all -- a substring
// match let a stranger pull another company's private delivery details
// (destination, weight, price, ETA) just by texting a name that happened to
// appear anywhere inside someone else's customer field. Only an exact
// (still case-insensitive) match is accepted now.
test("findMostRecentActiveDeliveryByCustomerNameQuery no longer matches on a mere substring -- a partial or superstring of the real name must not find it", async () => {
  const uniqueName = `Karim Substringtest ${Date.now()}`;
  await memoryStore.create(baseDeliveryInput({ customer: uniqueName, status: "In transit" }));

  assert.equal(await memoryStore.findMostRecentActiveDeliveryByCustomerNameQuery("Karim"), null);
  assert.equal(await memoryStore.findMostRecentActiveDeliveryByCustomerNameQuery("Substringtest"), null);
  assert.equal(await memoryStore.findMostRecentActiveDeliveryByCustomerNameQuery(`${uniqueName} extra`), null);
});

test("findMostRecentActiveDeliveryByCustomerNameQuery returns null for a blank or non-matching query instead of matching everything", async () => {
  assert.equal(await memoryStore.findMostRecentActiveDeliveryByCustomerNameQuery(""), null);
  assert.equal(await memoryStore.findMostRecentActiveDeliveryByCustomerNameQuery("   "), null);
  assert.equal(await memoryStore.findMostRecentActiveDeliveryByCustomerNameQuery(`nobody-named-this-${Date.now()}`), null);
});
