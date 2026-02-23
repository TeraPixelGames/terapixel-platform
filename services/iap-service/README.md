# iap-service

Purpose: purchase verification and entitlement source of truth.

## API
- `GET /healthz`
- `GET /v1/iap/entitlements` (auth required)
- `POST /v1/iap/verify` (auth required)
- `POST /v1/iap/coins/adjust` (auth required)
- `POST /v1/iap/webhook/apple`
- `POST /v1/iap/webhook/google`
- `POST /v1/iap/webhook/paypal`
- `POST /v1/iap/internal/merge-profile` (`x-admin-key` required)

## Env
- Session verifier config (required; one of):
  - `SESSION_SECRET` (legacy HS256)
  - `SESSION_PUBLIC_KEY_PEM` (RS256 static public key)
  - `SESSION_JWKS_URL` (RS256 JWKS endpoint)
- `SESSION_ISSUER` (default `terapixel.identity`)
- `SESSION_AUDIENCE` (default `terapixel.game`)
- `CLOCK_SKEW_SECONDS` (default `10`)
- `SESSION_JWKS_TTL_SECONDS` (default `600`)
- `SESSION_ALLOW_LEGACY_HS256` (default `true`)
- `SESSION_REQUIRE_SUB` (default `false`)
- `SESSION_ALLOW_LEGACY_NAKAMA_SUBJECT` (default `true`)
- `SESSION_LEGACY_CUTOFF_UTC` (optional UTC timestamp; when reached, defaults flip to strict mode)
- `SESSION_LEGACY_CUTOFF_PROD_UTC` (optional prod-specific cutoff override)
- `SESSION_LEGACY_CUTOFF_STAGING_UTC` (optional staging-specific cutoff override)
- `SESSION_POLICY_ENVIRONMENT` (optional explicit policy environment selector)
- `IAP_STORE_TYPE` (`memory`|`file`|`postgres`, default `memory`)
- `IAP_STORE_FILE_PATH` (for `file`)
- `DATABASE_URL` (for `postgres`)
- `IAP_ADMIN_KEY` (required for internal merge endpoint)
- `IAP_APPLE_SHARED_SECRET`
- `IAP_GOOGLE_CLIENT_EMAIL`
- `IAP_GOOGLE_PRIVATE_KEY`
- `IAP_PAYPAL_CLIENT_ID`
- `IAP_PAYPAL_CLIENT_SECRET`
- `PLATFORM_CONFIG_STORE_TYPE` (`none`|`postgres`|`http`, default `none`)
- `DATABASE_URL` (required for `PLATFORM_CONFIG_STORE_TYPE=postgres` and `IAP_STORE_TYPE=postgres`)
- `PLATFORM_CONFIG_SERVICE_URL` (for `http` mode, e.g. control-plane base URL)
- `PLATFORM_CONFIG_INTERNAL_KEY` (for `http` mode, sent as `x-admin-key`)
- `PLATFORM_CONFIG_ENVIRONMENT` (`staging`|`prod`, default `prod`)
- `PLATFORM_CONFIG_CACHE_TTL_SECONDS` (default `15`)
- `PLATFORM_CONFIG_ENCRYPTION_KEY` (required for `postgres` mode when decrypting provider secrets)

`/v1/iap/verify` also accepts optional `game_id`. When provided, the service enforces that
`product_id` belongs to that game and can resolve per-title provider credentials from control-plane.

## Export Target Gating
`/v1/iap/verify` accepts `export_target` and enforces provider allow-list:
- `ios` -> `apple`
- `android` -> `google`
- `poki` -> `paypal_web`
- `crazygames` -> `paypal_web`
- `web` -> `paypal_web`
