# telemetry-ingest

Purpose: accept gameplay telemetry batches and write them to a pluggable sink.

## Responsibilities
- Validate telemetry request shape and size constraints.
- Optionally require player session authentication.
- Normalize telemetry batches with request metadata.
- Persist telemetry to memory or JSONL file sink.

## API
- `createTelemetryIngestService(options)`
- `createTelemetryIngestHttpServer(options)`
- `POST /v1/telemetry/events`
- `GET /healthz`

## Run
- `npm run start:telemetry`

Optional env:
- `HOST` (default `0.0.0.0`)
- `PORT` (default `8100`)
- `BODY_LIMIT_BYTES` (default `262144`)
- `CORS_ALLOWED_ORIGINS` (`*` or comma-separated allowlist)
- `TELEMETRY_REQUIRE_SESSION` (default `true`)
- Session verifier config (required when `TELEMETRY_REQUIRE_SESSION=true`; one of):
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
- `TELEMETRY_MAX_EVENTS_PER_REQUEST` (default `100`)
- `TELEMETRY_STORE_TYPE` (`memory` or `file`, default `memory`)
- `TELEMETRY_FILE_PATH` (used when `TELEMETRY_STORE_TYPE=file`)
- `DATABASE_URL` (required for `PLATFORM_CONFIG_STORE_TYPE=postgres`)
- `PLATFORM_CONFIG_STORE_TYPE` (`none`|`postgres`|`http`, default `none`)
- `PLATFORM_CONFIG_SERVICE_URL` (required for `http` mode)
- `PLATFORM_CONFIG_INTERNAL_KEY` (required for `http` mode)
- `PLATFORM_CONFIG_ENVIRONMENT` (`staging`|`prod`, default `prod`)
- `PLATFORM_CONFIG_CACHE_TTL_SECONDS` (default `15`)

When `PLATFORM_CONFIG_STORE_TYPE` is not `none`, ingest requests reject unknown/offboarded
`game_id` values.
