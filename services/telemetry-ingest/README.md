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
- `SESSION_SECRET` (required when `TELEMETRY_REQUIRE_SESSION=true`)
- `SESSION_ISSUER` (default `terapixel.identity`)
- `SESSION_AUDIENCE` (default `terapixel.game`)
- `CLOCK_SKEW_SECONDS` (default `10`)
- `TELEMETRY_MAX_EVENTS_PER_REQUEST` (default `100`)
- `TELEMETRY_STORE_TYPE` (`memory` or `file`, default `memory`)
- `TELEMETRY_FILE_PATH` (used when `TELEMETRY_STORE_TYPE=file`)
