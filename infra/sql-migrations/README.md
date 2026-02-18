# SQL Migrations

Shared schema migrations for platform services.

## Usage

1. Set `DATABASE_URL`.
2. Run:

```bash
npm run db:migrate
```

## Notes

- Migrations are applied in lexical order from this folder.
- Applied rows are tracked in `schema_migrations`.
- Each migration stores a SHA-256 checksum; edited files fail fast on checksum mismatch.
- `0001_control_plane.sql` creates the control-plane schema used by:
  - title onboarding/offboarding
  - per-environment notify targets
  - feature flag versions
  - IAP catalog versions + schedules
  - admin users + audit log
  - service event telemetry
- `0002_iap_provider_configs.sql` adds encrypted per-title/provider credential storage
  for runtime IAP provider routing (for example `paypal_web`).
