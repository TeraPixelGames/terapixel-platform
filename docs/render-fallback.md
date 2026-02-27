# Render Fallback (Decommissioned By Default)

Render is not part of the active production path. Cloud Run is the primary deployment target.

Use this fallback only during a major Cloud Run outage or a controlled DR rehearsal.

## Guardrail

The `Render Deploy` workflow is hard-gated behind:

- repo/environment variable: `RENDER_ENABLED=true`

Default is `false`, so manual workflow runs will no-op safely.

## Required Secrets To Re-Enable

- `RENDER_API_KEY`
- `RENDER_SERVICE_IDS`

Optional:

- `RENDER_ENV_VARS_JSON`
- `RENDER_ENV_VARS_JSON_BY_SERVICE`
- `RENDER_API_BASE_URL` (variable; default `https://api.render.com/v1`)

## Decommission / Recovery Script

Use `scripts/render/manage-services.sh`:

```bash
# suspend services (decommission)
RENDER_API_KEY=... RENDER_SERVICE_IDS="srv-abc,srv-def" \
  ./scripts/render/manage-services.sh suspend

# check status
RENDER_API_KEY=... RENDER_SERVICE_IDS="srv-abc,srv-def" \
  ./scripts/render/manage-services.sh status

# resume services (recovery)
RENDER_API_KEY=... RENDER_SERVICE_IDS="srv-abc,srv-def" \
  ./scripts/render/manage-services.sh resume

# trigger deploys after resume
RENDER_API_KEY=... RENDER_SERVICE_IDS="srv-abc,srv-def" \
  ./scripts/render/manage-services.sh deploy
```
