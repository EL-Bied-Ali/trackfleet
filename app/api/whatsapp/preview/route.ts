import { store } from "trackfleet-delivery-store";
import { runtimeEnv } from "trackfleet-runtime-env";
import { getCompanySession } from "../../../lib/company-auth";
import { isAutomaticWhatsAppEvent, isHistoricalNotification, parseAutomationStartAt, splitLatestPendingNotifications } from "../../../lib/notification-policy";
import { buildAutomaticWhatsAppPayload } from "../../../lib/whatsapp-automation";
import { whatsappTemplateLanguage } from "../../../lib/whatsapp-template";

function maskRecipient(value: string) {
  if (value.length <= 4) return "****";
  return `${"*".repeat(Math.max(4, value.length - 4))}${value.slice(-4)}`;
}

export async function GET(request: Request) {
  const session = await getCompanySession(request);
  if (!session) {
    return Response.json({ error: "authentication_required" }, {
      status: 401,
      headers: { "cache-control": "no-store" },
    });
  }

  const origin = new URL(request.url).origin;
  const pending = await store.listPendingNotifications(session.companyId);
  const eligible = pending.filter((item) => isAutomaticWhatsAppEvent(item.event.type));
  const ignoredCount = pending.length - eligible.length;
  const { actionable, superseded } = splitLatestPendingNotifications(eligible);
  const automationStartAt = parseAutomationStartAt(runtimeEnv.WHATSAPP_AUTOMATION_START_AT);

  const previews = actionable.map((item) => {
    const trackingUrl = new URL(origin);
    trackingUrl.searchParams.set("tracking", item.delivery.trackingToken || item.delivery.id);
    const built = buildAutomaticWhatsAppPayload(item.event.type, item.delivery, trackingUrl.toString());
    const historical = automationStartAt
      ? isHistoricalNotification(item.event.createdAt, automationStartAt)
      : false;

    return {
      deliveryId: item.delivery.id,
      customer: item.delivery.customer,
      destination: item.delivery.destination,
      event: item.event.type,
      eventCreatedAt: item.event.createdAt.toISOString(),
      historical,
      wouldSend: Boolean(built.payload) && !historical,
      reason: historical ? "historical" : built.reason,
      recipient: built.payload ? maskRecipient(built.payload.to) : null,
      templateName: built.payload?.template.name ?? runtimeEnv.WHATSAPP_TEMPLATE_NAME?.trim() ?? null,
      language: built.payload?.template.language.code ?? whatsappTemplateLanguage(),
      parameters: built.payload?.template.components[0].parameters.map((parameter) => parameter.text) ?? [],
      trackingUrl: trackingUrl.toString(),
    };
  });

  return Response.json({
    dryRun: true,
    automationEnabled: runtimeEnv.WHATSAPP_AUTOMATION_ENABLED === "true",
    activationConfigured: Boolean(automationStartAt),
    templateLanguage: whatsappTemplateLanguage(),
    pendingCount: pending.length,
    eligibleCount: eligible.length,
    ignoredCount,
    actionableCount: actionable.length,
    supersededCount: superseded.length,
    previews,
  }, {
    headers: {
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow, noarchive",
    },
  });
}
