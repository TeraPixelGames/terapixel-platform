# shared-utils

Shared auth and encoding helpers for platform services.

## Exports
- `parseJwt(token)`
- `verifyRs256JwtSignature(token, publicKey)`
- `validateJwtClaims(payload, options)`
- `createSessionToken(payload, secret, options)`
- `verifySessionToken(token, secret, options)`
