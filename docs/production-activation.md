# TrackFleet production activation

TrackFleet production is served from Cloudflare Workers at `https://trackfleet.chronoplan.workers.dev`, with Neon Postgres as the authoritative database and Cloudflare D1 as a readiness-gated read-only standby.

Do not start scheduled GPS or WhatsApp automation until production storage is persistent, sessions use a dedicated encryption key, SENDATRACK is configured, and the automation endpoint is protected.

## Cloudflare production environment

Configure these Worker secrets/environment values:

- `DATABASE_URL`: Neon Postgres connection string.
- `TRACKFLEET_ENCRYPTION_KEY`: dedicated 32-byte random key encoded as base64. Do not reuse a SENDATRACK password.
- `CRON_SECRET`: a strong random secret used only for `/api/automation/tick`.
- `SENDATRACK_ACCOUNT_ID`: the SENDATRACK company/account identifier.
- `SENDATRACK_USER`: the SENDATRACK automation user.
- `SENDATRACK_PASSWORD`: the current SENDATRACK password used by server-side fleet synchronization.
- `WHATSAPP_AUTOMATION_ENABLED=false` until Meta WhatsApp configuration is complete.

Keep all credentials and secrets only in protected Cloudflare/GitHub secrets; never commit them to the repository.

After changing Worker secrets or environment values, deploy the validated `main` commit so the runtime loads the new configuration.

## Mandatory launch health check

`GET https://trackfleet.chronoplan.workers.dev/api/health` must report:

- `ok = true`
- `storage.mode = "postgres"`
- `storage.persistent = true`
- `storage.connected = true`
- `sessionEncryptionConfigured = true`
- `sendatrackConfigured = true`
- `automation.tickProtected = true`
- `automation.missing = []` while WhatsApp automation is disabled

The D1 standby is reported separately under `storage.failover`. D1 readiness must never be used as a substitute for an unhealthy primary during normal launch verification.

Do not enable customer automation if health reports memory storage, a disconnected database, a missing session encryption key, missing SENDATRACK credentials, a missing cron secret, or another missing requirement.

## D1 standby and failover

Cloudflare runs three D1 maintenance Cron Triggers for operational reconciliation, telemetry reconciliation, and historical backfill. Read-only failover is readiness-gated: D1 may serve reads only when its replication streams are fresh and historical coverage is complete. Business writes remain Postgres-only and external mutation requests are blocked during an active read-only failover lease.

On Cloudflare, read failover is authorized by default when no explicit override is set. `TRACKFLEET_D1_READ_FAILOVER=false` is the immediate kill switch. The controlled real-outage drill is tracked separately and does not block the initial MVP unless standby health exposes a production problem.

## GPS / business automation scheduler

The workflow `.github/workflows/automation-tick.yml` calls `/api/automation/tick` for SENDATRACK synchronization and business automation. This is separate from the Worker Cron Triggers used for D1 maintenance.

Configure repository settings:

- Secret `TRACKFLEET_CRON_SECRET`: exactly the same value as the Worker `CRON_SECRET`.
- Variable `TRACKFLEET_BASE_URL=https://trackfleet.chronoplan.workers.dev`.
- Variable `TRACKFLEET_AUTOMATION_ENABLED=true`: set this last, only after `/api/health` passes the launch checks.

Each scheduled run checks `/api/health` before calling `/api/automation/tick`. The server endpoint independently refuses unsafe automation, so both the scheduler and application enforce the safety boundary.

## Pre-client smoke test

Run the `Deployed site smoke test` workflow with its default Cloudflare URL. It must pass the production health checks, anonymous-session boundary, rendered login screen, and browser smoke test before handing access to the client.

## WhatsApp activation

Keep `WHATSAPP_AUTOMATION_ENABLED=false` while the Meta template is under review or while the client has not approved notifications. Configure the access token, phone-number ID, WhatsApp Business Account ID, exact approved template name and exact Meta language code.

Before enabling WhatsApp, sign in to TrackFleet and call `GET /api/whatsapp/preflight`. It must report `readyToEnable=true`. This preflight verifies persistent storage, the session encryption key, SENDATRACK, cron protection, Meta provider access, the business account, phone number, template approval and the exact template contract.

Immediately before activation, set `WHATSAPP_AUTOMATION_START_AT` to the activation timestamp, then set `WHATSAPP_AUTOMATION_ENABLED=true` and deploy once. The activation boundary prevents historical queued events from being sent as catch-up messages.
