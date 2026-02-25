# Cloud Run Deploy (GitHub OIDC)

This repo supports GitHub-driven Cloud Run deploys for `identity-gateway`.

Workflow:
- `.github/workflows/cloudrun-deploy.yml`
- `main` push -> `staging` environment
- `v*` tag push -> `production` environment
- manual dispatch supports `staging` or `prod`

## Required GitHub Environment Variables

Set these in both `staging` and `production` environments:

- `GCP_PROJECT_ID`
- `GCP_REGION` (for example `us-central1`)
- `GCP_WORKLOAD_IDENTITY_PROVIDER`
- `GCP_SERVICE_ACCOUNT`
- `CLOUDRUN_ENABLED` (`true` to enable deploys, default disabled)
- `CLOUDRUN_SERVICE` (for example `terapixel-identity-gateway-staging` / `terapixel-identity-gateway`)
- `CLOUDRUN_IMAGE_BASE` (for example `us-central1-docker.pkg.dev/my-project/terapixel/identity-gateway`)
- `CLOUDRUN_ALLOW_UNAUTHENTICATED` (`true` or `false`)
- `CLOUDRUN_DEPLOY_FLAGS_JSON` (optional JSON array of extra flags)

Example `CLOUDRUN_DEPLOY_FLAGS_JSON`:

```json
[
  "--min-instances=1",
  "--max-instances=20",
  "--cpu=1",
  "--memory=512Mi"
]
```

## Required GitHub Environment Secrets

Set in both `staging` and `production`:

- `CLOUDRUN_ENV_VARS_JSON` (runtime env map applied at deploy)

Example:

```json
{
  "SESSION_SIGNING_ALG": "RS256",
  "SESSION_SIGNING_KEY_ID": "tpx-session-v1",
  "SESSION_SIGNING_KEY_PEM": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----",
  "CRAZYGAMES_EXPECTED_AUDIENCE": "lumarush",
  "MAGIC_LINK_SIGNING_SECRET": "replace-me"
}
```

## Build Runtime

Container image is built with:

- `services/identity-gateway/Dockerfile`

Deploy pipeline:
1. OIDC auth from GitHub to GCP.
2. `gcloud builds submit` to build/push image.
3. `gcloud run deploy` for configured service.
4. Optional env sync via `CLOUDRUN_ENV_VARS_JSON`.
