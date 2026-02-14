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
- `SESSION_SECRET`

Optional env:
- `HOST` (default `0.0.0.0`)
- `PORT` (default `8090`)
- `SESSION_ISSUER` (default `terapixel.identity`)
- `SESSION_AUDIENCE` (default `terapixel.game`)
- `CLOCK_SKEW_SECONDS` (default `10`)
- `CORS_ALLOWED_ORIGINS` (`*` or comma-separated origin allowlist)
- `SAVE_STORE_TYPE` (`memory`, `file`, or `postgres`, default `memory`)
- `SAVE_STORE_FILE_PATH` (used when `SAVE_STORE_TYPE=file`)
- `SAVE_STORE_TABLE` (used when `SAVE_STORE_TYPE=postgres`, default `save_envelopes`)
- `DATABASE_URL` (required when `SAVE_STORE_TYPE=postgres`)
