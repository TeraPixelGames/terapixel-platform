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
- `PUT /v1/admin/titles/:gameId/environments/:environment/iap-providers/:providerKey`
- `POST /v1/admin/titles/:gameId/environments/:environment/feature-flags`
- `POST /v1/admin/titles/:gameId/environments/:environment/iap-catalog`
- `POST /v1/admin/titles/:gameId/environments/:environment/iap-schedules`
- `GET /v1/admin/events`
- `GET /v1/internal/runtime/identity-config?game_id=...&environment=...` (`x-admin-key` required)

## Required env

- `DATABASE_URL`
- one of:
  - `GOOGLE_OAUTH_CLIENT_ID` (Workspace SSO)
  - `CONTROL_PLANE_SIMPLE_AUTH_KEY` (temporary simple sign-in mode)

## Recommended env

- `GOOGLE_WORKSPACE_DOMAINS` (CSV allowlist)
- `CONTROL_PLANE_BOOTSTRAP_EMAILS` (CSV; first owners)
- `INTERNAL_SERVICE_KEY`
- `PLATFORM_CONFIG_ENCRYPTION_KEY` (32-byte base64 or 64-char hex)
- `CORS_ALLOWED_ORIGINS`
- `CONTROL_PLANE_SIMPLE_AUTH_KEY` (optional temporary admin key mode for `/admin` and `/v1/admin/*`)

## Google Workspace SSO Setup

`/admin` supports Google Sign-In using your `GOOGLE_OAUTH_CLIENT_ID`.

1. In Google Cloud Console:
   - Configure OAuth consent screen as `Internal` (Workspace only).
   - Create OAuth Client ID of type `Web application`.
   - Add your control-plane origin(s) to Authorized JavaScript origins:
     - `https://<control-plane-service>.onrender.com`
     - local dev origin if needed.
2. Set control-plane env:
   - `GOOGLE_OAUTH_CLIENT_ID=<web_client_id>`
   - `GOOGLE_WORKSPACE_DOMAINS=<your-workspace-domain>` (for example `terapixel.games`)
   - `CONTROL_PLANE_BOOTSTRAP_EMAILS=<owner1@domain,owner2@domain>`
3. Open `/admin`, click Google sign-in, then call `/v1/admin/me`.

## Simple Sign-In (Temporary)

If you need fast bring-up before Workspace SSO, set:

- `CONTROL_PLANE_SIMPLE_AUTH_KEY=<long-random-secret>`

Then in `/admin`:

- paste the same value in `Simple Admin Key`
- click `Load /v1/admin/me`

Requests will authenticate via `x-admin-key`. Keep this mode temporary and remove it once Workspace SSO is fully configured.

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

3. Upsert per-title IAP provider credentials:
   - `PUT /v1/admin/titles/:gameId/environments/:environment/iap-providers/:providerKey`
   - body:
     - `clientId`
     - `clientSecret`
     - `baseUrl` (optional; defaults provider-side)
     - `status` (`active` or `disabled`)

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
- `PLATFORM_CONFIG_ENCRYPTION_KEY` is required when writing notify target or IAP provider secrets.
