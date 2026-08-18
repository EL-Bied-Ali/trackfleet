# WhatsApp production setup

TrackFleet automatic WhatsApp notifications are opt-in only. The automatic path sends only these customer events: `REGISTERED`, `DEPARTED`, `DELAY_DETECTED`, `NEAR_DESTINATION`, and `ARRIVED`.

## Meta values required

Collect these values from the Meta WhatsApp Cloud API setup and WhatsApp Manager. Do not commit them to GitHub.

- `WHATSAPP_ACCESS_TOKEN`: production/permanent access token with permission to send WhatsApp messages.
- `WHATSAPP_PHONE_NUMBER_ID`: the Phone Number ID used by the `/messages` Cloud API endpoint.
- `WHATSAPP_BUSINESS_ACCOUNT_ID`: the WABA ID. Optional for sending, but recommended because TrackFleet uses it to verify that the configured template exists, is approved, and matches the configured language.
- `WHATSAPP_TEMPLATE_NAME`: exact approved template name.
- `WHATSAPP_TEMPLATE_LANGUAGE`: exact template language code shown by Meta, for example `fr`, `fr_FR`, or `en_US`.

## Template contract

The current TrackFleet payload sends exactly three body text parameters, in this order:

1. customer/company name
2. TrackFleet delivery ID
3. the event-specific customer message, including the tracking URL when relevant

Create one approved Utility template whose BODY contains exactly three variables. Recommended initial body:

```text
Bonjour {{1}}, mise à jour concernant votre colis {{2}} : {{3}}
```

Use the exact template name and language returned by Meta in the Vercel variables. Do not enable production automation while the template is still pending or rejected.

## Vercel production variables

Configure these for the Production environment:

```text
WHATSAPP_ACCESS_TOKEN=<secret>
WHATSAPP_PHONE_NUMBER_ID=<phone number id>
WHATSAPP_BUSINESS_ACCOUNT_ID=<waba id>
WHATSAPP_TEMPLATE_NAME=<exact approved template name>
WHATSAPP_TEMPLATE_LANGUAGE=<exact approved template language>
WHATSAPP_DEMO_ENABLED=false
WHATSAPP_AUTOMATION_ENABLED=false
WHATSAPP_AUTOMATION_START_AT=
```

Keep automation disabled for the first readiness check.

## Safe activation sequence

1. Deploy with the provider variables set but `WHATSAPP_AUTOMATION_ENABLED=false`.
2. Confirm `/api/health` reports `whatsappProviderConfigured: true`.
3. While authenticated in TrackFleet, call `/api/whatsapp/readiness` and confirm the provider and template checks are green.
4. Create a test parcel using a real WhatsApp-capable customer number and explicitly tick the WhatsApp consent checkbox.
5. Set `WHATSAPP_AUTOMATION_START_AT` to the current ISO timestamp immediately before enabling automation.
6. Set `WHATSAPP_AUTOMATION_ENABLED=true` and redeploy.
7. Create a new opted-in test parcel. The new `REGISTERED` event should be the first real automatic message.
8. Open the received tracking link and verify that the public page contains no internal contact, tenant, token, or consent fields.

## Rollback

If Meta rejects sends or any unexpected message is observed, set `WHATSAPP_AUTOMATION_ENABLED=false`. Provider/configuration failures remain retryable, while missing consent or missing customer phone are permanently suppressed for that queued event.
