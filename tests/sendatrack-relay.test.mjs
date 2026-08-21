import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { startServer } from "../relay/server.mjs";

const sendatrackSource = await readFile(new URL("../app/lib/sendatrack.ts", import.meta.url), "utf8");
const relayRouteSource = await readFile(new URL("../app/api/sendatrack/relay/route.ts", import.meta.url), "utf8");
const runtimeEnvCloudflare = await readFile(new URL("../app/lib/runtime-env.cloudflare.ts", import.meta.url), "utf8");
const runtimeEnvVercel = await readFile(new URL("../app/lib/runtime-env.vercel.ts", import.meta.url), "utf8");

test("SENDATRACK relay config requires the shared secret and falls back to the dynamically registered URL", () => {
  assert.match(sendatrackSource, /const secret = runtimeEnv\.SENDATRACK_RELAY_SECRET\?\.trim\(\);\s*if \(!secret\) return null;/);
  assert.match(sendatrackSource, /const url = runtimeEnv\.SENDATRACK_RELAY_URL\?\.trim\(\) \|\| await dynamicRelayUrl\(\);/);
});

test("login and fleet requests both go through sendatrackFetch, not raw fetch, so the relay can intercept both", () => {
  assert.match(sendatrackSource, /const response = await sendatrackFetch\(apiUrl\("login"\)/);
  assert.match(sendatrackSource, /const response = await sendatrackFetch\(apiUrl\("list\?"\)/);
});

test("relay failure is classified as a normal service_unavailable, not a raw network error", () => {
  assert.match(sendatrackSource, /if \(!response\.ok\) throw new Error\("service_unavailable"\);/);
});

test("runtime env exposes the relay vars on both platforms", () => {
  for (const source of [runtimeEnvCloudflare, runtimeEnvVercel]) {
    assert.match(source, /SENDATRACK_RELAY_URL\?: string;/);
    assert.match(source, /SENDATRACK_RELAY_SECRET\?: string;/);
  }
});

test("the relay registration endpoint requires the shared secret and a well-formed https URL", () => {
  assert.match(relayRouteSource, /request\.headers\.get\("authorization"\) !== `Bearer \$\{secret\}`/);
  assert.match(relayRouteSource, /!url \|\| !\/\^https:\\\/\\\/\/\.test\(url\)/);
});

test("relay server rejects requests without the correct shared secret", async () => {
  const server = await startServer({ port: 0, secret: "correct-secret" });
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/proxy`, {
      method: "POST",
      headers: { authorization: "Bearer wrong-secret", "content-type": "application/json" },
      body: JSON.stringify({ url: "http://backend2.sendatrack.com/sendatrack/public/api/login" }),
    });
    assert.equal(response.status, 403);
  } finally {
    server.close();
  }
});

test("relay server only forwards to backend2.sendatrack.com, refusing every other host", async () => {
  const server = await startServer({ port: 0, secret: "correct-secret" });
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/proxy`, {
      method: "POST",
      headers: { authorization: "Bearer correct-secret", "content-type": "application/json" },
      body: JSON.stringify({ url: "http://evil.example.com/steal" }),
    });
    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.equal(payload.error, "host_not_allowed");
  } finally {
    server.close();
  }
});

test("relay server rejects anything other than POST /proxy", async () => {
  const server = await startServer({ port: 0, secret: "correct-secret" });
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/anything-else`, {
      method: "POST",
      headers: { authorization: "Bearer correct-secret" },
    });
    assert.equal(response.status, 404);
  } finally {
    server.close();
  }
});
