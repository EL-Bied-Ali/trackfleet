/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { reconcileD1StandbySafely } from "../app/lib/d1-reconciliation-safe";
import { reconcileD1Telemetry } from "../app/lib/d1-telemetry-reconciliation";
import { backfillD1DeliveryHistory } from "../app/lib/d1-history-backfill";
import { d1ReadFailoverActive } from "../app/lib/d1-read-failover";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

interface ScheduledController {
  cron: string;
  scheduledTime: number;
  noRetry(): void;
}

const operationalReconciliationCron = "*/15 * * * *";
const telemetryReconciliationCron = "5,20,35,50 * * * *";
const historyBackfillCron = "10,25,40,55 * * * *";

const securityHeaders = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
} as const;

function withSecurityHeaders(response: Response) {
  const secured = new Response(response.body, response);
  for (const [key, value] of Object.entries(securityHeaders)) secured.headers.set(key, value);
  return secured;
}

function readOnlyFailoverResponse() {
  return withSecurityHeaders(Response.json({
    error: "read_only_failover",
    message: "TrackFleet is temporarily read-only while the primary database is unavailable.",
  }, {
    status: 503,
    headers: {
      "cache-control": "no-store",
      "retry-after": "60",
    },
  }));
}

async function runScheduledStandbyMaintenance(cron: string) {
  if (cron === operationalReconciliationCron) {
    const result = await reconcileD1StandbySafely();
    console.info("[trackfleet:replication] scheduled operational reconciliation", result);
    return;
  }
  if (cron === telemetryReconciliationCron) {
    const result = await reconcileD1Telemetry();
    console.info("[trackfleet:replication] scheduled telemetry reconciliation", result);
    return;
  }
  if (cron === historyBackfillCron) {
    const result = await backfillD1DeliveryHistory();
    console.info("[trackfleet:replication] scheduled history backfill", result);
    return;
  }
  console.warn("[trackfleet:replication] unknown scheduled maintenance cron", { cron });
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      const response = await handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
      return withSecurityHeaders(response);
    }

    if (request.method !== "GET" && request.method !== "HEAD" && await d1ReadFailoverActive()) {
      return readOnlyFailoverResponse();
    }

    return withSecurityHeaders(await handler.fetch(request, env, ctx));
  },

  async scheduled(controller: ScheduledController, _env: Env, _ctx: ExecutionContext): Promise<void> {
    try {
      await runScheduledStandbyMaintenance(controller.cron);
    } catch (error) {
      console.error("[trackfleet:replication] scheduled standby maintenance failed", {
        cron: controller.cron,
        scheduledTime: controller.scheduledTime,
        message: error instanceof Error ? error.message : "unknown_error",
      });
      throw error;
    }
  },
};

export default worker;
