# terapixel-platform

Shared backend platform repository for reusable services across TeraPixel games.

## Current Production-Ready Services
- `services/identity-gateway`: provider/Nakama identity verification + player session minting and identity linking.
- `services/save-service`: authenticated cloud save sync/merge service.
- `services/feature-flags`: game/profile feature-flag resolution service.
- `services/telemetry-ingest`: authenticated telemetry batch ingest service.
- `services/iap-service`: purchase verification and entitlement source of truth.
- `services/control-plane`: multi-tenant admin API + persistent title/environment/runtime config source of truth.
- `services/player-service`: reusable player profile logic module.

## Quick Start
Requirements:
- Node.js 18+

Run tests:
- `npm test`

Env template:
- copy `.env.example` and set secure values.

Run identity gateway:
- `SESSION_SECRET=replace-with-strong-secret npm run start:identity`

Run save service:
- `SESSION_SECRET=replace-with-strong-secret npm run start:save`

Run feature flags service:
- `npm run start:flags`

Run telemetry ingest service:
- `SESSION_SECRET=replace-with-strong-secret npm run start:telemetry`

Run iap service:
- `SESSION_SECRET=replace-with-strong-secret npm run start:iap`

Run control-plane service:
- `DATABASE_URL=... GOOGLE_OAUTH_CLIENT_ID=... npm run start:control-plane`

Run SQL migrations:
- `DATABASE_URL=... npm run db:migrate`

Onboard a title + notify targets (control-plane DB bootstrap):
- `DATABASE_URL=... PLATFORM_CONFIG_ENCRYPTION_KEY=... npm run control-plane:onboard-title -- --help`

Identity gateway also requires:
- `CRAZYGAMES_EXPECTED_AUDIENCE=<your-game-audience>`

Nakama-first auth flow uses:
- `POST /v1/auth/nakama` to mint platform sessions from `nakama_user_id`.
- `POST /v1/identity/link` to merge two Nakama identities into one global player (requires `IDENTITY_ADMIN_KEY`).

## Repository Layout
- `services/` runtime service modules
- `adapters/` provider-specific adapters
- `packages/` shared contracts and utilities
- `infra/` deployment assets/templates
- `ops/` operations docs
- `templates/` per-game backend templates
- `docs/` architecture and onboarding docs

## API Contracts
JSON Schemas live in `packages/api-contracts/schemas`.

## Notes
- Services expose `/healthz` for liveness.
- HTTP responses include `x-request-id` and `request_id` for traceability.
