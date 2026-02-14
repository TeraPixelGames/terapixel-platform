# terapixel-platform

Shared backend platform repository for reusable services across TeraPixel games.

## Current Production-Ready Services
- `services/identity-gateway`: provider token verification + player session minting.
- `services/save-service`: authenticated cloud save sync/merge service.
- `services/feature-flags`: game/profile feature-flag resolution service.
- `services/telemetry-ingest`: authenticated telemetry batch ingest service.
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

Identity gateway also requires:
- `CRAZYGAMES_EXPECTED_AUDIENCE=<your-game-audience>`

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
