import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("the full enrollment token can be shortened to a short, single-use code via KV, without a new namespace", async () => {
  // The full token is self-contained on purpose (no server lookup needed to
  // verify it), which is exactly why it's long -- reported live as too long
  // to share with an agency over WhatsApp/SMS. Reuses the existing
  // SENDATRACK_TOKEN_CACHE KV binding under a distinct key prefix instead
  // of provisioning a new namespace (this repo's deploy token can't create
  // Cloudflare resources from here -- confirmed live, `wrangler kv
  // namespace list` fails with an auth error).
  const auth = await read("../app/lib/company-auth.ts");
  assert.match(auth, /export async function createShortEnrollmentCode\(token: string, expiresAt: number\): Promise<string \| null> \{/);
  assert.match(auth, /export async function resolveShortEnrollmentCode\(code: string\): Promise<string \| null> \{/);
  assert.match(auth, /function enrollmentLinkKv\(\) \{\s*\n\s*return \(runtimeEnv as unknown as \{ SENDATRACK_TOKEN_CACHE\?: EnrollmentLinkKv \}\)\.SENDATRACK_TOKEN_CACHE \?\? null;/);
  assert.match(auth, /function enrollmentLinkKey\(code: string\) \{\s*\n\s*return `agency-enroll-link:\$\{code\}`;/);
  // Single-use: the code is deleted as soon as it's read, on top of its own
  // KV TTL -- the long token it resolves to still carries its own
  // expiry/signature check, this is an additional safety layer.
  assert.match(auth, /if \(token\) await kv\.delete\(enrollmentLinkKey\(code\)\);/);
});

test("the enrollment route prefers a short link when KV is available, and always falls back to the full token link otherwise", async () => {
  const route = await read("../app/api/auth/agency-enrollment/route.ts");
  assert.match(route, /const shortLinkCode = await createShortEnrollmentCode\(token, Date\.now\(\) \+ agencyEnrollmentDurationMs\);/);
  assert.match(route, /if \(shortLinkCode\) \{\s*\n\s*url\.searchParams\.set\("c", shortLinkCode\);\s*\n\s*\} else \{\s*\n\s*url\.hash = `token=\$\{encodeURIComponent\(token\)\}`;/);
});

test("the enrollment route accepts either the full token or a short code to complete enrollment", async () => {
  const route = await read("../app/api/auth/agency-enrollment/route.ts");
  assert.match(route, /const shortCode = String\(payload\.code \?\? ""\)\.trim\(\);/);
  assert.match(route, /const rawToken = String\(payload\.token \?\? ""\)\.trim\(\);/);
  assert.match(route, /const enrollmentToken = rawToken \|\| \(shortCode \? await resolveShortEnrollmentCode\(shortCode\) \?\? "" : ""\);/);
});

test("the enroll page reads a short code from the query string alongside the existing hash-fragment token", async () => {
  const enrollmentPage = await read("../app/agency/enroll/page.tsx");
  assert.match(enrollmentPage, /const code = new URLSearchParams\(window\.location\.search\)\.get\("c"\) \?\? "";/);
  assert.match(enrollmentPage, /if \(!token && !code\) \{/);
  assert.match(enrollmentPage, /body: JSON\.stringify\(token \? \{ token \} : \{ code \}\),/);
  // Still scrubbed from the URL bar either way, same as the token was.
  assert.match(enrollmentPage, /window\.history\.replaceState\(\{\}, "", "\/agency\/enroll"\);/);
});
