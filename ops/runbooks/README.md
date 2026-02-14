# Runbooks

## Identity Gateway 5xx Spike
1. Check `/healthz`.
2. Check deployment logs for JWKS fetch errors or env config issues.
3. Verify `CRAZYGAMES_EXPECTED_AUDIENCE` is set correctly for the game.
4. If JWKS endpoint outage, keep service up and retry automatically; do not disable JWT verification.

## Save Service 401 Spike
1. Verify `SESSION_SECRET`, `SESSION_ISSUER`, and `SESSION_AUDIENCE` match identity-gateway.
2. Validate client sends `Authorization: Bearer <session_token>`.
3. Check token expiry and device clock drift.

## Save Service Data Loss Risk
1. If running `SAVE_STORE_TYPE=memory`, migrate to durable storage before production traffic.
2. If running `SAVE_STORE_TYPE=file`, verify disk mount and backup strategy.
3. Confirm save sync requests still return envelopes with expected `revision`.

## Feature Flags Admin Access Incident
1. Rotate `FEATURE_FLAGS_ADMIN_KEY` immediately.
2. Audit `POST /v1/flags/admin` request logs by `request_id` and source IP.
3. Restore expected game/profile flags from a known-good snapshot.

## Telemetry Ingest Backpressure
1. Check ingest 5xx/p95 latency and request body sizes.
2. Reduce `TELEMETRY_MAX_EVENTS_PER_REQUEST` if large payloads are saturating CPU.
3. Move from memory sink to durable pipeline storage before retrying scale-up.
