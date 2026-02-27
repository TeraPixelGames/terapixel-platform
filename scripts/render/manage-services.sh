#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  manage-services.sh <action> [service_id ...]

Actions:
  status   Show basic service metadata from Render API
  suspend  Suspend service(s) to stop runtime
  resume   Resume suspended service(s)
  deploy   Trigger a manual deploy for service(s)

Inputs:
  - Service IDs can be passed as positional args, or via RENDER_SERVICE_IDS
  - RENDER_SERVICE_IDS supports comma/semicolon/space/newline separators

Required env:
  RENDER_API_KEY

Optional env:
  RENDER_API_BASE_URL (default: https://api.render.com/v1)
  DRY_RUN=true        (print actions without sending API mutations)

Examples:
  RENDER_API_KEY=... ./scripts/render/manage-services.sh suspend srv-abc123 srv-def456
  RENDER_API_KEY=... RENDER_SERVICE_IDS="srv-abc123,srv-def456" ./scripts/render/manage-services.sh resume
EOF
}

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    exit 1
  fi
}

require_env() {
  local key="$1"
  if [[ -z "${!key:-}" ]]; then
    echo "Missing required env var: $key" >&2
    exit 1
  fi
}

to_bool() {
  local value="${1:-}"
  value="$(echo "$value" | tr '[:upper:]' '[:lower:]')"
  [[ "$value" == "1" || "$value" == "true" || "$value" == "yes" ]]
}

parse_service_ids() {
  local -a ids=()

  if [[ "$#" -gt 0 ]]; then
    ids=("$@")
  else
    if [[ -z "${RENDER_SERVICE_IDS:-}" ]]; then
      echo "No service IDs provided. Pass args or set RENDER_SERVICE_IDS." >&2
      exit 1
    fi
    mapfile -t ids < <(printf '%s' "${RENDER_SERVICE_IDS}" | tr ',; ' '\n' | sed '/^$/d')
  fi

  if [[ "${#ids[@]}" -eq 0 ]]; then
    echo "Resolved zero service IDs." >&2
    exit 1
  fi

  printf '%s\n' "${ids[@]}"
}

api_get() {
  local path="$1"
  curl -fsS \
    -H "Authorization: Bearer ${RENDER_API_KEY}" \
    -H "Accept: application/json" \
    "${RENDER_API_BASE_URL}${path}"
}

api_post() {
  local path="$1"
  local body="${2:-}"

  if to_bool "${DRY_RUN:-false}"; then
    echo "[dry-run] POST ${path}"
    if [[ -n "$body" ]]; then
      echo "$body" | jq .
    fi
    return 0
  fi

  if [[ -n "$body" ]]; then
    curl -fsS \
      -X POST \
      -H "Authorization: Bearer ${RENDER_API_KEY}" \
      -H "Accept: application/json" \
      -H "Content-Type: application/json" \
      "${RENDER_API_BASE_URL}${path}" \
      -d "$body" >/dev/null
    return 0
  fi

  curl -fsS \
    -X POST \
    -H "Authorization: Bearer ${RENDER_API_KEY}" \
    -H "Accept: application/json" \
    "${RENDER_API_BASE_URL}${path}" >/dev/null
}

main() {
  require_cmd curl
  require_cmd jq

  local action="${1:-}"
  shift || true

  case "$action" in
    status|suspend|resume|deploy) ;;
    ""|-h|--help|help)
      usage
      exit 0
      ;;
    *)
      echo "Unsupported action: $action" >&2
      usage
      exit 1
      ;;
  esac

  require_env RENDER_API_KEY
  RENDER_API_BASE_URL="${RENDER_API_BASE_URL:-https://api.render.com/v1}"

  mapfile -t service_ids < <(parse_service_ids "$@")

  for service_id in "${service_ids[@]}"; do
    echo "Service: ${service_id}"

    if [[ "$action" == "status" ]]; then
      api_get "/services/${service_id}" \
        | jq '{id, name, type, serviceDetails: .serviceDetails, suspended: .suspended, autoDeploy: .autoDeploy}'
      continue
    fi

    if [[ "$action" == "suspend" ]]; then
      api_post "/services/${service_id}/suspend"
      echo "Suspended ${service_id}"
      continue
    fi

    if [[ "$action" == "resume" ]]; then
      api_post "/services/${service_id}/resume"
      echo "Resumed ${service_id}"
      continue
    fi

    if [[ "$action" == "deploy" ]]; then
      api_post "/services/${service_id}/deploys" '{"deployMode":"build_and_deploy"}'
      echo "Triggered deploy for ${service_id}"
    fi
  done
}

main "$@"
