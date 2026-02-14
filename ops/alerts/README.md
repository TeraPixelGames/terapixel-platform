# Alerts

Suggested baseline alerts:

## Identity Gateway
- `5xx rate > 1% for 5m`
- `401 invalid_token rate > baseline x3 for 10m`
- `p95 latency > 300ms for 10m`

## Save Service
- `5xx rate > 1% for 5m`
- `401 invalid_session rate > baseline x3 for 10m`
- `p95 latency > 400ms for 10m`

## Feature Flags
- `5xx rate > 1% for 5m`
- `401 invalid_session rate > baseline x3 for 10m`
- `403 forbidden rate > baseline x3 for 10m`

## Telemetry Ingest
- `5xx rate > 1% for 5m`
- `401 invalid_session rate > baseline x3 for 10m`
- `p95 latency > 350ms for 10m`

## Health
- `/healthz` failing for 2 consecutive checks
