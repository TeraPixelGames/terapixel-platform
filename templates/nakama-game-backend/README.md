# nakama-game-backend template

Scaffold for per-game Nakama backend repositories.

Includes:
- `Dockerfile`
- `render.yaml`
- `nakama/modules/index.js`

## Auth Pattern
- Client authenticates with Nakama custom auth (guest/email/provider).
- Nakama module calls `terapixel-platform` `POST /v1/auth/nakama`.
- Module returns platform `session_token` + `global_player_id` to client as RPC payload.
