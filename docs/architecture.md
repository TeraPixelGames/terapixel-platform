# Architecture

## Service Boundaries
- `identity-gateway`
  - Verifies provider identity tokens (CrazyGames JWT today).
  - Links provider identities to internal player IDs.
  - Mints short-lived player session tokens.
- `save-service`
  - Verifies player session token.
  - Syncs/merges client save envelope with server envelope.
  - Persists envelopes in pluggable storage adapter.
- `feature-flags`
  - Resolves effective flags from game defaults and profile overrides.
  - Supports admin upsert endpoint for runtime flag updates.
- `telemetry-ingest`
  - Validates telemetry event batches.
  - Stores events via pluggable sink adapter.

## Trust Model
- Provider tokens are only validated in `identity-gateway`.
- Game clients use `session_token` from identity response to call downstream services.
- `save-service` trusts only signed session claims (`sub` = internal `player_id`).
- `feature-flags` enforces session only for profile-scoped flag reads.
- `telemetry-ingest` enforces session auth by default (`TELEMETRY_REQUIRE_SESSION=true`).

## Data Model
- Save envelope schema: `packages/api-contracts/schemas/save-envelope.schema.json`
- Keys:
  - `game_id`
  - `profile_id` (internal player ID)
  - `revision`
  - `updated_at`
  - `payload`

## Observability
- Each HTTP response includes:
  - `x-request-id` header
  - `request_id` JSON field
- Health endpoint:
  - `GET /healthz`

## Scale Pattern
- Deploy one `identity-gateway`, `save-service`, `feature-flags`, and `telemetry-ingest` per environment.
- Isolate per game at the storage layer (`game_id`) or per deployment where needed.
