#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

MANIFEST_PATH="${MANIFEST_PATH:-${REPO_ROOT}/infra/cloudrun/services.manifest.json}"

GCP_PROJECT_ID="${GCP_PROJECT_ID:-}"
GCP_REGION="${GCP_REGION:-us-central1}"
PLATFORM_ENV="${PLATFORM_ENV:-staging}"
SERVICE_PREFIX="${SERVICE_PREFIX:-terapixel}"
ARTIFACT_REGISTRY_REPO="${ARTIFACT_REGISTRY_REPO:-terapixel-platform}"
ARTIFACT_REGISTRY_FORMAT="${ARTIFACT_REGISTRY_FORMAT:-docker}"
DEFAULT_IMAGE="${DEFAULT_IMAGE:-gcr.io/cloudrun/hello}"
SKIP_EXISTING_SERVICES="${SKIP_EXISTING_SERVICES:-true}"
DRY_RUN="${DRY_RUN:-false}"

ENABLE_APIS="${ENABLE_APIS:-true}"
CREATE_ARTIFACT_REGISTRY="${CREATE_ARTIFACT_REGISTRY:-true}"
CREATE_RUNTIME_SERVICE_ACCOUNT="${CREATE_RUNTIME_SERVICE_ACCOUNT:-true}"
CREATE_DEPLOY_SERVICE_ACCOUNT="${CREATE_DEPLOY_SERVICE_ACCOUNT:-true}"
CREATE_WORKLOAD_IDENTITY_FEDERATION="${CREATE_WORKLOAD_IDENTITY_FEDERATION:-false}"
CREATE_CLOUD_RUN_SERVICES="${CREATE_CLOUD_RUN_SERVICES:-true}"
CREATE_CLOUD_SQL="${CREATE_CLOUD_SQL:-false}"
CREATE_PLATFORM_SQL="${CREATE_PLATFORM_SQL:-true}"
CREATE_NAKAMA_SQL="${CREATE_NAKAMA_SQL:-false}"

RUNTIME_SERVICE_ACCOUNT_ID="${RUNTIME_SERVICE_ACCOUNT_ID:-cloudrun-runtime}"
DEPLOY_SERVICE_ACCOUNT_ID="${DEPLOY_SERVICE_ACCOUNT_ID:-github-cloudrun-deployer}"

WIF_POOL_ID="${WIF_POOL_ID:-github-actions}"
WIF_PROVIDER_ID="${WIF_PROVIDER_ID:-terapixel-platform}"
GITHUB_REPOSITORY="${GITHUB_REPOSITORY:-Terapixel-Games/terapixel-platform}"

SQL_DATABASE_VERSION="${SQL_DATABASE_VERSION:-POSTGRES_15}"
SQL_TIER="${SQL_TIER:-db-custom-1-3840}"
PLATFORM_SQL_INSTANCE_NAME="${PLATFORM_SQL_INSTANCE_NAME:-terapixel-platform-${PLATFORM_ENV}}"
PLATFORM_SQL_DATABASE_NAME="${PLATFORM_SQL_DATABASE_NAME:-terapixel_platform}"
PLATFORM_SQL_DATABASE_USER="${PLATFORM_SQL_DATABASE_USER:-terapixel_platform}"
PLATFORM_SQL_DATABASE_PASSWORD="${PLATFORM_SQL_DATABASE_PASSWORD:-}"
NAKAMA_SQL_INSTANCE_NAME="${NAKAMA_SQL_INSTANCE_NAME:-terapixel-nakama-${PLATFORM_ENV}}"
NAKAMA_SQL_DATABASE_NAME="${NAKAMA_SQL_DATABASE_NAME:-nakama}"
NAKAMA_SQL_DATABASE_USER="${NAKAMA_SQL_DATABASE_USER:-nakama}"
NAKAMA_SQL_DATABASE_PASSWORD="${NAKAMA_SQL_DATABASE_PASSWORD:-}"

function bool_true() {
  local raw
  raw="$(echo "${1:-}" | tr '[:upper:]' '[:lower:]')"
  [[ "${raw}" == "1" || "${raw}" == "true" || "${raw}" == "yes" || "${raw}" == "on" ]]
}

function say() {
  echo "[scaffold] $*"
}

function require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

function require_env() {
  local key="$1"
  if [[ -z "${!key:-}" ]]; then
    echo "Missing required environment variable: ${key}" >&2
    exit 1
  fi
}

function run_cmd() {
  if bool_true "${DRY_RUN}"; then
    echo "[dry-run] $*"
    return 0
  fi
  "$@"
}

