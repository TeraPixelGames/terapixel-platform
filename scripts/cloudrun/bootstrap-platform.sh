#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
SCAFFOLD_SCRIPT="${SCRIPT_DIR}/scaffold-platform-infra.sh"

GCP_PROJECT_ID="${GCP_PROJECT_ID:-}"
GCP_REGION="${GCP_REGION:-us-central1}"
ORG_ID="${ORG_ID:-}"
PROJECT_NUMBER="${PROJECT_NUMBER:-}"
GITHUB_REPOSITORY="${GITHUB_REPOSITORY:-Terapixel-Games/terapixel-platform}"

SCAFFOLD_TARGETS="${SCAFFOLD_TARGETS:-staging,prod}"
SERVICE_PREFIX="${SERVICE_PREFIX:-terapixel}"
ARTIFACT_REGISTRY_REPO="${ARTIFACT_REGISTRY_REPO:-terapixel-platform}"
WIF_POOL_ID="${WIF_POOL_ID:-github-actions}"
WIF_PROVIDER_ID="${WIF_PROVIDER_ID:-terapixel-platform}"
DEPLOY_SERVICE_ACCOUNT_ID="${DEPLOY_SERVICE_ACCOUNT_ID:-github-cloudrun-deployer}"
RUNTIME_SERVICE_ACCOUNT_ID="${RUNTIME_SERVICE_ACCOUNT_ID:-cloudrun-runtime}"

ENSURE_PROJECT_ENV_TAG="${ENSURE_PROJECT_ENV_TAG:-true}"
PROJECT_ENV_TAG_VALUE="${PROJECT_ENV_TAG_VALUE:-production}"
CONFIGURE_GITHUB_ENVIRONMENTS="${CONFIGURE_GITHUB_ENVIRONMENTS:-true}"
CREATE_GCP_INFRA="${CREATE_GCP_INFRA:-true}"
SCAFFOLD_ENABLE_APIS="${SCAFFOLD_ENABLE_APIS:-true}"
CREATE_ARTIFACT_REGISTRY="${CREATE_ARTIFACT_REGISTRY:-true}"
CREATE_RUNTIME_SERVICE_ACCOUNT="${CREATE_RUNTIME_SERVICE_ACCOUNT:-true}"
CREATE_DEPLOY_SERVICE_ACCOUNT="${CREATE_DEPLOY_SERVICE_ACCOUNT:-true}"
CREATE_WORKLOAD_IDENTITY_FEDERATION="${CREATE_WORKLOAD_IDENTITY_FEDERATION:-true}"
CREATE_CLOUD_RUN_SERVICES="${CREATE_CLOUD_RUN_SERVICES:-true}"
CREATE_CLOUD_SQL="${CREATE_CLOUD_SQL:-false}"
CREATE_PLATFORM_SQL="${CREATE_PLATFORM_SQL:-true}"
CREATE_NAKAMA_SQL="${CREATE_NAKAMA_SQL:-false}"
STAGING_SHARED_DATABASE="${STAGING_SHARED_DATABASE:-true}"
DRY_RUN="${DRY_RUN:-false}"

SQL_DATABASE_VERSION="${SQL_DATABASE_VERSION:-POSTGRES_15}"
SQL_TIER="${SQL_TIER:-db-custom-1-3840}"
PLATFORM_SQL_DATABASE_NAME="${PLATFORM_SQL_DATABASE_NAME:-terapixel_platform}"
PLATFORM_SQL_DATABASE_USER="${PLATFORM_SQL_DATABASE_USER:-terapixel_platform}"
NAKAMA_SQL_DATABASE_NAME="${NAKAMA_SQL_DATABASE_NAME:-nakama}"
NAKAMA_SQL_DATABASE_USER="${NAKAMA_SQL_DATABASE_USER:-nakama}"
PLATFORM_SQL_INSTANCE_NAME_STAGING="${PLATFORM_SQL_INSTANCE_NAME_STAGING:-terapixel-platform-staging}"
PLATFORM_SQL_INSTANCE_NAME_PRODUCTION="${PLATFORM_SQL_INSTANCE_NAME_PRODUCTION:-terapixel-platform-prod}"
NAKAMA_SQL_INSTANCE_NAME_STAGING="${NAKAMA_SQL_INSTANCE_NAME_STAGING:-terapixel-nakama-staging}"
NAKAMA_SQL_INSTANCE_NAME_PRODUCTION="${NAKAMA_SQL_INSTANCE_NAME_PRODUCTION:-terapixel-nakama-prod}"
STAGING_PLATFORM_SQL_DATABASE_PASSWORD="${STAGING_PLATFORM_SQL_DATABASE_PASSWORD:-}"
PRODUCTION_PLATFORM_SQL_DATABASE_PASSWORD="${PRODUCTION_PLATFORM_SQL_DATABASE_PASSWORD:-}"
STAGING_NAKAMA_SQL_DATABASE_PASSWORD="${STAGING_NAKAMA_SQL_DATABASE_PASSWORD:-}"
PRODUCTION_NAKAMA_SQL_DATABASE_PASSWORD="${PRODUCTION_NAKAMA_SQL_DATABASE_PASSWORD:-}"

