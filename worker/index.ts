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

// Used only to construct the Request object for the in-process handler.fetch()
// calls below -- this never touches the network (Cloudflare Cron Triggers
// invoke the Worker's own fetch handler directly, not a real HTTP request),
// so it's purely a URL to parse for routing. It must be the real production
// origin, not a placeholder: notification-tick derives the customer-facing
// tracking link's base URL from this request's origin (see
// notification-maintenance-tick.ts), so a fake hostname here shipped broken,
// unclickable WhatsApp tracking links straight to customers -- reproduced
// live the first time a real notification successfully sent.
const productionOrigin = "https://trackfleet.chronoplan.workers.dev";

// Slowed from every 5 minutes to every 15 on 2026-09-02, after D1
// rows_written actually hit the free-tier 100k/day cap (not just the 76%
// warning from the reconciliation-cron fix the day before) -- the live
// automation tick's own D1 mirror writes (position/status/ETA per vehicle,
// every tick) were still a meaningful, legitimate contributor on top of
// that fix. This is a multi-day Belgium-Morocco corridor, not last-mile
// delivery -- 15-minute position granularity is imperceptible to a customer
// tracking a days-long trip, unlike the reconciliation crons' pure waste.
// Deliberately NOT reduced further overnight (e.g. paused entirely
// midnight-6am): the corridor includes a real Tanger Med ferry crossing, a
// truck can plausibly reach the hub at any hour, and delaying arrival
// detection (and the customer's WhatsApp notification) by hours for a
// modest additional saving isn't worth the risk.
const automationCron = "*/15 * * * *";
const notificationMaintenanceCron = "5,20,35,50 * * * *";
// Reduced from every 15 minutes (96/day each) to hourly on 2026-09-01 --
// reconcileD1Standby/reconcileD1Telemetry were the top two D1 rows_written
// consumers, together pushing the free-tier 100k/day cap. Telemetry now
// also does exact delta sync (see d1-telemetry-reconciliation.ts); standby
// still does a full resync each run, so it stays on the less frequent
// hourly cadence -- acceptable staleness for a Postgres-outage-only
// failover copy, not a normal read path.
const operationalReconciliationCron = "18 * * * *";
const telemetryReconciliationCron = "48 * * * *";
const historyBackfillCron = "10,25,40,55 * * * *";

const securityHeaders = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
} as const;

const defaultPermissionsPolicy = "camera=(), microphone=(), geolocation=()";
// geolocation=() here silently blocked /scan's own watchPosition (see
// app/scan/page.tsx) from ever getting a real position -- the browser fails
// the request before its own permission prompt, and the error callback
// swallows that as if the user had simply declined, so the loaded/hub scan
// badges never showed a location no matter how many times a real phone
// tried. Live-caught: "je vien de tester et sa a donner sa / Chargé / 03
// sept., 20:39 · 11595-A-74" -- no location at all, on a real scan.
const scannerPermissionsPolicy = "camera=(self), microphone=(), geolocation=(self)";

function withSecurityHeaders(response: Response, pathname = "") {
  const secured = new Response(response.body, response);
  for (const [key, value] of Object.entries(securityHeaders)) secured.headers.set(key, value);
  secured.headers.set("Permissions-Policy", pathname === "/scan" ? scannerPermissionsPolicy : defaultPermissionsPolicy);
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

  const response = await handler.fetch(new Request(`${productionOrigin}/api/automation/tick`, {
    headers: { authorization: `Bearer ${secret}` },
  }), env, ctx);
  if (!response.ok) throw new Error(`automation_tick_http_${response.status}`);
  console.info("[trackfleet:automation] scheduled tick completed", { status: response.status });
}

async function runNotificationMaintenanceTick(env: Env, ctx: ExecutionContext) {
  const secret = env.CRON_SECRET?.trim();
  if (!secret) throw new Error("cron_secret_missing");

  const response = await handler.fetch(new Request(`${productionOrigin}/api/automation/notification-tick`, {
    headers: { authorization: `Bearer ${secret}` },
  }), env, ctx);
  if (!response.ok) throw new Error(`notification_tick_http_${response.status}`);
  console.info("[trackfleet:automation] scheduled notification maintenance tick completed", { status: response.status });
}

async function runScheduledTask(cron: string, env: Env, ctx: ExecutionContext) {
  if (cron === automationCron) {
    await runAutomationTick(env, ctx);
    return;
  }
  if (cron === notificationMaintenanceCron) {
    await runNotificationMaintenanceTick(env, ctx);
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
    return withSecurityHeaders(response, new URL(request.url).pathname);
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
