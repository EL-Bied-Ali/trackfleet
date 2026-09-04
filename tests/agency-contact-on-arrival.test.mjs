import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { knownSites } from "../app/lib/known-sites.ts";

// User request, from a photo of the company's real agency-address flyer:
// (1) backfill the real WhatsApp numbers from that photo onto the 9
// existing known agencies, (2) show the destination agency's number on the
// customer tracking page once the parcel has genuinely arrived (not
// before), (3) mention in the departure WhatsApp message that the number
// is coming once it arrives. Explicitly deferred: the automated/template
// WhatsApp version -- only the free-form messages were touched.

test("all 9 Moroccan known agencies now carry a real WhatsApp number from the flyer photo, Brussels (the Belgian origin depot) does not", () => {
  const byId = new Map(knownSites.map((site) => [site.id, site]));
  const expected = {
    "tanger-med-ksar-al-majaz": "+212 7 00 06 18 40",
    "tanger-ville-said-kotb-19a": "+212 6 62 12 02 59",
    "tetouan-cortoba-146": "+212 6 68 37 77 51",
    "sale-hay-nasser-12bis": "+212 6 66 73 82 20",
    "marrakech-essaouira-12": "+212 6 62 12 14 48",
    "agadir-zaitoune-tikiouine-103a": "+212 6 66 57 22 66",
    "khouribga-mohamed-vi-30": "+212 6 62 12 50 03",
    "fquih-ben-salah-allal-ben-abdellah-197": "+212 6 62 12 52 09",
    "casablanca-mohammed-vi-959": "+212 6 62 72 53 29",
  };
  for (const [id, whatsapp] of Object.entries(expected)) {
    assert.equal(byId.get(id)?.whatsapp, whatsapp, `${id} should have its real WhatsApp number`);
  }
  assert.equal(byId.get("brussels-abattoir-45")?.whatsapp, undefined, "the Belgian origin depot isn't in the flyer, must stay unset");
});

test("the public tracking route only looks up (and only reveals) the destination agency's WhatsApp number once the delivery is genuinely Delivered", async () => {
  const route = await readFile(new URL("../app/api/deliveries/route.ts", import.meta.url), "utf8");
  assert.match(route, /const destinationWhatsapp = enriched\.status === "Delivered" && row\.destinationSiteId/);
  assert.match(route, /publicDeliveryView\(enriched, \{ destinationWhatsapp \}\)/);
});

test("the customer tracking page shows a clickable wa.me link to the agency, only once Delivered and only when a number is on file", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /\{selected\.status === "Delivered" && selected\.destinationWhatsapp && <a className="agency-contact-card" href=\{`https:\/\/wa\.me\/\$\{selected\.destinationWhatsapp\.replace\(\/\[\^\\d\]\/g, ""\)\}`\}/);
});

// Live follow-up: manual WhatsApp sends (notify-arrival/departure, and now
// the "delivered" scan checkpoint) are freeform, not template -- they only
// reach the customer if the customer already opened Meta's 24h free
// customer-service window by texting first, which stays true as long as
// WHATSAPP_AUTOMATION_ENABLED (the template-based automatic pipeline) is
// off. Surfaced on the tracking page itself, not just as an aside in the
// departure message, so the customer sees it proactively while still
// in-transit -- the one time it's actually actionable.
test("the customer tracking page tells the customer to message first to receive WhatsApp updates, only while not yet Delivered and only when the shared number is configured", async () => {
  const route = await readFile(new URL("../app/api/deliveries/route.ts", import.meta.url), "utf8");
  assert.match(route, /whatsappContactNumber: runtimeEnv\.WHATSAPP_DISPLAY_NUMBER\?\.trim\(\) \|\| null,/);
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /const \[whatsappContactNumber, setWhatsappContactNumber\] = useState<string \| null>\(null\);/);
  assert.match(page, /setWhatsappContactNumber\(data\.whatsappContactNumber \?\? null\);/);
  assert.match(page, /\{selected\.status !== "Delivered" && whatsappContactNumber && <a className="agency-contact-card" href=\{`https:\/\/wa\.me\/\$\{whatsappContactNumber\.replace\(\/\[\^\\d\]\/g, ""\)\}`\}/);
});
