import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sendatrackModule = new URL("../app/lib/sendatrack.ts", import.meta.url);

function functionBody(source, signature, nextSignature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `missing ${signature}`);
  const end = nextSignature ? source.indexOf(nextSignature, start + signature.length) : source.length;
  assert.notEqual(end, -1, `missing ${nextSignature}`);
  return source.slice(start, end);
}

test("SENDATRACK credentials and bearer tokens fail closed on insecure transport", async () => {
  const source = await readFile(sendatrackModule, "utf8");
  assert.match(source, /import \{ sendatrackTransportIsSecure \} from "\.\/sendatrack-transport"/);
  assert.match(source, /function requireSecureTransport\(\)[\s\S]*!sendatrackTransportIsSecure\(\)[\s\S]*throw new Error\("service_unavailable"\)/);

  const login = functionBody(source, "async function login", "async function requestFleetPayload");
  const loginGuard = login.indexOf("requireSecureTransport();");
  const credentialFetch = login.indexOf("fetch(apiUrl(\"login\")");
  assert.ok(loginGuard >= 0 && credentialFetch >= 0 && loginGuard < credentialFetch, "login must block insecure transport before sending credentials");

  const fleet = functionBody(source, "async function requestFleetPayload", "async function requestFleet(");
  const fleetGuard = fleet.indexOf("requireSecureTransport();");
  const bearerFetch = fleet.indexOf("fetch(apiUrl(\"list?\")");
  assert.ok(fleetGuard >= 0 && bearerFetch >= 0 && fleetGuard < bearerFetch, "fleet requests must block insecure transport before sending bearer tokens");
});
