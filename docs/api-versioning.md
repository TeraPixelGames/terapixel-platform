# API Versioning

## Versioning Strategy
- Use path versioning for HTTP APIs:
  - `/v1/auth/crazygames`
  - `/v1/save/sync`
  - `/v1/flags`
  - `/v1/telemetry/events`
- Use schema versioning inside save envelope:
  - `schema_version` field in `save-envelope`.

## Compatibility Rules
- Backward-compatible additions:
  - add optional fields only.
- Breaking changes:
  - require new path version (`/v2/...`).
- Save schema migrations:
  - bump `schema_version`.
  - migrate server-side before merge/write.

## Contract Source of Truth
- JSON schemas under `packages/api-contracts/schemas`.
- Any API change must include:
  1. schema update
  2. tests update
  3. docs update
