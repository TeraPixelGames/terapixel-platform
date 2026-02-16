# Magic Link Contract

This document defines the identity-gateway magic-link API used by Nakama.

## Start

`POST /v1/account/magic-link/start` (Bearer session required)

Request:

```json
{
  "email": "player@example.com",
  "game_id": "lumarush",
  "redirect_hint": "web"
}
```

Response:

```json
{
  "request_id": "uuid",
  "accepted": true,
  "expires_at": 1800000900
}
```

Notes:
- Response should stay generic to avoid account enumeration.
- The service sends the email to `MAGIC_LINK_FROM_EMAIL` via SMTP relay.
- `game_id` is required and is used to route completion callback to the correct game backend.

## Complete

`POST /v1/account/magic-link/complete` (Bearer session required)

Request:

```json
{
  "ml_token": "opaque-token-from-email-link"
}
```

Response:

```json
{
  "request_id": "uuid",
  "status": "upgraded|merged|already_linked",
  "email": "player@example.com",
  "primary_profile_id": "player_xxx",
  "secondary_profile_id": "player_yyy"
}
```

Status semantics:
- `upgraded`: email was not linked, now attached to current profile.
- `already_linked`: email already linked to current profile.
- `merged`: email linked to another profile; current profile merged into primary.

## Consume (Web Click)

`GET /v1/account/magic-link/consume?ml_token=...` (no bearer required)

- Consumes token and completes link server-side.
- Returns a simple HTML success page.
- Triggers server-side callback to Nakama RPC when configured.

## Security Defaults

- Token TTL: `900` seconds.
- One-time token; hash stored at rest.
- Rate limit: `5` starts/hour per profile+email.
- Always validate bearer session before processing.

## Internal Username Moderation

`POST /v1/identity/internal/username/validate` (`x-admin-key` required)

Request:

```json
{
  "game_id": "lumarush",
  "username": "candidate_name"
}
```

Response:

```json
{
  "request_id": "uuid",
  "game_id": "lumarush",
  "username": "candidate_name",
  "normalized_username": "candidate_name",
  "allowed": true,
  "reason": "ok",
  "matched_token": ""
}
```
