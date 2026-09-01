import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [route, page, appSidebar, companyLogo, css, d1Schema] = await Promise.all([
  readFile(new URL("../app/api/company/branding/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/AppSidebar.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/CompanyLogo.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  readFile(new URL("../scripts/prepare-d1-schema.mjs", import.meta.url), "utf8"),
]);

test("branding is readable by any authenticated session, but only a dispatcher can edit it", () => {
  assert.match(route, /export async function GET\(request: Request\) \{\s*const session = await getCompanySession\(request\);/s);
  assert.match(route, /export async function POST\(request: Request\) \{\s*if \(!requestIsSameOrigin\(request\)\) return originRejectedResponse\(\);\s*const session = await getDispatcherSession\(request\);/s);
});

test("the branding update route validates name length, hex color format, and logo data-url shape/size before writing anything", () => {
  assert.match(route, /if \(name\.length > MAX_NAME_LENGTH\) return noStore\(\{ error: "name_too_long" \}, 400\);/);
  assert.match(route, /const HEX_COLOR_PATTERN = \/\^#\[0-9a-fA-F\]\{6\}\$\/;/);
  assert.match(route, /if \(color !== "" && !HEX_COLOR_PATTERN\.test\(color\)\) return noStore\(\{ error: "invalid_color" \}, 400\);/);
  assert.match(route, /const LOGO_DATA_URL_PATTERN = \/\^data:image\\\/\(png\|jpeg\|jpg\|webp\|svg\\\+xml\);base64,\//);
  assert.match(route, /if \(logoDataUrl\.length > MAX_LOGO_DATA_URL_LENGTH\) return noStore\(\{ error: "logo_too_large" \}, 400\);/);
});

test("an empty name, color, or logo clears that field (stored as null) rather than being rejected", () => {
  assert.match(route, /name: name \|\| null,/);
  assert.match(route, /logoDataUrl: logoDataUrl \|\| null,/);
  assert.match(route, /color: color \|\| null,/);
});

test("the customer tracking header shows the company's own name/logo, falling back to TrackFleet when unset", () => {
  assert.match(page, /<CompanyLogo className="brand-mark" logoDataUrl=\{companyBranding\.logoDataUrl\} \/>/);
  assert.match(page, /<span>\{companyBranding\.name \|\| "TrackFleet"\}<\/span>/);
});

test("the dispatcher sidebar shows the same company branding as the customer page", () => {
  // The sidebar now lives in AppSidebar.tsx, shared between the dashboard
  // (app/page.tsx) and every standalone page (Revenue, History, Guide,
  // Import, the operations hub, Storage) -- see the 2026-09-02 "sidebar
  // everywhere" request.
  const sidebarBrand = appSidebar.indexOf('<Link className="brand company-brand" href="/">');
  assert.ok(sidebarBrand >= 0, "expected the sidebar brand mark to use companyBranding, not a hardcoded TrackFleet span");
  assert.match(appSidebar, /<span className="company-brand-name">\{companyBranding\.name \|\| "TrackFleet"\}<\/span>/);
  assert.match(appSidebar, /<CompanyLogo className="brand-mark company-brand-mark" logoDataUrl=\{companyBranding\.logoDataUrl\} \/>/);
});

test("the settings nav item opens company settings for a dispatcher, but stays disabled for an agency", () => {
  // On the dashboard itself, onOpenSettings opens the settings modal
  // in-place; on every other page it falls back to a plain link (there's no
  // modal to open there) -- both branches still gate on role === "dispatcher"
  // the same way, an agency always gets the disabled button.
  assert.match(appSidebar, /company\?\.role === "dispatcher"\s*\n\s*\? \(onOpenSettings \? <button className="nav-item" onClick=\{onOpenSettings\}><Icon>⚙<\/Icon>\{t\.settings\}<\/button> : <a className="nav-item" href=\{settingsHref \?\? "\/"\}><Icon>⚙<\/Icon>\{t\.settings\}<\/a>\)\s*\n\s*: <button className="nav-item" disabled><Icon>⚙<\/Icon>\{t\.settings\}<\/button>/);
  assert.match(page, /onOpenSettings=\{openCompanySettings\}/);
});

test("the public tracking API response carries the delivering company's branding as its own top-level field, not per-delivery", async () => {
  const deliveriesRoute = await readFile(new URL("../app/api/deliveries/route.ts", import.meta.url), "utf8");
  assert.match(deliveriesRoute, /const companyBranding = await getCompanyBranding\(row\.companyId\);/);
  assert.match(deliveriesRoute, /companyBranding: companyBranding \?\? \{ name: null, logoDataUrl: null, color: null \},/);
});

test("logos are cropped client-side before storage and re-cropped on display for existing uploads", () => {
  // cropLogoDataUrl/CompanyLogo now live in their own module (app/CompanyLogo.tsx),
  // shared by app/page.tsx and app/AppSidebar.tsx -- see the sidebar extraction.
  assert.match(companyLogo, /export async function cropLogoDataUrl\(dataUrl: string\)/);
  assert.match(companyLogo, /const maxDimension = 320;/);
  assert.match(companyLogo, /const isNearWhite = pixels\[offset\] > 245/);
  assert.match(page, /setCompanySettingsLogoDataUrl\(await cropLogoDataUrl\(dataUrl\)\);/);
  assert.match(companyLogo, /void cropLogoDataUrl\(logoDataUrl\)\.then/);
});

test("company branding columns are provisioned in both the Postgres schema contract and the D1 standby's self-healing schema script", async () => {
  const contract = await readFile(new URL("../app/lib/storage-schema-contract.ts", import.meta.url), "utf8");
  assert.match(contract, /\{ table: "companies", column: "brand_name" \}/);
  assert.match(contract, /\{ table: "companies", column: "brand_logo_data_url" \}/);
  assert.match(contract, /\{ table: "companies", column: "brand_color" \}/);
  assert.match(d1Schema, /\["brand_name", "text"\]/);
  assert.match(d1Schema, /\["brand_logo_data_url", "text"\]/);
  assert.match(d1Schema, /\["brand_color", "text"\]/);
});

test("company branding writes are suppressed (not silently lost) during an active D1 failover, matching every other maintenance write", async () => {
  const failover = await readFile(new URL("../app/lib/auth-session-store.cloudflare-postgres-failover.ts", import.meta.url), "utf8");
  assert.match(failover, /export async function updateCompanyBranding\(companyId: string, input: CompanyBranding\) \{\s*return suppressMaintenanceWriteDuringD1Failover\(/s);
  assert.match(failover, /export async function getCompanyBranding\(companyId: string\): Promise<CompanyBranding \| null> \{\s*return withD1ReadFailover\(/s);
});

test("branding css gives the sidebar logo a clean, prominent slot without blurry CSS zoom", () => {
  assert.match(css, /\.brand-mark \{ display: grid; place-items: center; width: 29px; height: 29px;.*overflow: hidden; \}/);
  assert.match(css, /\.company-brand-name \{ max-width: 100%;.*font-size: 22px;/);
  assert.match(css, /\.brand\.company-brand \.company-brand-mark \{ width: 152px; height: 76px; display: flex;.*overflow: hidden;/);
  assert.match(css, /\.brand-mark img \{ width: 100%; height: 100%; object-fit: contain; transform: none;/);
  assert.match(css, /\.brand\.company-brand \.company-brand-mark img \{ display: block; width: auto; height: auto; max-width: 100%; max-height: 100%; object-fit: contain; object-position: left center; transform: none; \}/);
});

test("the sidebar uses a quiet light palette so uploaded logos do not fight the background", () => {
  assert.match(css, /\.sidebar \{ width: 240px;.*background: #fbfcfa; color: #334155;/);
  assert.match(css, /\.nav-item\.active \{ color: #1f2937; background: #e8efec;/);
});

// Reported live, with a screenshot: in dark mode, the sidebar logo showed a
// dark navy box behind it, reading as a quality drop even though the logo's
// own pixels were untouched. Root cause: .company-brand-mark carries the
// .brand-mark class too, and the generic dark-mode ".brand-mark" rule
// (meant only for the small placeholder icon square) tied in specificity
// with the light-mode ".brand.company-brand .company-brand-mark { background:
// transparent }" rule -- source order let the dark rule win, repainting a
// solid background behind what should be a transparent logo slot.
test("the sidebar logo stays transparent in dark mode, not just in light mode", () => {
  assert.match(css, /:root\[data-theme="dark"\] \.brand\.company-brand \.company-brand-mark \{ background: transparent; \}/);
  const darkBrandMarkIndex = css.indexOf(':root[data-theme="dark"] .brand-mark {');
  const darkCompanyMarkIndex = css.indexOf(':root[data-theme="dark"] .brand.company-brand .company-brand-mark');
  assert.ok(darkBrandMarkIndex > -1 && darkCompanyMarkIndex > darkBrandMarkIndex, "the transparent override must come after the generic dark .brand-mark rule to win the cascade");
});
