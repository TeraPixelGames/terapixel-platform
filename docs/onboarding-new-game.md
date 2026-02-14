# Onboarding A New Game

## 1. Define Game Identifier
- Choose stable `game_id` (example: `lumarush`).
- Configure clients to send this exact value in save sync calls.

## 2. Configure Identity Gateway
- Set env:
  - `SESSION_SECRET`
  - `CRAZYGAMES_EXPECTED_AUDIENCE` (use game-specific audience)
  - Optional issuer/JWKS overrides if required by provider updates.

## 3. Configure Save Service
- Set env:
  - `SESSION_SECRET` (must match identity-gateway)
  - `SESSION_ISSUER`
  - `SESSION_AUDIENCE`
  - `SAVE_STORE_TYPE` (`file` for durable disk-backed single-instance usage)
  - `SAVE_STORE_FILE_PATH` when using `file`

## 4. Client Integration
- Auth flow:
  1. Obtain provider token from platform SDK.
  2. Call `POST /v1/auth/crazygames`.
  3. Store returned `session_token`.
- Save flow:
  1. Send `POST /v1/save/sync` with bearer session token.
  2. Include `game_id` and optional `client_envelope`.
  3. Replace local save with returned `envelope`.
- Feature flags flow:
  1. Call `GET /v1/flags?game_id=<game_id>` for global defaults.
  2. For player-specific flags, pass bearer session and `profile_id` (or let server infer from session subject).
- Telemetry flow:
  1. Send `POST /v1/telemetry/events` with bearer session token.
  2. Include `game_id` and batched `events` array.

## 5. Validation
- Run:
  - `npm test`
- Verify health endpoints:
  - identity: `/healthz`
  - save: `/healthz`
  - feature flags: `/healthz`
  - telemetry: `/healthz`

## 6. Production Checklist
- Set strong `SESSION_SECRET` (32+ chars random).
- Configure TLS at ingress/proxy.
- Enable logs and alerting for 5xx and auth error spikes.
- Backup save storage if using file-backed storage.
- Lock down `FEATURE_FLAGS_ADMIN_KEY` and rotate on a schedule.
- Move telemetry sink from memory to durable pipeline before large traffic.