function project_binding() {
  local role="$1"
  local member="$2"
  run_cmd gcloud projects add-iam-policy-binding "${GCP_PROJECT_ID}" \
    --member="${member}" \
    --role="${role}" \
    --quiet >/dev/null
}

function service_account_exists() {
  local email="$1"
  gcloud iam service-accounts describe "${email}" --project "${GCP_PROJECT_ID}" >/dev/null 2>&1
}

function ensure_service_account() {
  local id="$1"
  local description="$2"
  local email="${id}@${GCP_PROJECT_ID}.iam.gserviceaccount.com"
  if service_account_exists "${email}"; then
    say "Service account exists: ${email}"
    return 0
  fi
  say "Creating service account: ${email}"
  run_cmd gcloud iam service-accounts create "${id}" \
    --project "${GCP_PROJECT_ID}" \
    --display-name "${id}" \
    --description "${description}" >/dev/null
}

function ensure_apis() {
  local apis=(
    "run.googleapis.com"
    "cloudbuild.googleapis.com"
    "artifactregistry.googleapis.com"
    "iam.googleapis.com"
    "iamcredentials.googleapis.com"
    "sts.googleapis.com"
    "secretmanager.googleapis.com"
  )
  if bool_true "${CREATE_CLOUD_SQL}" && { bool_true "${CREATE_PLATFORM_SQL}" || bool_true "${CREATE_NAKAMA_SQL}"; }; then
    apis+=("sqladmin.googleapis.com")
  fi
  say "Enabling required APIs"
  run_cmd gcloud services enable "${apis[@]}" --project "${GCP_PROJECT_ID}" >/dev/null
}

function ensure_artifact_registry() {
  if gcloud artifacts repositories describe "${ARTIFACT_REGISTRY_REPO}" \
    --project "${GCP_PROJECT_ID}" \
    --location "${GCP_REGION}" >/dev/null 2>&1; then
    say "Artifact Registry repo exists: ${ARTIFACT_REGISTRY_REPO}"
    return 0
  fi
  say "Creating Artifact Registry repo: ${ARTIFACT_REGISTRY_REPO}"
  run_cmd gcloud artifacts repositories create "${ARTIFACT_REGISTRY_REPO}" \
    --project "${GCP_PROJECT_ID}" \
    --location "${GCP_REGION}" \
    --repository-format "${ARTIFACT_REGISTRY_FORMAT}" \
    --description "TeraPixel platform images" >/dev/null
}

function ensure_workload_identity() {
  local deploy_sa_email="${DEPLOY_SERVICE_ACCOUNT_ID}@${GCP_PROJECT_ID}.iam.gserviceaccount.com"
  local project_number
  project_number="$(gcloud projects describe "${GCP_PROJECT_ID}" --format='value(projectNumber)')"

  if ! gcloud iam workload-identity-pools describe "${WIF_POOL_ID}" \
    --project "${GCP_PROJECT_ID}" \
    --location global >/dev/null 2>&1; then
    say "Creating Workload Identity Pool: ${WIF_POOL_ID}"
    run_cmd gcloud iam workload-identity-pools create "${WIF_POOL_ID}" \
      --project "${GCP_PROJECT_ID}" \
      --location global \
      --display-name "GitHub Actions Pool" >/dev/null
  else
    say "Workload Identity Pool exists: ${WIF_POOL_ID}"
  fi

  if ! gcloud iam workload-identity-pools providers describe "${WIF_PROVIDER_ID}" \
    --project "${GCP_PROJECT_ID}" \
    --workload-identity-pool "${WIF_POOL_ID}" \
    --location global >/dev/null 2>&1; then
    say "Creating Workload Identity Provider: ${WIF_PROVIDER_ID}"
    run_cmd gcloud iam workload-identity-pools providers create-oidc "${WIF_PROVIDER_ID}" \
      --project "${GCP_PROJECT_ID}" \
      --workload-identity-pool "${WIF_POOL_ID}" \
      --location global \
      --display-name "GitHub OIDC Provider" \
      --issuer-uri "https://token.actions.githubusercontent.com" \
      --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
      --attribute-condition "assertion.repository == '${GITHUB_REPOSITORY}'" >/dev/null
  else
    say "Workload Identity Provider exists: ${WIF_PROVIDER_ID}"
  fi

  local principal
  principal="principalSet://iam.googleapis.com/projects/${project_number}/locations/global/workloadIdentityPools/${WIF_POOL_ID}/attribute.repository/${GITHUB_REPOSITORY}"
  say "Binding workload identity user role to deploy service account"
  run_cmd gcloud iam service-accounts add-iam-policy-binding "${deploy_sa_email}" \
    --project "${GCP_PROJECT_ID}" \
    --member "${principal}" \
    --role "roles/iam.workloadIdentityUser" >/dev/null

  say "Use this provider in GitHub vars: projects/${project_number}/locations/global/workloadIdentityPools/${WIF_POOL_ID}/providers/${WIF_PROVIDER_ID}"
}

