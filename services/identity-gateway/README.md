# identity-gateway

Purpose: verify provider identity assertions or Nakama identity assertions and mint internal session tokens.

## Responsibilities
- Verify CrazyGames JWTs against JWKS keys.
- Map provider identities to internal player IDs.
- Accept Nakama user identities and mint sessions without vendor exposure.
- Generate and redeem account merge pairing codes.
- Merge secondary profiles into primary profile.
- Mint short-lived player session tokens for downstream services.
- Expose auth HTTP endpoint.

## API
- `createIdentityGatewayService(options)`
- `createIdentityGatewayHttpServer(options)`
- `POST /v1/auth/crazygames`
- `POST /v1/auth/nakama`
- `POST /v1/account/magic-link/start` (auth required)
- `POST /v1/account/magic-link/complete` (auth required)
- `GET /v1/account/magic-link/consume?ml_token=...` (email-click endpoint)
- `POST /v1/account/merge/code` (auth required)
- `POST /v1/account/merge/redeem` (auth required)
- `GET /healthz`

## Run
- `npm run start:identity`

Required env:
- `SESSION_SECRET`
- `CRAZYGAMES_EXPECTED_AUDIENCE`

Optional env:
- `HOST` (default `0.0.0.0`)
- `PORT` (default `8080`)
- `BODY_LIMIT_BYTES` (default `65536`)
- `CRAZYGAMES_JWKS_URL` (default CrazyGames JWKS endpoint)
- `CRAZYGAMES_EXPECTED_ISSUER` (default CrazyGames issuer URL)
- `JWKS_TTL_SECONDS` (default `600`)
- `CLOCK_SKEW_SECONDS` (default `10`)
- `CORS_ALLOWED_ORIGINS` (`*` or comma-separated origin allowlist)
- `SESSION_ISSUER` (default `terapixel.identity`)
- `SESSION_AUDIENCE` (default `terapixel.game`)
- `SESSION_TTL_SECONDS` (default `3600`)
- `IDENTITY_STORE_TYPE` (`memory` or `postgres`, default `memory`)
- `DATABASE_URL` (required for `IDENTITY_STORE_TYPE=postgres`)
- `INTERNAL_SERVICE_KEY` (shared admin key for downstream merge routes)
- `IAP_INTERNAL_MERGE_URL`
- `SAVE_INTERNAL_MERGE_URL`
- `FLAGS_INTERNAL_MERGE_URL`
- `TELEMETRY_INTERNAL_MERGE_URL`
- `MAGIC_LINK_FROM_EMAIL`
- `MAGIC_LINK_REPLY_TO_EMAIL`
- `MAGIC_LINK_SUBJECT` (default `Terapixel Games Magic Link`)
- `MAGIC_LINK_BASE_URL` (e.g. `https://identity.terapixel.games/v1/account/magic-link/consume`)
- `MAGIC_LINK_MOBILE_BASE_URL` (optional app deep-link root)
- `MAGIC_LINK_SIGNING_SECRET`
- `MAGIC_LINK_TTL_SECONDS` (default `900`)
- `MAGIC_LINK_RATE_LIMIT_PER_HOUR` (default `5`)
- `MAGIC_LINK_NAKAMA_NOTIFY_URL` (Nakama RPC URL for magic-link completion event)
- `MAGIC_LINK_NAKAMA_NOTIFY_HTTP_KEY` (Nakama runtime HTTP key)
- `MAGIC_LINK_NAKAMA_NOTIFY_SECRET` (shared secret checked by Nakama module)
- `SMTP_HOST` (Google relay: `smtp-relay.gmail.com`)
- `SMTP_PORT` (Google relay: `587`)
- `SMTP_USER` (optional when relay allowlists source IP)
- `SMTP_PASS` (optional when relay allowlists source IP)
- `SMTP_SECURE` (default `false`)
- `SMTP_REQUIRE_TLS` (default `true`)
