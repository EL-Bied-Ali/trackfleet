import vinext from "vinext";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { sites } from "./build/sites-vite-plugin";

const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";
const isVercel = Boolean(process.env.VERCEL);
const useSharedPostgres = isVercel || process.env.TRACKFLEET_STORAGE === "postgres";
const useCloudflarePostgresFailover = !isVercel && process.env.TRACKFLEET_STORAGE === "postgres";
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
    useCloudflarePostgresFailover
      ? "./app/lib/delivery-store.cloudflare-postgres-failover.ts"
      : useSharedPostgres
        ? "./app/lib/delivery-store.shared-postgres.ts"
        : "./app/lib/delivery-store.cloudflare.ts",
    import.meta.url,
  ),
);
const fullDeliveryStorePath = fileURLToPath(
  new URL(
    useSharedPostgres ? "./app/lib/delivery-store.full-shared-postgres.ts" : "./app/lib/delivery-store.cloudflare.ts",
    import.meta.url,
  ),
);
const siteStorePath = fileURLToPath(
  new URL(
    useCloudflarePostgresFailover
      ? "./app/lib/site-store.cloudflare-postgres-failover.ts"
      : useSharedPostgres
        ? "./app/lib/site-store.shared-postgres.ts"
        : "./app/lib/site-store.cloudflare.ts",
    import.meta.url,
  ),
);
const loginRateLimitPath = fileURLToPath(
  new URL(
    useSharedPostgres ? "./app/lib/login-rate-limit.shared-postgres.ts" : "./app/lib/login-rate-limit.cloudflare.ts",
    import.meta.url,
  ),
);
const automationHeartbeatPath = fileURLToPath(
  new URL(
    useSharedPostgres ? "./app/lib/automation-heartbeat.shared-postgres.ts" : "./app/lib/automation-heartbeat.cloudflare.ts",
    import.meta.url,
  ),
);
const authSessionStorePath = fileURLToPath(
  new URL(
    useCloudflarePostgresFailover
      ? "./app/lib/auth-session-store.cloudflare-postgres-failover.ts"
      : useSharedPostgres
        ? "./app/lib/auth-session-store.shared-postgres.ts"
        : "./app/lib/auth-session-store.cloudflare.ts",
    import.meta.url,
  ),
);
const telemetryRetentionPath = fileURLToPath(
  new URL(
    useSharedPostgres ? "./app/lib/telemetry-retention.shared-postgres.ts" : "./app/lib/telemetry-retention.cloudflare.ts",
    import.meta.url,
  ),
);
const deliveryCompletionPath = fileURLToPath(
  new URL(
    useSharedPostgres ? "./app/lib/delivery-completion.shared-postgres.ts" : "./app/lib/delivery-completion.cloudflare.ts",
    import.meta.url,
  ),
);

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
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
        "trackfleet-delivery-store-full": fullDeliveryStorePath,
        "trackfleet-site-store": siteStorePath,
        "trackfleet-login-rate-limit": loginRateLimitPath,
        "trackfleet-automation-heartbeat": automationHeartbeatPath,
        "trackfleet-auth-session-store": authSessionStorePath,
        "trackfleet-telemetry-retention": telemetryRetentionPath,
        "trackfleet-delivery-completion": deliveryCompletionPath,
      },
    },
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [tailwindcss(), vinext(), sites(), deploymentPlugin],
  };
});
