# Render Infrastructure

This folder contains Render Blueprint definitions for shared platform services.

## Files
- `shared-services.render.yaml`
  - managed Postgres database (`terapixel-platform-db`)
  - identity-gateway service
  - control-plane service
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
   - `GOOGLE_OAUTH_CLIENT_ID`
   - `GOOGLE_WORKSPACE_DOMAINS`
   - `CONTROL_PLANE_BOOTSTRAP_EMAILS`
   - `CONTROL_PLANE_SIMPLE_AUTH_KEY` (optional temporary shortcut before SSO)
   - `CRAZYGAMES_EXPECTED_AUDIENCE` (if using direct CrazyGames auth path)
   - `MAGIC_LINK_SIGNING_SECRET`
   - `PLATFORM_CONFIG_ENCRYPTION_KEY`
   - `SMTP_USER` / `SMTP_PASS` (if Google relay uses authenticated mode)
4. Deploy.
5. Run DB migrations once:
   - `DATABASE_URL=<render db url> npm run db:migrate`

Identity-gateway can pull notify routing from control-plane by setting:
- `PLATFORM_CONFIG_STORE_TYPE=postgres` (or `http`)
- `PLATFORM_CONFIG_DATABASE_URL=<postgres connection string>` (postgres mode)
- `PLATFORM_CONFIG_SERVICE_URL=<control-plane base url>` (http mode)
- `PLATFORM_CONFIG_INTERNAL_KEY=<internal key>` (http mode)