CLOUDRUN_ENABLED_STAGING="${CLOUDRUN_ENABLED_STAGING:-true}"
CLOUDRUN_ENABLED_PRODUCTION="${CLOUDRUN_ENABLED_PRODUCTION:-false}"
CLOUDRUN_DEPLOY_FLAGS_JSON_DEFAULT_STAGING="${CLOUDRUN_DEPLOY_FLAGS_JSON_DEFAULT_STAGING:-[]}"
CLOUDRUN_DEPLOY_FLAGS_JSON_DEFAULT_PRODUCTION="${CLOUDRUN_DEPLOY_FLAGS_JSON_DEFAULT_PRODUCTION:-[]}"
CLOUDRUN_DEPLOY_FLAGS_JSON_BY_SERVICE_STAGING="${CLOUDRUN_DEPLOY_FLAGS_JSON_BY_SERVICE_STAGING:-{}}"
CLOUDRUN_DEPLOY_FLAGS_JSON_BY_SERVICE_PRODUCTION="${CLOUDRUN_DEPLOY_FLAGS_JSON_BY_SERVICE_PRODUCTION:-{}}"

CLOUDRUN_ENV_VARS_JSON_COMMON_STAGING="${CLOUDRUN_ENV_VARS_JSON_COMMON_STAGING:-}"
CLOUDRUN_ENV_VARS_JSON_COMMON_PRODUCTION="${CLOUDRUN_ENV_VARS_JSON_COMMON_PRODUCTION:-}"
CLOUDRUN_ENV_VARS_JSON_BY_SERVICE_STAGING="${CLOUDRUN_ENV_VARS_JSON_BY_SERVICE_STAGING:-}"
CLOUDRUN_ENV_VARS_JSON_BY_SERVICE_PRODUCTION="${CLOUDRUN_ENV_VARS_JSON_BY_SERVICE_PRODUCTION:-}"

function bool_true() {
  local raw
  raw="$(echo "${1:-}" | tr '[:upper:]' '[:lower:]')"
  [[ "${raw}" == "1" || "${raw}" == "true" || "${raw}" == "yes" || "${raw}" == "on" ]]
}

function say() {
  echo "[bootstrap] $*"
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

function validate_json_if_present() {
  local value="$1"
  local expected_type="$2"
  local label="$3"
  if [[ -z "${value}" ]]; then
    return 0
  fi
  if ! jq -e "type == \"${expected_type}\"" <<<"${value}" >/dev/null 2>&1; then
    echo "Invalid JSON for ${label}; expected ${expected_type}" >&2
    exit 1
  fi
}

function validate_json_expr_if_present() {
  local value="$1"
  local jq_expr="$2"
  local label="$3"
  if [[ -z "${value}" ]]; then
    return 0
  fi
  if ! jq -e "${jq_expr}" <<<"${value}" >/dev/null 2>&1; then
    echo "Invalid JSON for ${label}" >&2
    exit 1
  fi
}

function set_gh_var() {
  local env_name="$1"
  local key="$2"
  local value="$3"
  run_cmd gh variable set "${key}" --repo "${GITHUB_REPOSITORY}" --env "${env_name}" --body "${value}"
}

function set_gh_secret_if_present() {
  local env_name="$1"
  local key="$2"
  local value="$3"
  if [[ -z "${value}" ]]; then
    say "Skipping ${key} for ${env_name}; no value provided."
    return 0
  fi
  if bool_true "${DRY_RUN}"; then
    echo "[dry-run] gh secret set ${key} --repo ${GITHUB_REPOSITORY} --env ${env_name} <redacted>"
    return 0
  fi
  printf '%s' "${value}" | gh secret set "${key}" --repo "${GITHUB_REPOSITORY}" --env "${env_name}" --body -
}

function normalize_target_name() {
  local value
  value="$(echo "${1:-}" | tr '[:upper:]' '[:lower:]' | xargs)"
  case "${value}" in
    production|prod)
      echo "production"
      ;;
    staging|stage)
      echo "staging"
      ;;
    *)
      echo "${value}"
      ;;
  esac
}

