# TrackFleet production activation

TrackFleet must not run scheduled GPS or WhatsApp automation until production storage is persistent, sessions use a dedicated encryption key, SENDATRACK is configured, and the tick endpoint is protected.

## Vercel production environment

Configure:

- `DATABASE_URL`: Neon Postgres connection string.
- `TRACKFLEET_ENCRYPTION_KEY`: dedicated 32-byte random key encoded as base64. Do not reuse a SENDATRACK password.
- `CRON_SECRET`: a strong random secret used only for `/api/automation/tick`.
- `SENDATRACK_ACCOUNT_ID`: the SENDATRACK company/account identifier.
- `SENDATRACK_USER`: the SENDATRACK automation user.
- `SENDATRACK_PASSWORD`: the current SENDATRACK password used by server-side fleet synchronization.
- `WHATSAPP_AUTOMATION_ENABLED=false` until Meta WhatsApp configuration is complete.

Keep all credentials and secrets only in protected environment variables; never commit them to the repository.

Keep `CRON_SECRET` and the matching GitHub Actions secret on a single line with no surrounding whitespace.

After changing production environment variables, trigger a fresh production deployment so the new values are loaded by the runtime.

After redeploying, `GET /api/health` must report:

- `storage.mode = "postgres"`
- `storage.persistent = true`
- `storage.connected = true`
- `sessionEncryptionConfigured = true`
- `sendatrackConfigured = true`
- `automation.tickProtected = true`
- `automation.missing = []` while WhatsApp automation is disabled

Do not enable the scheduler if health reports memory storage, a disconnected database, `session_encryption_key`, `sendatrack_credentials`, `cron_secret`, or any other missing requirement.

## GitHub Actions scheduler

The workflow `.github/workflows/automation-tick.yml` runs on a five-minute schedule but its job is disabled until explicitly enabled.

Configure repository settings:

- Secret `TRACKFLEET_CRON_SECRET`: exactly the same value as Vercel `CRON_SECRET`.
- Variable `TRACKFLEET_BASE_URL`: optional; defaults to `https://trackfleet-self.vercel.app`.
- Variable `TRACKFLEET_AUTOMATION_ENABLED=true`: set this last, only after `/api/health` is production-ready.

Each scheduled run checks `/api/health` before calling `/api/automation/tick`. The server endpoint independently refuses automation when storage is not persistent, so both the scheduler and application enforce the safety boundary.

## WhatsApp activation

Keep `WHATSAPP_AUTOMATION_ENABLED=false` while the Meta template is under review. Configure the access token, phone-number ID, WhatsApp Business Account ID, exact approved template name and exact Meta language code.

Before enabling WhatsApp, sign in to TrackFleet and call `GET /api/whatsapp/preflight`. It must report `readyToEnable=true`. This preflight verifies persistent storage, the session encryption key, SENDATRACK, cron protection, Meta provider access, the business account, phone number, template approval and the exact three-parameter template contract.

Immediately before activation, set `WHATSAPP_AUTOMATION_START_AT` to the activation timestamp, then set `WHATSAPP_AUTOMATION_ENABLED=true` and deploy once. The activation boundary prevents historical queued events from being sent as catch-up messages.