function cloud_run_service_exists() {
  local name="$1"
  gcloud run services describe "${name}" \
    --project "${GCP_PROJECT_ID}" \
    --region "${GCP_REGION}" >/dev/null 2>&1
}

function service_name_for() {
  local id="$1"
  if [[ "${PLATFORM_ENV}" == "prod" || "${PLATFORM_ENV}" == "production" ]]; then
    echo "${SERVICE_PREFIX}-${id}"
    return
  fi
  echo "${SERVICE_PREFIX}-${id}-${PLATFORM_ENV}"
}

function ensure_cloud_run_services() {
  local runtime_sa_email="${RUNTIME_SERVICE_ACCOUNT_ID}@${GCP_PROJECT_ID}.iam.gserviceaccount.com"
  local count
  count="$(jq '.services | length' "${MANIFEST_PATH}")"
  say "Scaffolding ${count} Cloud Run services from manifest"

  mapfile -t services < <(jq -c '.services[]' "${MANIFEST_PATH}")
  for row in "${services[@]}"; do
    local id public cpu memory min_instances max_instances service_name
    id="$(jq -r '.id' <<<"${row}")"
    public="$(jq -r '.public // false' <<<"${row}")"
    cpu="$(jq -r '.cpu // "1"' <<<"${row}")"
    memory="$(jq -r '.memory // "512Mi"' <<<"${row}")"
    min_instances="$(jq -r '.min_instances // 0' <<<"${row}")"
    max_instances="$(jq -r '.max_instances // 10' <<<"${row}")"
    service_name="$(service_name_for "${id}")"

    if bool_true "${SKIP_EXISTING_SERVICES}" && ! bool_true "${DRY_RUN}" && cloud_run_service_exists "${service_name}"; then
      say "Service exists, skipping: ${service_name}"
      continue
    fi

    say "Deploying scaffold service: ${service_name}"
    local auth_flag="--no-allow-unauthenticated"
    if bool_true "${public}"; then
      auth_flag="--allow-unauthenticated"
    fi

    run_cmd gcloud run deploy "${service_name}" \
      --project "${GCP_PROJECT_ID}" \
      --region "${GCP_REGION}" \
      --platform managed \
      --image "${DEFAULT_IMAGE}" \
      --service-account "${runtime_sa_email}" \
      --port "8080" \
      --cpu "${cpu}" \
      --memory "${memory}" \
      --min-instances "${min_instances}" \
      --max-instances "${max_instances}" \
      --set-env-vars "PLATFORM_ENV=${PLATFORM_ENV},SERVICE_ID=${id},NODE_ENV=production" \
      --labels "managed-by=cloudrun-scaffold,platform-env=${PLATFORM_ENV},service-id=${id}" \
      ${auth_flag} \
      --quiet >/dev/null
  done
}

function ensure_cloud_sql_workload() {
  local workload_key="$1"
  local instance_name="$2"
  local database_name="$3"
  local database_user="$4"
  local database_password="$5"

  if ! gcloud sql instances describe "${instance_name}" --project "${GCP_PROJECT_ID}" >/dev/null 2>&1; then
    say "Creating Cloud SQL instance (${workload_key}): ${instance_name}"
    run_cmd gcloud sql instances create "${instance_name}" \
      --project "${GCP_PROJECT_ID}" \
      --region "${GCP_REGION}" \
      --database-version "${SQL_DATABASE_VERSION}" \
      --tier "${SQL_TIER}" \
      --quiet >/dev/null
  else
    say "Cloud SQL instance exists (${workload_key}): ${instance_name}"
  fi

  if ! gcloud sql databases describe "${database_name}" \
    --project "${GCP_PROJECT_ID}" \
    --instance "${instance_name}" >/dev/null 2>&1; then
    say "Creating Cloud SQL database (${workload_key}): ${database_name}"
    run_cmd gcloud sql databases create "${database_name}" \
      --project "${GCP_PROJECT_ID}" \
      --instance "${instance_name}" >/dev/null
  else
    say "Cloud SQL database exists (${workload_key}): ${database_name}"
  fi

  if ! gcloud sql users list \
    --project "${GCP_PROJECT_ID}" \
    --instance "${instance_name}" \
    --format='value(name)' | grep -Fxq "${database_user}"; then
    if [[ -z "${database_password}" ]]; then
      echo "Missing ${workload_key} SQL password. Set ${workload_key}_SQL_DATABASE_PASSWORD." >&2
      exit 1
    fi
    say "Creating Cloud SQL user (${workload_key}): ${database_user}"
    run_cmd gcloud sql users create "${database_user}" \
      --project "${GCP_PROJECT_ID}" \
      --instance "${instance_name}" \
      --password "${database_password}" >/dev/null
  else
    say "Cloud SQL user exists (${workload_key}): ${database_user}"
  fi
}