function ensure_project_number() {
  if [[ -n "${PROJECT_NUMBER}" ]]; then
    return 0
  fi
  PROJECT_NUMBER="$(gcloud projects describe "${GCP_PROJECT_ID}" --format='value(projectNumber)')"
}

function ensure_project_environment_tag() {
  if ! bool_true "${ENSURE_PROJECT_ENV_TAG}"; then
    return 0
  fi
  if [[ -z "${ORG_ID}" ]]; then
    echo "ORG_ID is required when ENSURE_PROJECT_ENV_TAG=true" >&2
    exit 1
  fi

  ensure_project_number
  local parent tag_key tag_value
  parent="//cloudresourcemanager.googleapis.com/projects/${PROJECT_NUMBER}"
  tag_key="$(gcloud resource-manager tags keys list \
    --parent "organizations/${ORG_ID}" \
    --filter "shortName=environment" \
    --format 'value(name)' \
    --limit 1)"

  if [[ -z "${tag_key}" ]]; then
    echo "Could not resolve tag key shortName=environment under org ${ORG_ID}" >&2
    exit 1
  fi

  tag_value="$(gcloud resource-manager tags values list \
    --parent "${tag_key}" \
    --filter "shortName=${PROJECT_ENV_TAG_VALUE}" \
    --format 'value(name)' \
    --limit 1)"

  if [[ -z "${tag_value}" ]]; then
    echo "Could not resolve environment tag value shortName=${PROJECT_ENV_TAG_VALUE}" >&2
    exit 1
  fi

  if gcloud resource-manager tags bindings list --parent "${parent}" --format 'value(tagValue)' | grep -Fxq "${tag_value}"; then
    say "Project already has environment tag '${PROJECT_ENV_TAG_VALUE}'."
    return 0
  fi

  say "Applying project environment tag '${PROJECT_ENV_TAG_VALUE}'"
  for existing in $(gcloud resource-manager tags values list --parent "${tag_key}" --format 'value(name)'); do
    run_cmd gcloud resource-manager tags bindings delete \
      --parent "${parent}" \
      --tag-value "${existing}" \
      --quiet >/dev/null 2>&1 || true
  done

  run_cmd gcloud resource-manager tags bindings create \
    --parent "${parent}" \
    --tag-value "${tag_value}" >/dev/null
}

