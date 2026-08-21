/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { reconcileD1StandbySafely } from "../app/lib/d1-reconciliation-safe";
import { reconcileD1Telemetry } from "../app/lib/d1-telemetry-reconciliation";
import { backfillD1DeliveryHistory } from "../app/lib/d1-history-backfill";
import { d1ReadFailoverActive } from "../app/lib/d1-read-failover";
import { shouldBlockMutationDuringReadFailover } from "../app/lib/d1-read-failover-policy";
import { flushD1MirrorQueue } from "../app/lib/d1-mirror-queue";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  CRON_SECRET?: string;
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

const automationCron = "*/5 * * * *";
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

async function runAutomationTick(env: Env, ctx: ExecutionContext) {
  const secret = env.CRON_SECRET?.trim();
  if (!secret) throw new Error("cron_secret_missing");

  const response = await handler.fetch(new Request("https://trackfleet.internal/api/automation/tick", {
    headers: { authorization: `Bearer ${secret}` },
  }), env, ctx);
  if (!response.ok) throw new Error(`automation_tick_http_${response.status}`);
  console.info("[trackfleet:automation] scheduled tick completed", { status: response.status });
}

async function runScheduledTask(cron: string, env: Env, ctx: ExecutionContext) {
  if (cron === automationCron) {
    await runAutomationTick(env, ctx);
    return;
  }
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
  console.warn("[trackfleet:cron] unknown scheduled task", { cron });
}

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

    const readOnlyLeaseActive = await d1ReadFailoverActive();
    if (shouldBlockMutationDuringReadFailover(request.method, readOnlyLeaseActive)) {
      return readOnlyFailoverResponse();
    }

    const response = await handler.fetch(request, env, ctx);
    // Queued D1 mirror writes (see d1-mirror-queue.ts) are flushed as one
    // batched subrequest after the response is already on its way, so
    // batching doesn't add latency to the request itself.
    ctx.waitUntil(flushD1MirrorQueue());
    return withSecurityHeaders(response);
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    try {
      await runScheduledTask(controller.cron, env, ctx);
    } catch (error) {
      console.error("[trackfleet:cron] scheduled task failed", {
        cron: controller.cron,
        scheduledTime: controller.scheduledTime,
        message: error instanceof Error ? error.message : "unknown_error",
      });
      throw error;
    } finally {
      // Flush whatever mirror writes queued during this run, whether it
      // succeeded or not, before the invocation ends -- there's no waitUntil
      // extension point after a scheduled() call returns.
      await flushD1MirrorQueue();
    }
  },
};

export default worker;
