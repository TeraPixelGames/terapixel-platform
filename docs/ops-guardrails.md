# Ops Guardrails (Cloud Run Cutover)

This runbook sets baseline guardrails after Render decommission:
- route smoke checks on a schedule and after platform deploys
- Cloud Monitoring alert policies for Cloud Run and Cloud SQL
- monthly budgets for staging and production projects

## Route Smoke Checks

Workflow: `.github/workflows/smoke-check-routes.yml`

Script: `scripts/cloudrun/smoke-check-routes.sh`

Default URLs:
- production: `https://terapixel.games`
- staging: `https://terapixel.games/staging`

Optional repo variables:
- `PROD_BASE_URL`
- `STAGING_BASE_URL`
- `SMOKE_TIMEOUT_SECONDS`

## Monitoring + Budget Setup

Script: `scripts/cloudrun/configure-ops-guardrails.sh`

Required env:
- `GCP_PROJECT_ID_PROD`
- `GCP_PROJECT_ID_STAGING` (optional but recommended)

Optional env:
- `BILLING_ACCOUNT_ID` (required only if creating budgets)
- `BUDGET_AMOUNT_USD_PROD` (default `200`)
- `BUDGET_AMOUNT_USD_STAGING` (default `75`)
- `ALERT_NOTIFICATION_CHANNELS_JSON` (JSON array of Monitoring channel resource names)
- `DRY_RUN=true`

Example:

```bash
GCP_PROJECT_ID_PROD=terapixel-platform \
GCP_PROJECT_ID_STAGING=terapixel-platform-staging \
BILLING_ACCOUNT_ID=000000-000000-000000 \
ALERT_NOTIFICATION_CHANNELS_JSON='["projects/terapixel-platform/notificationChannels/1234567890"]' \
./scripts/cloudrun/configure-ops-guardrails.sh
```

Notes:
- Alert policy creation is idempotent by display name.
- Budget creation is idempotent by display name.
