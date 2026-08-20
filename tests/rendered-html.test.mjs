import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [page, layout, globalCss, packageJson] = await Promise.all([
  readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
]);

test("production shell exposes the TrackFleet login and private tracking experience", () => {
  assert.match(layout, /title: "TrackFleet — Delivery tracking made clear"/);
  assert.match(layout, /description: "Live fleet operations and private customer delivery tracking/);
  assert.match(page, /<main className="login-page">/);
  assert.match(page, /Connect your SENDATRACK fleet/);
  assert.match(page, /input name="accountID"/);
  assert.match(page, /input name="password" type="password"/);
  assert.match(page, /credentials are never visible to customers/);
  assert.match(page, /publicTrackingState/);
  assert.match(page, /searchParams\.get\("tracking"\)/);
});

test("obsolete starter preview is absent from the production application", () => {
  for (const source of [page, layout, globalCss, packageJson]) {
    assert.doesNotMatch(source, /Your site is taking shape|Building your site|react-loading-skeleton|codex-preview/);
  }
  assert.match(layout, /import "\.\/globals\.css"/);
  assert.match(layout, /import "\.\/dashboard-polish\.css"/);
  assert.doesNotMatch(layout, /_sites-preview|SkeletonPreview/);
});
