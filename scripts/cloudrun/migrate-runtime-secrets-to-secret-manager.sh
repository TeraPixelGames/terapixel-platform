#!/usr/bin/env bash
set -euo pipefail

PROJECT_IDS="${PROJECT_IDS:-}"
REGION="${REGION:-us-central1}"
SERVICE_NAME_REGEX="${SERVICE_NAME_REGEX:-^terapixel-(control-plane|feature-flags|iap-service|identity-gateway|save-service|telemetry-ingest)$}"
SECRET_KEYS_CSV="${SECRET_KEYS_CSV:-INTERNAL_SERVICE_KEY,CONTROL_PLANE_ONBOARDING_KEY,DATABASE_URL,SESSION_SIGNING_KEY_PEM,MAGIC_LINK_SIGNING_SECRET}"
DRY_RUN="${DRY_RUN:-false}"

function bool_true() {
  local raw
  raw="$(echo "${1:-}" | tr '[:upper:]' '[:lower:]')"
  [[ "${raw}" == "1" || "${raw}" == "true" || "${raw}" == "yes" || "${raw}" == "on" ]]
}

function require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
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

function normalize_secret_id() {
  local raw="$1"
  echo "${raw}" \
    | tr '[:upper:]' '[:lower:]' \
    | tr '_' '-' \
    | tr -cd 'a-z0-9-'
}

require_cmd gcloud
require_cmd jq

if [[ -z "${PROJECT_IDS}" ]]; then
  echo "Set PROJECT_IDS to a comma-separated list (for example: terapixel-platform,terapixel-platform-staging)." >&2
  exit 1
fi

if ! gcloud auth list --filter=status:ACTIVE --format='value(account)' | grep -q .; then
  echo "No active gcloud account. Run: gcloud auth login" >&2
  exit 1
fi

IFS=',' read -r -a projects <<< "${PROJECT_IDS}"
IFS=',' read -r -a secret_keys <<< "${SECRET_KEYS_CSV}"

for project in "${projects[@]}"; do
  project="$(echo "${project}" | xargs)"
  [[ -z "${project}" ]] && continue

  echo "== Project: ${project} =="
  mapfile -t services < <(gcloud run services list --project "${project}" --region "${REGION}" --format='value(metadata.name)')

  for service in "${services[@]}"; do
    if ! [[ "${service}" =~ ${SERVICE_NAME_REGEX} ]]; then
      continue
    fi

    desc_json="$(gcloud run services describe "${service}" --project "${project}" --region "${REGION}" --format=json)"
    runtime_sa="$(jq -r '.spec.template.spec.serviceAccountName // empty' <<< "${desc_json}")"
    updates=()

    for key in "${secret_keys[@]}"; do
      key="$(echo "${key}" | xargs)"
      [[ -z "${key}" ]] && continue

      entry="$(jq -c --arg k "${key}" '.spec.template.spec.containers[0].env[]? | select(.name == $k)' <<< "${desc_json}" | head -n 1)"
      [[ -z "${entry}" ]] && continue

      if jq -e '.valueFrom? != null' >/dev/null <<< "${entry}"; then
        continue
      fi

      value="$(jq -r '.value // empty' <<< "${entry}")"
      [[ -z "${value}" ]] && continue

      secret_id="$(normalize_secret_id "${service}-${key}")"

      if ! gcloud secrets describe "${secret_id}" --project "${project}" >/dev/null 2>&1; then
        echo "Creating secret: ${project}/${secret_id}"
        run_cmd gcloud secrets create "${secret_id}" --project "${project}" --replication-policy=automatic >/dev/null
      fi

      if bool_true "${DRY_RUN}"; then
        echo "[dry-run] add secret version for ${project}/${secret_id}"
      else
        printf '%s' "${value}" | gcloud secrets versions add "${secret_id}" --project "${project}" --data-file=- >/dev/null
      fi

      if [[ -n "${runtime_sa}" ]]; then
        run_cmd gcloud secrets add-iam-policy-binding "${secret_id}" \
          --project "${project}" \
          --member "serviceAccount:${runtime_sa}" \
          --role "roles/secretmanager.secretAccessor" >/dev/null
      fi

      updates+=("${key}=${secret_id}:latest")
    done

    if [[ "${#updates[@]}" -gt 0 ]]; then
      refs_csv="$(IFS=,; echo "${updates[*]}")"
      echo "Updating ${project}/${service} secret refs: ${refs_csv}"
      run_cmd gcloud run services update "${service}" \
        --project "${project}" \
        --region "${REGION}" \
        --update-secrets "${refs_csv}" \
        --quiet >/dev/null
    fi
  done
done

echo "Secret Manager migration complete."
