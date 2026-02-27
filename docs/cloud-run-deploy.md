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
- `CLOUDRUN_SECRET_REFS_COMMON` (JSON object of `ENV_KEY -> secret-name:version`, applied to all services; set as environment secret)
- `CLOUDRUN_SECRET_REFS_BY_SERVICE` (JSON object keyed by service id, each value is `ENV_KEY -> secret-name:version`; set as environment secret)

Example `CLOUDRUN_DEPLOY_FLAGS_JSON_BY_SERVICE`:

```json
{
  "identity-gateway": ["--max-instances=25"],
  "telemetry-ingest": ["--cpu=2", "--memory=1Gi"]
}
```

Example `CLOUDRUN_SECRET_REFS_BY_SERVICE`:

```json
{
  "identity-gateway": {
    "SESSION_SIGNING_KEY_PEM": "terapixel-identity-gateway-session-signing-key-pem:latest",
    "MAGIC_LINK_SIGNING_SECRET": "terapixel-identity-gateway-magic-link-signing-secret:latest"
  },
  "control-plane": {
    "DATABASE_URL": "terapixel-control-plane-database-url:latest"
  }
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
GCP_PROJECT_ID_STAGING=terapixel-platform-staging \
GCP_PROJECT_ID_PRODUCTION=terapixel-platform \
ORG_ID=597597562845 \
GITHUB_REPOSITORY=Terapixel-Games/terapixel-platform \
SCAFFOLD_TARGETS=staging,prod \
bash scripts/cloudrun/bootstrap-platform.sh
```

Script:
- `scripts/cloudrun/bootstrap-platform.sh`
- calls `scripts/cloudrun/scaffold-platform-infra.sh` per target
- creates/updates GitHub environment vars/secrets for workflow consumption

Project selection for bootstrap:
- `GCP_PROJECT_ID` sets one shared project for all targets.
- `GCP_PROJECT_ID_STAGING` and `GCP_PROJECT_ID_PRODUCTION` override per target (recommended).

## Cloud SQL Layout (Staging + Prod)

The scaffold supports:

- `platform` database (for `terapixel-platform` services)
- optional `nakama` database (for Nakama/game backends)

Default behavior:
- only `platform` DB is provisioned
- Nakama DB is skipped unless explicitly enabled
- staging can share one SQL instance across platform + nakama
- production can also share one SQL instance when explicitly enabled

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

If Nakama DB is enabled and you want staging Nakama to reuse the staging platform SQL instance (with a separate Nakama database in that instance), keep:

```bash
STAGING_SHARED_DATABASE=true
```

If Nakama DB is enabled and you also want production Nakama to reuse the production platform SQL instance:

```bash
PRODUCTION_SHARED_DATABASE=true
```

To keep growth options open, keep separate databases per workload inside the shared instance:
- staging instance: `terapixel_platform`, `nakama_lumarush`, `nakama_color_crunch`, ...
- prod instance: `terapixel_platform`, `nakama_lumarush`, `nakama_color_crunch`, ...

## Deploy Flow

1. GitHub OIDC auth to GCP.
2. Build and push each service image using the manifest Dockerfile.
3. Deploy each Cloud Run service using environment + manifest settings.
4. Write deployed URLs/image tags to the workflow summary.

## One-Time Secret Manager Migration

Use this script to move sensitive runtime env vars from plain Cloud Run env values into Secret Manager references:

```bash
PROJECT_IDS=terapixel-platform,terapixel-platform-staging \
bash scripts/cloudrun/migrate-runtime-secrets-to-secret-manager.sh
```

After migration, set `CLOUDRUN_SECRET_REFS_COMMON` / `CLOUDRUN_SECRET_REFS_BY_SERVICE` in GitHub environment secrets so future deploys keep secrets sourced from Secret Manager.
