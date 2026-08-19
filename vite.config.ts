import vinext from "vinext";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import hostingConfig from "./.openai/hosting.json";
import { sites } from "./build/sites-vite-plugin";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";
const isVercel = Boolean(process.env.VERCEL);
const maplibreCssPath = fileURLToPath(
  new URL("./node_modules/maplibre-gl/dist/maplibre-gl.css", import.meta.url),
);
const runtimeEnvPath = fileURLToPath(
  new URL(
    isVercel ? "./app/lib/runtime-env.vercel.ts" : "./app/lib/runtime-env.cloudflare.ts",
    import.meta.url,
  ),
);
const deliveryStorePath = fileURLToPath(
  new URL(
    isVercel ? "./app/lib/delivery-store.vercel.ts" : "./app/lib/delivery-store.cloudflare.ts",
    import.meta.url,
  ),
);
const siteStorePath = fileURLToPath(
  new URL(
    isVercel ? "./app/lib/site-store.vercel.ts" : "./app/lib/site-store.cloudflare.ts",
    import.meta.url,
  ),
);
const loginRateLimitPath = fileURLToPath(
  new URL(
    isVercel ? "./app/lib/login-rate-limit.vercel.ts" : "./app/lib/login-rate-limit.cloudflare.ts",
    import.meta.url,
  ),
);
const automationHeartbeatPath = fileURLToPath(
  new URL(
    isVercel ? "./app/lib/automation-heartbeat.vercel.ts" : "./app/lib/automation-heartbeat.cloudflare.ts",
    import.meta.url,
  ),
);
const authSessionStorePath = fileURLToPath(
  new URL(
    isVercel ? "./app/lib/auth-session-store.vercel.ts" : "./app/lib/auth-session-store.cloudflare.ts",
    import.meta.url,
  ),
);

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig(async () => {
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  const deploymentPlugin = isVercel
    ? (await import("nitro/vite")).nitro()
    : (await import("@cloudflare/vite-plugin")).cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      });

  return {
    resolve: {
      alias: {
        "maplibre-gl/dist/maplibre-gl.css": maplibreCssPath,
        "trackfleet-runtime-env": runtimeEnvPath,
        "trackfleet-delivery-store": deliveryStorePath,
        "trackfleet-site-store": siteStorePath,
        "trackfleet-login-rate-limit": loginRateLimitPath,
        "trackfleet-automation-heartbeat": automationHeartbeatPath,
        "trackfleet-auth-session-store": authSessionStorePath,
      },
    },
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [tailwindcss(), vinext(), sites(), deploymentPlugin],
  };
});