function ensure_gcp_infra_for_targets() {
  if ! bool_true "${CREATE_GCP_INFRA}"; then
    return 0
  fi
  if [[ ! -f "${SCAFFOLD_SCRIPT}" ]]; then
    echo "Missing scaffold script: ${SCAFFOLD_SCRIPT}" >&2
    exit 1
  fi

  local target
  IFS=',' read -ra TARGETS <<< "${SCAFFOLD_TARGETS}"
  for target in "${TARGETS[@]}"; do
    target="$(normalize_target_name "${target}")"
    if [[ -z "${target}" ]]; then
      continue
    fi
    local platform_env
    local platform_sql_instance_name
    local nakama_sql_instance_name
    local platform_sql_database_name
    local platform_sql_database_user
    local nakama_sql_database_name
    local nakama_sql_database_user
    local platform_sql_password
    local nakama_sql_password
    platform_env="${target}"
    platform_sql_database_name="${PLATFORM_SQL_DATABASE_NAME}"
    platform_sql_database_user="${PLATFORM_SQL_DATABASE_USER}"
    nakama_sql_database_name="${NAKAMA_SQL_DATABASE_NAME}"
    nakama_sql_database_user="${NAKAMA_SQL_DATABASE_USER}"
    if [[ "${target}" == "production" ]]; then
      platform_env="prod"
      platform_sql_instance_name="${PLATFORM_SQL_INSTANCE_NAME_PRODUCTION}"
      nakama_sql_instance_name="${NAKAMA_SQL_INSTANCE_NAME_PRODUCTION}"
      platform_sql_password="${PRODUCTION_PLATFORM_SQL_DATABASE_PASSWORD}"
      nakama_sql_password="${PRODUCTION_NAKAMA_SQL_DATABASE_PASSWORD}"
    else
      platform_sql_instance_name="${PLATFORM_SQL_INSTANCE_NAME_STAGING}"
      nakama_sql_instance_name="${NAKAMA_SQL_INSTANCE_NAME_STAGING}"
      platform_sql_password="${STAGING_PLATFORM_SQL_DATABASE_PASSWORD}"
      nakama_sql_password="${STAGING_NAKAMA_SQL_DATABASE_PASSWORD}"
      if bool_true "${STAGING_SHARED_DATABASE}"; then
        nakama_sql_instance_name="${platform_sql_instance_name}"
        nakama_sql_database_name="${platform_sql_database_name}"
        nakama_sql_database_user="${platform_sql_database_user}"
        if [[ -z "${nakama_sql_password}" ]]; then
          nakama_sql_password="${platform_sql_password}"
        fi
      fi
    fi

    say "Scaffolding GCP infra for target: ${target}"
    GCP_PROJECT_ID="${GCP_PROJECT_ID}" \
    GCP_REGION="${GCP_REGION}" \
    PLATFORM_ENV="${platform_env}" \
    ENABLE_APIS="${SCAFFOLD_ENABLE_APIS}" \
    SERVICE_PREFIX="${SERVICE_PREFIX}" \
    ARTIFACT_REGISTRY_REPO="${ARTIFACT_REGISTRY_REPO}" \
    CREATE_ARTIFACT_REGISTRY="${CREATE_ARTIFACT_REGISTRY}" \
    CREATE_RUNTIME_SERVICE_ACCOUNT="${CREATE_RUNTIME_SERVICE_ACCOUNT}" \
    CREATE_DEPLOY_SERVICE_ACCOUNT="${CREATE_DEPLOY_SERVICE_ACCOUNT}" \
    CREATE_CLOUD_RUN_SERVICES="${CREATE_CLOUD_RUN_SERVICES}" \
    RUNTIME_SERVICE_ACCOUNT_ID="${RUNTIME_SERVICE_ACCOUNT_ID}" \
    DEPLOY_SERVICE_ACCOUNT_ID="${DEPLOY_SERVICE_ACCOUNT_ID}" \
    WIF_POOL_ID="${WIF_POOL_ID}" \
    WIF_PROVIDER_ID="${WIF_PROVIDER_ID}" \
    GITHUB_REPOSITORY="${GITHUB_REPOSITORY}" \
    DRY_RUN="${DRY_RUN}" \
    CREATE_CLOUD_SQL="${CREATE_CLOUD_SQL}" \
    CREATE_PLATFORM_SQL="${CREATE_PLATFORM_SQL}" \
    CREATE_NAKAMA_SQL="${CREATE_NAKAMA_SQL}" \
    SQL_DATABASE_VERSION="${SQL_DATABASE_VERSION}" \
    SQL_TIER="${SQL_TIER}" \
    PLATFORM_SQL_INSTANCE_NAME="${platform_sql_instance_name}" \
    PLATFORM_SQL_DATABASE_NAME="${platform_sql_database_name}" \
    PLATFORM_SQL_DATABASE_USER="${platform_sql_database_user}" \
    PLATFORM_SQL_DATABASE_PASSWORD="${platform_sql_password}" \
    NAKAMA_SQL_INSTANCE_NAME="${nakama_sql_instance_name}" \
    NAKAMA_SQL_DATABASE_NAME="${nakama_sql_database_name}" \
    NAKAMA_SQL_DATABASE_USER="${nakama_sql_database_user}" \
    NAKAMA_SQL_DATABASE_PASSWORD="${nakama_sql_password}" \
    CREATE_WORKLOAD_IDENTITY_FEDERATION="${CREATE_WORKLOAD_IDENTITY_FEDERATION}" \
    "${SCAFFOLD_SCRIPT}"
  done
}

