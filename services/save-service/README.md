# save-service

Purpose: authenticated cloud-save synchronization for game clients.

## Responsibilities
- Validate and merge client save envelopes with server envelopes.
- Persist merged server state via pluggable storage adapters.
- Expose session-protected HTTP sync endpoint.

## API
- `createSaveService(options)`
- `createSaveHttpServer(options)`
- `POST /v1/save/sync`
- `GET /healthz`

## Storage
- `InMemorySaveStore`: test/dev usage.
- `JsonFileSaveStore`: durable local/file-backed usage.
- `PostgresSaveStore`: shared durable store for multi-instance deployments.

Production note:
- For multi-instance horizontal scale, implement a shared DB-backed store adapter.

## Run
- `npm run start:save`

Required env:
- Session verifier config (one of):
  - `SESSION_SECRET` (legacy HS256)
  - `SESSION_PUBLIC_KEY_PEM` (RS256 static public key)
  - `SESSION_JWKS_URL` (RS256 JWKS endpoint)

Optional env:
- `HOST` (default `0.0.0.0`)
- `PORT` (default `8090`)
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
- `CORS_ALLOWED_ORIGINS` (`*` or comma-separated origin allowlist)
- `SAVE_STORE_TYPE` (`memory`, `file`, or `postgres`, default `memory`)
- `SAVE_STORE_FILE_PATH` (used when `SAVE_STORE_TYPE=file`)
- `SAVE_STORE_TABLE` (used when `SAVE_STORE_TYPE=postgres`, default `save_envelopes`)
- `DATABASE_URL` (required when `SAVE_STORE_TYPE=postgres`)
- `PLATFORM_CONFIG_STORE_TYPE` (`none`|`postgres`|`http`, default `none`)
- `PLATFORM_CONFIG_SERVICE_URL` (required for `http` mode)
- `PLATFORM_CONFIG_INTERNAL_KEY` (required for `http` mode)
- `PLATFORM_CONFIG_ENVIRONMENT` (`staging`|`prod`, default `prod`)
- `PLATFORM_CONFIG_CACHE_TTL_SECONDS` (default `15`)

When `PLATFORM_CONFIG_STORE_TYPE` is not `none`, `game_id` must be an onboarded active title
in control-plane for save read/write requests.
