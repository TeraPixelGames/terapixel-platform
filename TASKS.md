# Platform Backlog

## Goal
Build a production-ready starter slice for shared services that all game backends can reuse.

## Work Items
- [x] 1. Set up a repository-level Node.js workspace for shared modules and tests.
  - Acceptance: `package.json` exists with a `test` script that runs all tests.
- [x] 2. Implement shared JWT verification utilities in `packages/shared-utils`.
  - Acceptance: verifies RS256 signatures and validates core claims (`iss`, `aud`, `exp`, `nbf`).
- [x] 3. Implement CrazyGames auth adapter in `adapters/crazygames-auth`.
  - Acceptance: returns normalized identity data from a verified token.
- [x] 4. Implement identity-gateway service logic in `services/identity-gateway`.
  - Acceptance: deterministic internal player ID and provider identity linking.
- [x] 5. Implement save envelope + merge policy module in `services/save-service`.
  - Acceptance: conflict-safe merge with deterministic rules for score/streak/date/profile fields.
- [x] 6. Add automated unit tests covering success and failure cases.
  - Acceptance: all tests pass via `npm test`.

## Notes
- Keep implementation dependency-light for easy adoption across repos.
- Prefer pure functions for shared logic to simplify testing and embedding.

## Validation Run
- `npm test` (from `C:\code\terapixel-platform`) passed: 12 tests, 0 failures.

## Phase 2 Backlog
- [x] 7. Implement `player-service` core module.
  - Acceptance: create/upsert/get profile APIs with deterministic defaults and in-memory store.
- [x] 8. Add HTTP API surface for `identity-gateway`.
  - Acceptance: `POST /v1/auth/crazygames` accepts token payload and returns normalized auth response.
- [x] 9. Add API contracts for identity auth request/response.
  - Acceptance: JSON schemas committed under `packages/api-contracts/schemas`.
- [x] 10. Add tests for player-service and identity-gateway HTTP flow.
  - Acceptance: `npm test` passes with new suite coverage.

## Validation Run (Phase 2)
- `npm test` (from `C:\code\terapixel-platform`) passed: 20 tests, 0 failures.

## Phase 3 Backlog
- [x] 11. Add session token utilities (HS256) for internal service auth.
  - Acceptance: identity-gateway can mint sessions and save-service can verify them.
- [x] 12. Implement save-service HTTP API with authenticated sync endpoint.
  - Acceptance: `POST /v1/save/sync` requires bearer session and returns merged envelope.
- [x] 13. Add durable file-backed save store option.
  - Acceptance: save envelopes persist and reload from JSON file store.
- [x] 14. Add JWKS-backed CrazyGames key store with cache.
  - Acceptance: key lookup by `kid` with refresh + cache behavior.
- [x] 15. Add production run entrypoints and Render shared services blueprint.
  - Acceptance: `start:identity`, `start:save`, and `infra/render/shared-services.render.yaml` present.
- [x] 16. Expand test coverage for production flow.
  - Acceptance: end-to-end auth -> save sync path covered and all tests pass.

## Validation Run (Phase 3)
- `npm test` (from `C:\code\terapixel-platform`) passed: 37 tests, 0 failures.

## Phase 4 Backlog
- [x] 17. Add CORS support and preflight handling for HTTP services.
  - Acceptance: configurable allowed origins and `OPTIONS` flow covered by tests.
- [x] 18. Add production documentation and env templates.
  - Acceptance: root README, service READMEs, and `.env.example` updated.
- [x] 19. Add CI workflow to run automated tests on push/PR.
  - Acceptance: `.github/workflows/ci.yml` runs `npm test`.
- [x] 20. Add shared service Render blueprint.
  - Acceptance: `infra/render/shared-services.render.yaml` present and documented.

## Phase 5 Backlog
- [x] 21. Add PostgreSQL save-store adapter for multi-instance production support.
  - Acceptance: save-service supports `SAVE_STORE_TYPE=postgres` with table init/upsert/get.
- [x] 22. Add tests for PostgreSQL adapter behavior.
  - Acceptance: adapter is covered in automated test suite.

## Phase 6 Backlog
- [x] 23. Complete `feature-flags` service runtime wiring and export surface.
  - Acceptance: `npm run start:flags` boots and serves `/healthz` and `/v1/flags`.
- [x] 24. Add automated tests for `feature-flags` service, HTTP, and file store.
  - Acceptance: feature-flags behavior is covered in `npm test` suite.
- [x] 25. Implement `telemetry-ingest` shared service.
  - Acceptance: `POST /v1/telemetry/events` validates and persists event batches.
- [x] 26. Add telemetry service tests for HTTP/service/file-sink behavior.
  - Acceptance: telemetry behavior is covered in automated test suite.
- [x] 27. Extend deployment/docs/contracts for new shared services.
  - Acceptance: scripts, Render blueprint, env template, docs, and schemas updated.

## Validation Run (Phase 6)
- `npm test` (from `C:\code\terapixel-platform`) passed: 57 tests, 0 failures.
