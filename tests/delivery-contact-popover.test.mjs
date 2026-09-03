import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync("app/page.tsx", "utf8");
const css = fs.readFileSync("app/globals.css", "utf8");

test("clicking the client or recipient cell reveals their phone number(s) in a small popover, instead of the client's number never being shown at all", () => {
  // The Destinataire column already showed both numbers as always-visible
  // text, but the Client column never surfaced the customer's own number
  // anywhere in the table. Made both click-to-reveal for a consistent
  // pattern, as requested.
  assert.match(page, /const \[openContactPopover, setOpenContactPopover\] = useState<string \| null>\(null\);/);
  assert.match(page, /className="customer-cell contact-trigger" onClick=\{\(event\) => \{ event\.stopPropagation\(\); setOpenContactPopover\(\(current\) => current === `\$\{delivery\.id\}:customer` \? null : `\$\{delivery\.id\}:customer`\); \}\}/);
  assert.match(page, /className="contact-trigger" onClick=\{\(event\) => \{ event\.stopPropagation\(\); setOpenContactPopover\(\(current\) => current === `\$\{delivery\.id\}:recipient` \? null : `\$\{delivery\.id\}:recipient`\); \}\}/);
  assert.match(page, /\{openContactPopover === `\$\{delivery\.id\}:customer` && <div className="contact-popover">/);
  assert.match(page, /\{openContactPopover === `\$\{delivery\.id\}:recipient` && <div className="contact-popover">/);
});

test("phone numbers in the popover are tel: links for quick dialing", () => {
  assert.match(page, /delivery\.contact \? <a href=\{`tel:\$\{delivery\.contact\}`\}>\{delivery\.contact\}<\/a> : <span>—<\/span>/);
  assert.match(page, /\[delivery\.contact, delivery\.recipientContact\]\.filter\(Boolean\)\.map\(\(number\) => <a key=\{number\} href=\{`tel:\$\{number\}`\}>\{number\}<\/a>\)/);
});

test("the popover closes on any outside click, but not a click inside the popover or its trigger", () => {
  // Deliberately not a stopPropagation()-on-a-div approach (that trips the
  // jsx-a11y click-events-have-key-events / no-static-element-interactions
  // rules for a non-interactive element) -- the outside-click handler
  // itself checks the click target instead.
  assert.match(page, /if \(!openContactPopover\) return;/);
  assert.match(page, /if \(target\?\.closest\("\.contact-popover, \.contact-trigger, \.scan-location-trigger"\)\) return;/);
  assert.match(page, /document\.addEventListener\("click", close\);/);
  assert.doesNotMatch(page, /<div className="contact-popover" onClick=/);
});

test("the popover has its own positioning context and doesn't rely on any global td positioning", () => {
  assert.match(css, /\.contact-cell-wrap \{ position: relative; \}/);
  assert.match(css, /\.contact-popover \{ position: absolute;/);
  assert.match(page, /className="contact-cell-wrap"/);
});
