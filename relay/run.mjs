// Orchestrator: starts the local relay HTTP server, opens a Cloudflare
// quick tunnel to it, and registers the tunnel's public URL with the
// TrackFleet Worker so it knows where to send SENDATRACK calls. Quick
// tunnel URLs change every time cloudflared (re)starts, so this
// re-registers automatically whenever that happens -- no fixed domain
// required. See relay/README.md for setup.
import { spawn } from "node:child_process";
import { startServer } from "./server.mjs";

const port = Number(process.env.PORT ?? 8787);
const secret = (process.env.RELAY_SHARED_SECRET ?? "").trim();
const registerUrl = (process.env.TRACKFLEET_REGISTER_URL ?? "https://trackfleet.chronoplan.workers.dev/api/sendatrack/relay").trim();
const cloudflaredBin = process.env.CLOUDFLARED_BIN ?? "cloudflared";

if (!secret) {
  console.error("RELAY_SHARED_SECRET is not set. Refusing to start.");
  process.exit(1);
}

let lastRegisteredUrl = null;

async function registerUrlWithWorker(publicUrl) {
  if (publicUrl === lastRegisteredUrl) return;
  try {
    const response = await fetch(registerUrl, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
      body: JSON.stringify({ url: `${publicUrl}/proxy` }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      console.error(`registration failed: HTTP ${response.status}`);
      return;
    }
    lastRegisteredUrl = publicUrl;
    console.log(`registered relay URL with TrackFleet: ${publicUrl}`);
  } catch (error) {
    console.error("registration request failed", error instanceof Error ? error.message : String(error));
  }
}

function startTunnel() {
  console.log("starting cloudflared tunnel...");
  const child = spawn(cloudflaredBin, ["tunnel", "--url", `http://127.0.0.1:${port}`, "--no-autoupdate"], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  const urlPattern = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
  const onOutput = (chunk) => {
    const match = chunk.toString("utf8").match(urlPattern);
    if (match) registerUrlWithWorker(match[0]);
  };
  child.stdout.on("data", onOutput);
  child.stderr.on("data", onOutput);

  child.on("exit", (code) => {
    console.error(`cloudflared exited (code ${code}), restarting in 5s...`);
    lastRegisteredUrl = null;
    setTimeout(startTunnel, 5_000);
  });
}

await startServer({ port, secret });
console.log(`relay HTTP server listening on :${port}`);
startTunnel();
