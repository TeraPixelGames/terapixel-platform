# Architecture

## Service Boundaries
- `identity-gateway`
  - Verifies provider identity tokens (CrazyGames JWT today) or accepts Nakama identities.
  - Links provider identities or Nakama users to internal player IDs.
  - Supports merging linked identities into one `global_player_id`.
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
- `iap-service`
  - Verifies purchases and applies entitlements.
  - Maintains coin balances and no-ads subscription state.

## Trust Model
- Provider tokens are only validated in `identity-gateway` or Nakama before the call into `identity-gateway`.
- Game clients can call downstream services with a platform session from `identity-gateway`.
- `save-service`/`feature-flags`/`telemetry-ingest` prefer signed `nakama_user_id` claims and fall back to `sub`.
- `iap-service` enforces session auth for player entitlement reads and purchase verification.
- `feature-flags` enforces session only for profile-scoped flag reads.
- `telemetry-ingest` enforces session auth by default (`TELEMETRY_REQUIRE_SESSION=true`).

## Data Model
- Save envelope schema: `packages/api-contracts/schemas/save-envelope.schema.json`
- Keys:
  - `game_id`
  - `profile_id` (Nakama user ID when available)
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
