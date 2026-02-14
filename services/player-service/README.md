# player-service

Purpose: manage player profile records in a shared service boundary.

## Responsibilities
- Create and update player profiles.
- Normalize profile defaults (timestamps, attributes, display name).
- Provide read/list profile access for other services.

## API
- `createPlayerService(options)`
- `playerService.getPlayer(playerId)`
- `playerService.upsertPlayer({ playerId, displayName, attributes, nowSeconds })`
- `playerService.listPlayers()`
- `InMemoryPlayerStore` for local/dev tests

## Run
- Module-only service logic; embed in HTTP layer or worker process.
