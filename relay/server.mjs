// SENDATRACK relay HTTP server: a tiny, dependency-free proxy meant to run
// on a device with a residential/mobile IP (see relay/README.md).
// SENDATRACK's own network rejects requests from Cloudflare's (and most
// cloud/datacenter) IP ranges, so the TrackFleet Worker forwards its
// SENDATRACK calls here instead of calling backend2.sendatrack.com directly.
// This process only forwards to that one host -- it is not a general-purpose
// open proxy.
import http from "node:http";

const allowedHost = "backend2.sendatrack.com";
const upstreamTimeoutMs = 10_000;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
  res.end(body);
}

export function startServer({ port, secret }) {
  if (!secret) throw new Error("RELAY_SHARED_SECRET is required");

  const server = http.createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/proxy") {
      sendJson(res, 404, { error: "not_found" });
      return;
    }

    if (req.headers.authorization !== `Bearer ${secret}`) {
      sendJson(res, 403, { error: "forbidden" });
      return;
    }

    let target;
    let request;
    try {
      const raw = await readBody(req);
      request = JSON.parse(raw);
      target = new URL(String(request.url));
    } catch {
      sendJson(res, 400, { error: "invalid_request" });
      return;
    }

    if (target.hostname !== allowedHost) {
      sendJson(res, 400, { error: "host_not_allowed" });
      return;
    }

    try {
      const upstream = await fetch(target, {
        method: request.method ?? "GET",
        headers: request.headers ?? {},
        body: request.body ?? undefined,
        signal: AbortSignal.timeout(upstreamTimeoutMs),
      });
      const bodyText = await upstream.text();
      const headers = {};
      upstream.headers.forEach((value, key) => { headers[key] = value; });
      sendJson(res, 200, { status: upstream.status, headers, body: bodyText });
    } catch (error) {
      console.error("relay upstream call failed", error instanceof Error ? error.message : String(error));
      sendJson(res, 502, { error: "upstream_unreachable" });
    }
  });

  return new Promise((resolve) => {
    server.listen(port, () => resolve(server));
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 8787);
  const secret = (process.env.RELAY_SHARED_SECRET ?? "").trim();
  startServer({ port, secret }).then(() => {
    console.log(`sendatrack relay listening on :${port}`);
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
