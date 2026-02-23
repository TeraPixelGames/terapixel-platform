# Onboarding A New Game

## 1. Define Game Identifier
- Choose stable `game_id` (example: `lumarush`).
- Configure clients to send this exact value in save sync calls.

## 2. Register Title In Control-Plane
- Preferred scripted path:
  - `POST /v1/internal/onboarding/title-registration`
  - auth: `x-admin-key: <CONTROL_PLANE_ONBOARDING_KEY>`
- Minimal payload:
  - `tenant_slug`, `tenant_name`, `game_id`, `title_name`
- Default behavior seeds launch-gate flags per environment as:
  - `{ "title_enabled": false }`
  - keep disabled until release readiness.

## 3. Configure Identity Gateway
- Set env:
  - Session signing:
    - HS mode: `SESSION_SECRET`
    - RS mode: `SESSION_SIGNING_ALG=RS256`, `SESSION_SIGNING_KEY_ID`, `SESSION_SIGNING_KEY_PEM`
  - Legacy cutoff policy:
    - `SESSION_LEGACY_CUTOFF_UTC` (or per-env `SESSION_LEGACY_CUTOFF_PROD_UTC` / `SESSION_LEGACY_CUTOFF_STAGING_UTC`)
    - Optional explicit `SESSION_POLICY_ENVIRONMENT`
  - `IDENTITY_ADMIN_KEY` (required for account-link merge endpoint)
  - `CRAZYGAMES_EXPECTED_AUDIENCE` (only if using direct CrazyGames auth path)
  - `SESSION_ISSUER`, `SESSION_AUDIENCE`
  - Optional: `SESSION_JWKS_PATH` (default `/.well-known/jwks.json`)

## 4. Configure Save Service
- Set env:
  - Session verifier (one of):
    - `SESSION_SECRET` (HS mode)
    - `SESSION_JWKS_URL` (RS mode; point to identity-gateway `/.well-known/jwks.json`)
    - `SESSION_PUBLIC_KEY_PEM` (RS static key mode)
  - `SESSION_ISSUER`
  - `SESSION_AUDIENCE`
  - `SAVE_STORE_TYPE` (`file` for durable disk-backed single-instance usage)
  - `SAVE_STORE_FILE_PATH` when using `file`

## 5. Client Integration
- Auth flow:
  1. Client authenticates with Nakama (guest/email/provider).
  2. Backend calls `POST /v1/auth/nakama` with `game_id` + `nakama_user_id`.
  3. Backend returns `session_token` to the client for platform services.
  4. Optional merge flow: call `POST /v1/identity/link` with admin key after proving control of both accounts.
- Save flow:
  1. Send `POST /v1/save/sync` with bearer session token.
  2. Include `game_id` and optional `client_envelope`.
  3. Replace local save with returned `envelope`.
- Feature flags flow:
  1. Call `GET /v1/flags?game_id=<game_id>` for global defaults.
  2. For player-specific flags, pass bearer session and `profile_id` (or let server infer from session `sub` claim).
- Telemetry flow:
  1. Send `POST /v1/telemetry/events` with bearer session token.
  2. Include `game_id` and batched `events` array.

## 6. Validation
- Run:
  - `npm test`
- Verify health endpoints:
  - identity: `/healthz`
  - save: `/healthz`
  - feature flags: `/healthz`
  - telemetry: `/healthz`

## 7. Production Checklist
- Use RS256 + JWKS for production (`SESSION_SIGNING_ALG=RS256`) and keep `SESSION_SECRET` only for temporary compatibility.
- Set a dated legacy cutoff before launch (example: `SESSION_LEGACY_CUTOFF_UTC=2026-05-31T00:00:00Z`).
- Configure TLS at ingress/proxy.
- Enable logs and alerting for 5xx and auth error spikes.
- Backup save storage if using file-backed storage.
- Lock down `FEATURE_FLAGS_ADMIN_KEY` and rotate on a schedule.
- Move telemetry sink from memory to durable pipeline before large traffic.
