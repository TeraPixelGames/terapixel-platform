# Cloud Run Deploy (Full Platform, GitHub OIDC)

This repo supports GitHub-driven Cloud Run deploys for every service in:

- `infra/cloudrun/services.manifest.json`

Workflow:
- `.github/workflows/cloudrun-deploy.yml`
- `main` push -> deploy to `staging` environment
- `v*` tag push -> deploy to `production` environment
- manual dispatch supports `staging` or `prod`

Each manifest service entry controls:
- service id
- Dockerfile path
- public/private ingress mode
- default compute sizing (`cpu`, `memory`, `min_instances`, `max_instances`)

## Required GitHub Environment Variables

Set in both `staging` and `production` GitHub environments:

- `GCP_PROJECT_ID`
- `GCP_REGION` (for example `us-central1`)
- `GCP_WORKLOAD_IDENTITY_PROVIDER` (`projects/<number>/locations/global/workloadIdentityPools/<pool>/providers/<provider>`)
- `GCP_SERVICE_ACCOUNT` (GitHub deployer service account email)
- `CLOUDRUN_ENABLED` (`true` to enable deploy in that environment)
- `CLOUDRUN_SERVICE_PREFIX` (for example `terapixel`)
- `CLOUDRUN_IMAGE_REPO_PREFIX` (for example `us-central1-docker.pkg.dev/<project>/<repo>`)

Optional variables:

- `CLOUDRUN_RUNTIME_SERVICE_ACCOUNT` (runtime SA applied to all services unless overridden in manifest)
- `CLOUDRUN_DEPLOY_FLAGS_JSON_DEFAULT` (JSON array appended to every service deploy)
- `CLOUDRUN_DEPLOY_FLAGS_JSON_BY_SERVICE` (JSON object keyed by service id, each value is a JSON array of flags)

Example `CLOUDRUN_DEPLOY_FLAGS_JSON_BY_SERVICE`:

```json
{
  "identity-gateway": ["--max-instances=25"],
  "telemetry-ingest": ["--cpu=2", "--memory=1Gi"]
}
```

## GitHub Environment Secrets

Optional (set if you need runtime env injection):

- `CLOUDRUN_ENV_VARS_JSON_COMMON` (JSON object merged into every service)
- `CLOUDRUN_ENV_VARS_JSON_BY_SERVICE` (JSON object keyed by service id, each value is an env object)

Example `CLOUDRUN_ENV_VARS_JSON_BY_SERVICE`:

```json
{
  "identity-gateway": {
    "SESSION_SIGNING_ALG": "RS256",
    "SESSION_SIGNING_KEY_ID": "tpx-session-v1",
    "SESSION_SIGNING_KEY_PEM": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
  },
  "save-service": {
    "DATABASE_URL": "postgres://..."
  }
}
```

## Bootstrap (Idempotent)

Use the bootstrap script to set tags, scaffold GCP infra, and configure GitHub environments:

```bash
GCP_PROJECT_ID=terapixel-platform \
ORG_ID=597597562845 \
GITHUB_REPOSITORY=Terapixel-Games/terapixel-platform \
SCAFFOLD_TARGETS=staging,prod \
bash scripts/cloudrun/bootstrap-platform.sh
```

Script:
- `scripts/cloudrun/bootstrap-platform.sh`
- calls `scripts/cloudrun/scaffold-platform-infra.sh` per target
- creates/updates GitHub environment vars/secrets for workflow consumption

## Cloud SQL Layout (Staging + Prod)

The scaffold supports:

- `platform` database (for `terapixel-platform` services)
- optional `nakama` database (for Nakama/game backends)

Default behavior:
- only `platform` DB is provisioned
- Nakama DB is skipped unless explicitly enabled

Enable DB provisioning during bootstrap with target-specific passwords:

```bash
CREATE_CLOUD_SQL=true \
STAGING_PLATFORM_SQL_DATABASE_PASSWORD='change-me' \
PRODUCTION_PLATFORM_SQL_DATABASE_PASSWORD='change-me' \
bash scripts/cloudrun/bootstrap-platform.sh
```

Enable Nakama DB provisioning when needed:

```bash
CREATE_NAKAMA_SQL=true \
STAGING_NAKAMA_SQL_DATABASE_PASSWORD='change-me' \
PRODUCTION_NAKAMA_SQL_DATABASE_PASSWORD='change-me'
```

Default instance names:

- platform: `terapixel-platform-staging`, `terapixel-platform-prod`
- nakama: `terapixel-nakama-staging`, `terapixel-nakama-prod`

If Nakama DB is enabled and you want staging Nakama to reuse the staging platform DB, keep:

```bash
STAGING_SHARED_DATABASE=true
```

## Deploy Flow

1. GitHub OIDC auth to GCP.
2. Build and push each service image using the manifest Dockerfile.
3. Deploy each Cloud Run service using environment + manifest settings.
4. Write deployed URLs/image tags to the workflow summary.
