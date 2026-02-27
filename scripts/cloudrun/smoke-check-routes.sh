#!/usr/bin/env bash
set -euo pipefail

PROD_BASE_URL="${PROD_BASE_URL:-https://terapixel.games}"
STAGING_BASE_URL="${STAGING_BASE_URL:-https://terapixel.games/staging}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-20}"

FAILED=0

function run_check() {
  local label="$1"
  local url="$2"
  local allowed_csv="$3"
  local status

  status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time "${TIMEOUT_SECONDS}" "${url}" || echo "000")"

  local allowed=0
  IFS=',' read -ra codes <<< "${allowed_csv}"
  for code in "${codes[@]}"; do
    if [[ "${status}" == "${code}" ]]; then
      allowed=1
      break
    fi
  done

  if [[ "${allowed}" -eq 1 ]]; then
    echo "[PASS] ${label} (${status}) ${url}"
    return 0
  fi

  echo "[FAIL] ${label} (${status}) ${url} allowed=${allowed_csv}"
  FAILED=$((FAILED + 1))
}

run_check "prod-home" "${PROD_BASE_URL%/}/" "200,301,302"
run_check "prod-api-auth" "${PROD_BASE_URL%/}/api/v1/auth/nakama" "200,400,401,403,404,405"
run_check "prod-admin" "${PROD_BASE_URL%/}/admin/" "200,301,302,401,403"
run_check "prod-lumarush" "${PROD_BASE_URL%/}/lumarush" "200,301,302"
run_check "prod-color-crunch" "${PROD_BASE_URL%/}/color-crunch" "200,301,302"

run_check "staging-home" "${STAGING_BASE_URL%/}/" "200,301,302,401,403"
run_check "staging-api-auth" "${STAGING_BASE_URL%/}/api/v1/auth/nakama" "200,400,401,403,404,405"
run_check "staging-admin" "${STAGING_BASE_URL%/}/admin/" "200,301,302,401,403"

if [[ "${FAILED}" -gt 0 ]]; then
  echo "Smoke checks failed: ${FAILED}"
  exit 1
fi

echo "Smoke checks passed."
