# feature-flags

Purpose: resolve per-game and per-player feature-flag configuration.

## Responsibilities
- Return effective flags from game defaults + profile overrides.
- Optionally enforce player session for profile-scoped flag reads.
- Provide admin upsert endpoint for defaults/overrides.
- Persist flags using memory or JSON file storage.

## API
- `createFeatureFlagsService(options)`
- `createFeatureFlagsHttpServer(options)`
- `GET /v1/flags?game_id=<id>&profile_id=<optional>`
- `POST /v1/flags/admin` (requires `x-admin-key`)
- `GET /healthz`

## Run
- `npm run start:flags`

Optional env:
- `HOST` (default `0.0.0.0`)
- `PORT` (default `8070`)
- `BODY_LIMIT_BYTES` (default `65536`)
- `CORS_ALLOWED_ORIGINS` (`*` or comma-separated allowlist)
- Session verifier config (required for profile-scoped reads; one of):
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
- `FEATURE_FLAGS_ADMIN_KEY` (enables admin endpoint when set)
- `FLAG_STORE_TYPE` (`memory` or `file`, default `memory`)
- `FLAG_STORE_FILE_PATH` (used when `FLAG_STORE_TYPE=file`)
- `FEATURE_FLAGS_BOOTSTRAP_JSON` (startup bootstrap object)
- `DATABASE_URL` (required for `PLATFORM_CONFIG_STORE_TYPE=postgres`)
- `PLATFORM_CONFIG_STORE_TYPE` (`none`|`postgres`|`http`, default `none`)
- `PLATFORM_CONFIG_SERVICE_URL` (required for `http` mode)
- `PLATFORM_CONFIG_INTERNAL_KEY` (required for `http` mode)
- `PLATFORM_CONFIG_ENVIRONMENT` (`staging`|`prod`, default `prod`)
- `PLATFORM_CONFIG_CACHE_TTL_SECONDS` (default `15`)

When `PLATFORM_CONFIG_STORE_TYPE` is not `none`, `GET /v1/flags` rejects unknown/offboarded
`game_id` and merges active control-plane defaults with local profile overrides.
