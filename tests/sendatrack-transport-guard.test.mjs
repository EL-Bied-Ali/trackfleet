import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sendatrackModule = new URL("../app/lib/sendatrack.ts", import.meta.url);
const transportModule = new URL("../app/lib/sendatrack-transport.ts", import.meta.url);

function functionBody(source, signature, nextSignature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `missing ${signature}`);
  const end = nextSignature ? source.indexOf(nextSignature, start + signature.length) : source.length;
  assert.notEqual(end, -1, `missing ${nextSignature}`);
  return source.slice(start, end);
}

test("SENDATRACK HTTP requires an explicit risk override before credentials or bearer tokens can be sent", async () => {
  const [source, transport] = await Promise.all([
    readFile(sendatrackModule, "utf8"),
    readFile(transportModule, "utf8"),
  ]);

  assert.match(transport, /TRACKFLEET_ALLOW_INSECURE_SENDATRACK === "true"/);
  assert.match(transport, /sendatrackTransportIsSecure\(\) \|\| insecureSendatrackTransportExplicitlyAllowed\(\)/);
  assert.match(source, /import \{ sendatrackTransportIsAllowed \} from "\.\/sendatrack-transport"/);
  assert.match(source, /function requireAllowedTransport\(\)[\s\S]*!sendatrackTransportIsAllowed\(\)[\s\S]*throw new Error\("service_unavailable"\)/);

  const login = functionBody(source, "async function login", "async function requestFleetPayload");
  const loginGuard = login.indexOf("requireAllowedTransport();");
  const credentialFetch = login.indexOf("sendatrackFetch(apiUrl(\"login\")");
  assert.ok(loginGuard >= 0 && credentialFetch >= 0 && loginGuard < credentialFetch, "login must enforce the transport policy before sending credentials");

  const fleet = functionBody(source, "async function requestFleetPayload", "async function requestFleet(");
  const fleetGuard = fleet.indexOf("requireAllowedTransport();");
  const bearerFetch = fleet.indexOf("sendatrackFetch(apiUrl(\"list?\")");
  assert.ok(fleetGuard >= 0 && bearerFetch >= 0 && fleetGuard < bearerFetch, "fleet requests must enforce the transport policy before sending bearer tokens");
});
