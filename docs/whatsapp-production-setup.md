# WhatsApp production setup

TrackFleet automatic WhatsApp notifications are opt-in only. The automatic path sends only these customer events: `REGISTERED`, `DEPARTED`, `DELAY_DETECTED`, `NEAR_DESTINATION`, and `ARRIVED`.

## Meta values required

Collect these values from the Meta WhatsApp Cloud API setup and WhatsApp Manager. Do not commit them to GitHub.

- `WHATSAPP_ACCESS_TOKEN`: production/permanent access token with permission to send WhatsApp messages.
- `WHATSAPP_PHONE_NUMBER_ID`: the Phone Number ID used by the `/messages` Cloud API endpoint. This is not the visible `+1 555...` test phone number.
- `WHATSAPP_BUSINESS_ACCOUNT_ID`: the WABA ID. TrackFleet requires it for the production preflight so it can verify the approved template instead of only verifying the phone number.
- `WHATSAPP_TEMPLATE_NAME`: exact approved template name.
- `WHATSAPP_TEMPLATE_LANGUAGE`: exact template language code returned by Meta, for example `fr`, `fr_FR`, or `en_US`.

## Template contract

The current TrackFleet payload sends exactly three body text parameters, in this order:

1. customer/company name
2. TrackFleet delivery ID
3. the event-specific customer message, including the tracking URL when relevant

Create one approved Utility template whose BODY contains exactly three variables. The initial TrackFleet template submitted to Meta uses:

```text
Bonjour {{1}}, mise à jour concernant votre colis {{2}} : {{3}} Merci.
```

Do not remove the text after `{{3}}`: Meta does not accept a template whose variable is the final content of the BODY.

For review examples, non-sensitive values such as these are sufficient:

```text
{{1}} Jean Dupont
{{2}} TF-1001
{{3}} Votre colis est parti vers Bruxelles. Suivi : https://example.com/suivi/TF-1001
```

Use the exact template name and language returned by Meta in the production environment variables. Do not enable production automation while the template is still pending or rejected.

## Production environment variables

Configure these for the production environment:

```text
WHATSAPP_ACCESS_TOKEN=<secret>
WHATSAPP_PHONE_NUMBER_ID=<phone number id>
WHATSAPP_BUSINESS_ACCOUNT_ID=<waba id>
WHATSAPP_TEMPLATE_NAME=trackfleet_delivery_update
WHATSAPP_TEMPLATE_LANGUAGE=<exact approved template language>
WHATSAPP_DEMO_ENABLED=false
WHATSAPP_AUTOMATION_ENABLED=false
WHATSAPP_AUTOMATION_START_AT=
```

Keep automation disabled for the first readiness check. Never commit the access token to GitHub or paste it into support/chat messages.

## Public Meta URLs

Once deployed, TrackFleet exposes public legal pages that can be used during production setup:

```text
/privacy
/data-deletion
```

These pages intentionally contain no integration secrets.

## Safe activation sequence

1. Deploy with the provider variables set but `WHATSAPP_AUTOMATION_ENABLED=false`.
2. Confirm `/api/health` reports persistent storage connected and the provider configuration present.
3. While authenticated in TrackFleet, call `/api/whatsapp/preflight`.
4. Confirm `readyToEnable: true`. This verifies persistent storage, scheduler protection, provider configuration, WABA availability, the Meta phone number, template approval and the exact three-variable BODY contract.
5. If preflight reports `wait_for_approved_template`, leave automation disabled and wait for Meta approval.
6. Optionally inspect `/api/whatsapp/preview` to see which pending notifications would be sent without sending anything.
7. Set `WHATSAPP_AUTOMATION_START_AT` to the current ISO timestamp immediately before enabling automation. This prevents older queued events from being sent as catch-up messages.
8. Set `WHATSAPP_AUTOMATION_ENABLED=true` and deploy once.
9. Call `/api/whatsapp/preflight` again and confirm `readyToRun: true`.
10. Create a new test parcel using a WhatsApp-capable customer number and explicitly tick the WhatsApp consent checkbox.
11. The new `REGISTERED` event should be the first real automatic message.
12. Open the received tracking link and verify that the public page contains no internal contact, tenant, raw tracking token, provider credential, or consent fields.

## Expected preflight actions

`/api/whatsapp/preflight` returns a safe `nextAction` value instead of exposing secrets. Typical values are:

- `configure_persistent_storage`
- `configure_cron_secret`
- `configure_whatsapp_provider`
- `configure_whatsapp_business_account`
- `verify_whatsapp_phone_number`
- `verify_whatsapp_template_access`
- `wait_for_approved_template`
- `fix_template_body_parameters`
- `set_automation_start_at`
- `enable_automation`
- `ready`

## Rollback

If Meta rejects sends or any unexpected message is observed, set `WHATSAPP_AUTOMATION_ENABLED=false`. Provider/configuration failures remain retryable, while missing consent or missing customer phone are permanently suppressed for that queued event.
