import { getDispatcherSession } from "../../../lib/company-auth";
import { getWhatsAppConfigurationReadiness, verifyWhatsAppProvider } from "../../../lib/whatsapp-readiness";

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store", "x-robots-tag": "noindex, nofollow, noarchive" } });
}

export async function GET(request: Request) {
  const session = await getDispatcherSession(request);
  if (!session) return json({ error: "authentication_required" }, 401);

  const configuration = getWhatsAppConfigurationReadiness();
  if (!configuration.configurationReady) {
    return json({ ok: true, configuration, provider: null });
  }

  try {
    const provider = await verifyWhatsAppProvider();
    return json({ ok: true, configuration, provider });
  } catch (error) {
    const message = error instanceof Error ? error.message : "provider_verification_failed";
    console.error("[trackfleet:whatsapp] readiness verification failed", { message });
    return json({
      ok: false,
      configuration,
      provider: { providerVerified: false, error: "provider_verification_failed" },
    }, 502);
  }
}
