import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const [vercelConfig, cloudflareWorker] = await Promise.all([
  readFile(new URL("../vercel.json", import.meta.url), "utf8"),
  readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
]);

const expectedHeaders = [
  "Strict-Transport-Security",
  "X-Content-Type-Options",
  "X-Frame-Options",
  "Referrer-Policy",
  "Permissions-Policy",
];

test("Vercel and Cloudflare expose the same baseline security headers", () => {
  for (const header of expectedHeaders) {
    assert.match(vercelConfig, new RegExp(header));
    assert.match(cloudflareWorker, new RegExp(header));
  }
});

test("Cloudflare applies security headers to both images and app responses", () => {
  assert.match(cloudflareWorker, /return withSecurityHeaders\(response\)/);
  assert.match(cloudflareWorker, /const response = await handler\.fetch\(request, env, ctx\);/);
});

test("production installs are locked to the committed dependency graph", () => {
  assert.match(vercelConfig, /pnpm install --frozen-lockfile/);
});
