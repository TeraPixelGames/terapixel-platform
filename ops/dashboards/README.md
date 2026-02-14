# Dashboards

Minimum dashboard panels:

## Traffic
- requests/sec by route
- status code breakdown (2xx/4xx/5xx)

## Latency
- p50/p95/p99 by route

## Auth
- identity-gateway `invalid_token` count
- save-service `invalid_session` count

## Save Sync
- sync source distribution:
  - `created_default`
  - `client_first_write`
  - `merged`
  - `server`

## Feature Flags
- requests/sec for `GET /v1/flags`
- admin writes for `POST /v1/flags/admin`
- profile mismatch (`403 forbidden`) count

## Telemetry
- ingested events/sec (`accepted_events` sum)
- request batch size histogram (`events.length`)
- telemetry ingest `401 invalid_session` count