function ensure_github_environments() {
  if ! bool_true "${CONFIGURE_GITHUB_ENVIRONMENTS}"; then
    return 0
  fi

  ensure_project_number
  local provider deploy_sa runtime_sa image_repo_prefix
  provider="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${WIF_POOL_ID}/providers/${WIF_PROVIDER_ID}"
  deploy_sa="${DEPLOY_SERVICE_ACCOUNT_ID}@${GCP_PROJECT_ID}.iam.gserviceaccount.com"
  runtime_sa="${RUNTIME_SERVICE_ACCOUNT_ID}@${GCP_PROJECT_ID}.iam.gserviceaccount.com"
  image_repo_prefix="${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/${ARTIFACT_REGISTRY_REPO}"

  local target
  IFS=',' read -ra TARGETS <<< "${SCAFFOLD_TARGETS}"
  for target in "${TARGETS[@]}"; do
    target="$(normalize_target_name "${target}")"
    if [[ -z "${target}" ]]; then
      continue
    fi
    say "Ensuring GitHub environment: ${target}"
    run_cmd gh api --method PUT "repos/${GITHUB_REPOSITORY}/environments/${target}" >/dev/null

    local enabled flags_default_json flags_by_service_json common_env_json by_service_env_json
    if [[ "${target}" == "production" ]]; then
      enabled="${CLOUDRUN_ENABLED_PRODUCTION}"
      flags_default_json="${CLOUDRUN_DEPLOY_FLAGS_JSON_DEFAULT_PRODUCTION}"
      flags_by_service_json="${CLOUDRUN_DEPLOY_FLAGS_JSON_BY_SERVICE_PRODUCTION}"
      common_env_json="${CLOUDRUN_ENV_VARS_JSON_COMMON_PRODUCTION}"
      by_service_env_json="${CLOUDRUN_ENV_VARS_JSON_BY_SERVICE_PRODUCTION}"
    else
      enabled="${CLOUDRUN_ENABLED_STAGING}"
      flags_default_json="${CLOUDRUN_DEPLOY_FLAGS_JSON_DEFAULT_STAGING}"
      flags_by_service_json="${CLOUDRUN_DEPLOY_FLAGS_JSON_BY_SERVICE_STAGING}"
      common_env_json="${CLOUDRUN_ENV_VARS_JSON_COMMON_STAGING}"
      by_service_env_json="${CLOUDRUN_ENV_VARS_JSON_BY_SERVICE_STAGING}"
    fi

    validate_json_if_present "${flags_default_json}" "array" "CLOUDRUN_DEPLOY_FLAGS_JSON_DEFAULT (${target})"
    validate_json_if_present "${flags_by_service_json}" "object" "CLOUDRUN_DEPLOY_FLAGS_JSON_BY_SERVICE (${target})"
    validate_json_if_present "${common_env_json}" "object" "CLOUDRUN_ENV_VARS_JSON_COMMON (${target})"
    validate_json_if_present "${by_service_env_json}" "object" "CLOUDRUN_ENV_VARS_JSON_BY_SERVICE (${target})"
    validate_json_expr_if_present "${flags_by_service_json}" 'all(.[]; type == "array")' "CLOUDRUN_DEPLOY_FLAGS_JSON_BY_SERVICE values (${target})"
    validate_json_expr_if_present "${by_service_env_json}" 'all(.[]; type == "object")' "CLOUDRUN_ENV_VARS_JSON_BY_SERVICE values (${target})"

    set_gh_var "${target}" "GCP_PROJECT_ID" "${GCP_PROJECT_ID}"
    set_gh_var "${target}" "GCP_REGION" "${GCP_REGION}"
    set_gh_var "${target}" "GCP_WORKLOAD_IDENTITY_PROVIDER" "${provider}"
    set_gh_var "${target}" "GCP_SERVICE_ACCOUNT" "${deploy_sa}"
    set_gh_var "${target}" "CLOUDRUN_ENABLED" "${enabled}"
    set_gh_var "${target}" "CLOUDRUN_SERVICE_PREFIX" "${SERVICE_PREFIX}"
    set_gh_var "${target}" "CLOUDRUN_IMAGE_REPO_PREFIX" "${image_repo_prefix}"
    set_gh_var "${target}" "CLOUDRUN_DEPLOY_FLAGS_JSON_DEFAULT" "${flags_default_json}"
    set_gh_var "${target}" "CLOUDRUN_RUNTIME_SERVICE_ACCOUNT" "${runtime_sa}"
    set_gh_var "${target}" "CLOUDRUN_DEPLOY_FLAGS_JSON_BY_SERVICE" "${flags_by_service_json}"
    set_gh_secret_if_present "${target}" "CLOUDRUN_ENV_VARS_JSON_COMMON" "${common_env_json}"
    set_gh_secret_if_present "${target}" "CLOUDRUN_ENV_VARS_JSON_BY_SERVICE" "${by_service_env_json}"
  done
}

require_cmd gcloud
require_cmd gh
require_cmd jq
require_env GCP_PROJECT_ID

if ! gcloud auth list --filter=status:ACTIVE --format='value(account)' | grep -q .; then
  echo "No active gcloud account. Run: gcloud auth login" >&2
  exit 1
fi
if ! gh auth status >/dev/null 2>&1; then
  echo "GitHub CLI is not authenticated. Run: gh auth login" >&2
  exit 1
fi

say "Project: ${GCP_PROJECT_ID}"
say "Region: ${GCP_REGION}"
say "Repository: ${GITHUB_REPOSITORY}"
say "Targets: ${SCAFFOLD_TARGETS}"
say "Dry run: ${DRY_RUN}"

ensure_project_environment_tag
ensure_gcp_infra_for_targets
ensure_github_environments

say "Bootstrap completed."
