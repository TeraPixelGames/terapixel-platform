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
- `SESSION_SECRET` (required for profile-scoped reads)
- `SESSION_ISSUER` (default `terapixel.identity`)
- `SESSION_AUDIENCE` (default `terapixel.game`)
- `CLOCK_SKEW_SECONDS` (default `10`)
- `FEATURE_FLAGS_ADMIN_KEY` (enables admin endpoint when set)
- `FLAG_STORE_TYPE` (`memory` or `file`, default `memory`)
- `FLAG_STORE_FILE_PATH` (used when `FLAG_STORE_TYPE=file`)
- `FEATURE_FLAGS_BOOTSTRAP_JSON` (startup bootstrap object)
