# TrackFleet production activation

TrackFleet must not run scheduled GPS automation until production storage is persistent and the tick endpoint is protected.

## Vercel production environment

Configure:

- `DATABASE_URL`: Neon Postgres connection string.
- `CRON_SECRET`: a strong random secret used only for `/api/automation/tick`.
- `WHATSAPP_AUTOMATION_ENABLED=false` until Meta WhatsApp configuration is complete.

SENDATRACK credentials must remain configured as they are today.

After changing production environment variables, trigger a fresh production deployment so the new values are loaded by the runtime.

After redeploying, `GET /api/health` must report:

- `storage.mode = "postgres"`
- `storage.persistent = true`
- `storage.connected = true`
- `automation.tickProtected = true`
- `automation.missing = []` while WhatsApp automation is disabled

Do not enable the scheduler if health still reports `memory`, a disconnected database, or a missing cron secret.

## GitHub Actions scheduler

The workflow `.github/workflows/automation-tick.yml` runs on a five-minute schedule but its job is disabled until explicitly enabled.

Configure repository settings:

- Secret `TRACKFLEET_CRON_SECRET`: exactly the same value as Vercel `CRON_SECRET`.
- Variable `TRACKFLEET_BASE_URL`: optional; defaults to `https://trackfleet-self.vercel.app`.
- Variable `TRACKFLEET_AUTOMATION_ENABLED=true`: set this last, only after `/api/health` is production-ready.

Each scheduled run checks `/api/health` before calling `/api/automation/tick`. The server endpoint independently refuses automation when storage is not persistent, so both the scheduler and application enforce the safety boundary.

## WhatsApp activation

Enable WhatsApp only after persistent storage and the scheduler are proven stable. Then configure the Meta provider credentials, approved template name, and `WHATSAPP_AUTOMATION_START_AT` before changing `WHATSAPP_AUTOMATION_ENABLED=true`.
