# Render Infrastructure

This folder contains Render Blueprint definitions for shared platform services.

## Files
- `shared-services.render.yaml`
  - identity-gateway service
  - save-service service
  - feature-flags service
  - telemetry-ingest service
  - iap-service service

## Usage
1. Push repo to GitHub.
2. In Render, create Blueprint from this repo.
3. Set required secrets:
   - `SESSION_SECRET`
   - `IDENTITY_ADMIN_KEY` (if using identity merge endpoint)
   - `CRAZYGAMES_EXPECTED_AUDIENCE` (if using direct CrazyGames auth path)
   - `MAGIC_LINK_SIGNING_SECRET`
   - `MAGIC_LINK_NAKAMA_NOTIFY_URL`
   - `MAGIC_LINK_NAKAMA_NOTIFY_HTTP_KEY`
   - `MAGIC_LINK_NAKAMA_NOTIFY_SECRET`
   - `SMTP_USER` / `SMTP_PASS` (if Google relay uses authenticated mode)
   - `FEATURE_FLAGS_ADMIN_KEY` (if admin route enabled)
4. Deploy.

For durable multi-instance save sync, configure:
- `SAVE_STORE_TYPE=postgres`
- `DATABASE_URL=<postgres connection string>`

For durable feature flags and telemetry storage, configure:
- `FLAG_STORE_TYPE=file`
- `FLAG_STORE_FILE_PATH=<mounted persistent path>`
- `TELEMETRY_STORE_TYPE=file`
- `TELEMETRY_FILE_PATH=<mounted persistent path>`
