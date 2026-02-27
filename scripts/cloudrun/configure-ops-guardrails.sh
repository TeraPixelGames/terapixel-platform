#!/usr/bin/env bash
set -euo pipefail

GCP_PROJECT_ID_PROD="${GCP_PROJECT_ID_PROD:-}"
GCP_PROJECT_ID_STAGING="${GCP_PROJECT_ID_STAGING:-}"
BILLING_ACCOUNT_ID="${BILLING_ACCOUNT_ID:-}"
BUDGET_AMOUNT_USD_PROD="${BUDGET_AMOUNT_USD_PROD:-200}"
BUDGET_AMOUNT_USD_STAGING="${BUDGET_AMOUNT_USD_STAGING:-75}"
ALERT_NOTIFICATION_CHANNELS_JSON="${ALERT_NOTIFICATION_CHANNELS_JSON:-[]}"
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

function policy_exists() {
  local project_id="$1"
  local display_name="$2"
  gcloud monitoring policies list \
    --project "${project_id}" \
    --filter "displayName=\"${display_name}\"" \
    --format 'value(name)' \
    --limit 1 | grep -q .
}

function create_policy_if_missing() {
  local project_id="$1"
  local display_name="$2"
  local policy_file="$3"

  if policy_exists "${project_id}" "${display_name}"; then
    echo "Alert policy exists: ${display_name}"
    return 0
  fi

  echo "Creating alert policy: ${display_name}"
  run_cmd gcloud monitoring policies create \
    --project "${project_id}" \
    --policy-from-file "${policy_file}" >/dev/null
}

function project_number_for() {
  local project_id="$1"
  gcloud projects describe "${project_id}" --format='value(projectNumber)'
}

function budget_exists() {
  local display_name="$1"
  gcloud billing budgets list \
    --billing-account "${BILLING_ACCOUNT_ID}" \
    --format json | jq -e --arg name "${display_name}" '.[] | select(.displayName == $name)' >/dev/null
}

function ensure_budget() {
  local project_id="$1"
  local amount="$2"
  local env_name="$3"
  local project_number
  local display_name

  if [[ -z "${BILLING_ACCOUNT_ID}" ]]; then
    echo "Skipping budgets: BILLING_ACCOUNT_ID not set."
    return 0
  fi

  project_number="$(project_number_for "${project_id}")"
  display_name="Terapixel ${env_name} monthly budget"

  if budget_exists "${display_name}"; then
    echo "Budget exists: ${display_name}"
    return 0
  fi

  echo "Creating budget: ${display_name}"
  run_cmd gcloud billing budgets create \
    --billing-account "${BILLING_ACCOUNT_ID}" \
    --display-name "${display_name}" \
    --budget-amount "${amount}" \
    --filter-projects "projects/${project_number}" \
    --threshold-rule "percent=0.5" \
    --threshold-rule "percent=0.9" \
    --threshold-rule "percent=1.0" >/dev/null
}

function create_alert_policy_files() {
  local project_id="$1"
  local env_name="$2"
  local channels_json="$3"
  local out_dir="$4"

  mkdir -p "${out_dir}"

  cat > "${out_dir}/cloud-run-5xx.json" <<EOF
{
  "displayName": "Terapixel ${env_name} Cloud Run 5xx burst",
  "enabled": true,
  "combiner": "OR",
  "notificationChannels": ${channels_json},
  "conditions": [
    {
      "displayName": "5xx request count above threshold",
      "conditionThreshold": {
        "filter": "resource.type=\\"cloud_run_revision\\" metric.type=\\"run.googleapis.com/request_count\\" metric.labels.response_code_class=\\"5xx\\"",
        "comparison": "COMPARISON_GT",
        "thresholdValue": 5,
        "duration": "120s",
        "aggregations": [
          {
            "alignmentPeriod": "60s",
            "perSeriesAligner": "ALIGN_DELTA"
          }
        ]
      }
    }
  ]
}
EOF

  cat > "${out_dir}/cloud-run-latency.json" <<EOF
{
  "displayName": "Terapixel ${env_name} Cloud Run p95 latency high",
  "enabled": true,
  "combiner": "OR",
  "notificationChannels": ${channels_json},
  "conditions": [
    {
      "displayName": "p95 latency above 2000ms",
      "conditionThreshold": {
        "filter": "resource.type=\\"cloud_run_revision\\" metric.type=\\"run.googleapis.com/request_latencies\\"",
        "comparison": "COMPARISON_GT",
        "thresholdValue": 2000,
        "duration": "300s",
        "aggregations": [
          {
            "alignmentPeriod": "300s",
            "perSeriesAligner": "ALIGN_PERCENTILE_95"
          }
        ]
      }
    }
  ]
}
EOF

  cat > "${out_dir}/cloud-sql-cpu.json" <<EOF
{
  "displayName": "Terapixel ${env_name} Cloud SQL CPU high",
  "enabled": true,
  "combiner": "OR",
  "notificationChannels": ${channels_json},
  "conditions": [
    {
      "displayName": "Cloud SQL CPU above 80%",
      "conditionThreshold": {
        "filter": "resource.type=\\"cloudsql_database\\" metric.type=\\"cloudsql.googleapis.com/database/cpu/utilization\\"",
        "comparison": "COMPARISON_GT",
        "thresholdValue": 0.8,
        "duration": "600s",
        "aggregations": [
          {
            "alignmentPeriod": "300s",
            "perSeriesAligner": "ALIGN_MEAN"
          }
        ]
      }
    }
  ]
}
EOF
}

function ensure_ops_for_project() {
  local project_id="$1"
  local env_name="$2"
  local budget_amount="$3"
  local tmp_dir

  if [[ -z "${project_id}" ]]; then
    return 0
  fi

  tmp_dir="$(mktemp -d)"
  trap 'rm -rf "${tmp_dir}"' EXIT

  create_alert_policy_files "${project_id}" "${env_name}" "${ALERT_NOTIFICATION_CHANNELS_JSON}" "${tmp_dir}"

  create_policy_if_missing "${project_id}" "Terapixel ${env_name} Cloud Run 5xx burst" "${tmp_dir}/cloud-run-5xx.json"
  create_policy_if_missing "${project_id}" "Terapixel ${env_name} Cloud Run p95 latency high" "${tmp_dir}/cloud-run-latency.json"
  create_policy_if_missing "${project_id}" "Terapixel ${env_name} Cloud SQL CPU high" "${tmp_dir}/cloud-sql-cpu.json"
  ensure_budget "${project_id}" "${budget_amount}" "${env_name}"
}

require_cmd gcloud
require_cmd jq

if [[ -z "${GCP_PROJECT_ID_PROD}" && -z "${GCP_PROJECT_ID_STAGING}" ]]; then
  echo "Set GCP_PROJECT_ID_PROD and/or GCP_PROJECT_ID_STAGING." >&2
  exit 1
fi

if ! gcloud auth list --filter=status:ACTIVE --format='value(account)' | grep -q .; then
  echo "No active gcloud account. Run: gcloud auth login" >&2
  exit 1
fi

if ! jq -e 'type == "array"' <<< "${ALERT_NOTIFICATION_CHANNELS_JSON}" >/dev/null 2>&1; then
  echo "ALERT_NOTIFICATION_CHANNELS_JSON must be a JSON array." >&2
  exit 1
fi

ensure_ops_for_project "${GCP_PROJECT_ID_PROD}" "production" "${BUDGET_AMOUNT_USD_PROD}"
ensure_ops_for_project "${GCP_PROJECT_ID_STAGING}" "staging" "${BUDGET_AMOUNT_USD_STAGING}"

echo "Ops guardrails complete."
