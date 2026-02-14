# identity-gateway

Purpose: verify provider identity assertions and mint internal session tokens.

## Responsibilities
- Verify CrazyGames JWTs against JWKS keys.
- Map provider identities to internal player IDs.
- Mint short-lived player session tokens for downstream services.
- Expose auth HTTP endpoint.

## API
- `createIdentityGatewayService(options)`
- `createIdentityGatewayHttpServer(options)`
- `POST /v1/auth/crazygames`
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
