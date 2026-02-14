# terapixel-platform

Shared platform repository for reusable backend services across TeraPixel games.

## Scope
- Shared services: identity, player profiles, save sync, feature flags, telemetry ingest.
- Vendor adapters: CrazyGames, Steam, Google Play.
- Shared client/server packages and API contracts.
- Infrastructure templates for Render and per-game Nakama backends.
- Ops artifacts: dashboards, alerts, runbooks.

## Repository Layout
- `services/` shared runtime services
- `adapters/` platform-specific auth adapters
- `packages/` reusable SDK/contracts/utils
- `infra/` deployment and migration infrastructure
- `templates/` scaffolds for per-game backends
- `ops/` operational standards and assets
- `docs/` architecture and onboarding docs

## Next Steps
1. Define service interfaces in `packages/api-contracts`.
2. Implement identity-gateway token verification for CrazyGames.
3. Add Render blueprint templates and environment contracts.
4. Add CI/CD pipelines and release flow.