function ensure_cloud_sql() {
  if bool_true "${CREATE_PLATFORM_SQL}"; then
    ensure_cloud_sql_workload \
      "PLATFORM" \
      "${PLATFORM_SQL_INSTANCE_NAME}" \
      "${PLATFORM_SQL_DATABASE_NAME}" \
      "${PLATFORM_SQL_DATABASE_USER}" \
      "${PLATFORM_SQL_DATABASE_PASSWORD}"
  fi

  if bool_true "${CREATE_NAKAMA_SQL}"; then
    ensure_cloud_sql_workload \
      "NAKAMA" \
      "${NAKAMA_SQL_INSTANCE_NAME}" \
      "${NAKAMA_SQL_DATABASE_NAME}" \
      "${NAKAMA_SQL_DATABASE_USER}" \
      "${NAKAMA_SQL_DATABASE_PASSWORD}"
  fi
}

require_cmd gcloud
require_cmd jq
require_env GCP_PROJECT_ID

if [[ ! -f "${MANIFEST_PATH}" ]]; then
  echo "Manifest file not found: ${MANIFEST_PATH}" >&2
  exit 1
fi

say "Starting Cloud Run scaffold"
say "Project: ${GCP_PROJECT_ID}"
say "Region: ${GCP_REGION}"
say "Environment: ${PLATFORM_ENV}"
say "Dry run: ${DRY_RUN}"

if bool_true "${ENABLE_APIS}"; then
  ensure_apis
fi

if bool_true "${CREATE_RUNTIME_SERVICE_ACCOUNT}"; then
  ensure_service_account "${RUNTIME_SERVICE_ACCOUNT_ID}" "Runtime identity for TeraPixel platform Cloud Run services"
fi

if bool_true "${CREATE_DEPLOY_SERVICE_ACCOUNT}"; then
  ensure_service_account "${DEPLOY_SERVICE_ACCOUNT_ID}" "Deployment identity for GitHub Actions Cloud Run pipelines"
fi

runtime_sa_email="${RUNTIME_SERVICE_ACCOUNT_ID}@${GCP_PROJECT_ID}.iam.gserviceaccount.com"
deploy_sa_email="${DEPLOY_SERVICE_ACCOUNT_ID}@${GCP_PROJECT_ID}.iam.gserviceaccount.com"

if bool_true "${CREATE_DEPLOY_SERVICE_ACCOUNT}"; then
  say "Granting deploy IAM roles"
  project_binding "roles/run.admin" "serviceAccount:${deploy_sa_email}"
  project_binding "roles/artifactregistry.writer" "serviceAccount:${deploy_sa_email}"
  project_binding "roles/cloudbuild.builds.editor" "serviceAccount:${deploy_sa_email}"
  run_cmd gcloud iam service-accounts add-iam-policy-binding "${runtime_sa_email}" \
    --project "${GCP_PROJECT_ID}" \
    --member "serviceAccount:${deploy_sa_email}" \
    --role "roles/iam.serviceAccountUser" >/dev/null
fi

if bool_true "${CREATE_RUNTIME_SERVICE_ACCOUNT}"; then
  say "Granting runtime IAM roles"
  project_binding "roles/secretmanager.secretAccessor" "serviceAccount:${runtime_sa_email}"
  if bool_true "${CREATE_CLOUD_SQL}" && { bool_true "${CREATE_PLATFORM_SQL}" || bool_true "${CREATE_NAKAMA_SQL}"; }; then
    project_binding "roles/cloudsql.client" "serviceAccount:${runtime_sa_email}"
  fi
fi

if bool_true "${CREATE_ARTIFACT_REGISTRY}"; then
  ensure_artifact_registry
fi

if bool_true "${CREATE_WORKLOAD_IDENTITY_FEDERATION}"; then
  ensure_workload_identity
fi

if bool_true "${CREATE_CLOUD_SQL}"; then
  ensure_cloud_sql
fi

if bool_true "${CREATE_CLOUD_RUN_SERVICES}"; then
  ensure_cloud_run_services
fi

say "Scaffold complete"
