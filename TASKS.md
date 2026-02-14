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
