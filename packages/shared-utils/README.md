# shared-utils

Shared auth and encoding helpers for platform services.

## Exports
- `parseJwt(token)`
- `verifyRs256JwtSignature(token, publicKey)`
- `validateJwtClaims(payload, options)`
- `createSessionToken(payload, signerOrSecret, options)`
- `verifySessionToken(token, verifierOrSecret, options)`
- `createSessionTokenVerifier(options)` (async RS256 JWKS + HS256 compatibility verifier)
- `resolveSessionLegacyPolicy(env, options)` (date-based legacy compatibility defaults by environment)
