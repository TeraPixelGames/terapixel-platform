# control-plane

Persistent multi-tenant administration service for Terapixel platform.

## Responsibilities

- Onboard/offboard titles per tenant.
- Maintain per-environment service endpoints.
- Store and rotate magic-link notify routing secrets.
- Version and schedule feature flags + IAP catalogs.
- Enforce admin access using Google Workspace ID tokens.
- Write immutable audit logs and service event records.
- Expose internal runtime config endpoint for other platform services.

## API

- `GET /healthz`
- `GET /admin` (browser admin panel for title onboarding/offboarding and notify target config)
- `GET /v1/admin/me`
- `GET /v1/admin/titles`
- `POST /v1/admin/titles`
- `PATCH /v1/admin/titles/:gameId/status`
- `PUT /v1/admin/titles/:gameId/environments/:environment/services/:serviceKey`
- `PUT /v1/admin/titles/:gameId/environments/:environment/notify-target`
- `POST /v1/admin/titles/:gameId/environments/:environment/feature-flags`
- `POST /v1/admin/titles/:gameId/environments/:environment/iap-catalog`
- `POST /v1/admin/titles/:gameId/environments/:environment/iap-schedules`
- `GET /v1/admin/events`
- `GET /v1/internal/runtime/identity-config?game_id=...&environment=...` (`x-admin-key` required)

## Required env

- `DATABASE_URL`
- `GOOGLE_OAUTH_CLIENT_ID`

## Recommended env

- `GOOGLE_WORKSPACE_DOMAINS` (CSV allowlist)
- `CONTROL_PLANE_BOOTSTRAP_EMAILS` (CSV; first owners)
- `INTERNAL_SERVICE_KEY`
- `PLATFORM_CONFIG_ENCRYPTION_KEY` (32-byte base64 or 64-char hex)
- `CORS_ALLOWED_ORIGINS`

## Magic-Link Notify Routing

Identity-gateway can resolve notify targets per `game_id` and `environment` from control-plane.

1. Configure identity-gateway runtime provider:
   - `PLATFORM_CONFIG_STORE_TYPE=http` (or `postgres`)
   - `PLATFORM_CONFIG_SERVICE_URL=https://<control-plane-host>`
   - `PLATFORM_CONFIG_INTERNAL_KEY=<INTERNAL_SERVICE_KEY>`
   - `PLATFORM_CONFIG_ENVIRONMENT=prod` (or `staging`)

2. Upsert per-title notify target:
   - `PUT /v1/admin/titles/:gameId/environments/:environment/notify-target`
   - body:
     - `notifyUrl`: Nakama RPC endpoint (for example `https://<game>.onrender.com/v2/rpc/tpx_account_magic_link_notify`)
     - `notifyHttpKey`: Nakama runtime `http_key`
     - `sharedSecret`: same value as game backend `TPX_MAGIC_LINK_NOTIFY_SECRET`

## Bootstrap Command

Use one command to onboard a title and optionally set `staging` + `prod` magic-link notify targets:

```bash
npm run control-plane:onboard-title -- \
  --game-id color_crunch \
  --title-name "Color Crunch" \
  --tenant-slug terapixel \
  --tenant-name "TeraPixel" \
  --environments staging,prod \
  --staging-nakama-base-url https://colorcrunch-staging-nakama.onrender.com \
  --staging-notify-http-key <staging_nakama_runtime_http_key> \
  --staging-shared-secret <staging_tpx_magic_link_notify_secret> \
  --prod-nakama-base-url https://colorcrunch-nakama.onrender.com \
  --prod-notify-http-key <prod_nakama_runtime_http_key> \
  --prod-shared-secret <prod_tpx_magic_link_notify_secret>
```

Notes:
- `DATABASE_URL` is used automatically unless `--database-url` is provided.
- `PLATFORM_CONFIG_ENCRYPTION_KEY` is required when writing notify target secrets.
