export class InMemoryPlayerStore {
  constructor() {
    this._players = new Map();
  }

  async get(playerId) {
    if (!playerId) {
      return null;
    }
    const player = this._players.get(String(playerId));
    return player ? { ...player, attributes: { ...player.attributes } } : null;
  }

  async put(player) {
    validatePlayerRecord(player);
    const copy = {
      ...player,
      attributes: { ...player.attributes }
    };
    this._players.set(copy.playerId, copy);
    return { ...copy, attributes: { ...copy.attributes } };
  }

  async list() {
    return Array.from(this._players.values()).map((player) => ({
      ...player,
      attributes: { ...player.attributes }
    }));
  }
}

function validatePlayerRecord(player) {
  if (!player || typeof player !== "object") {
    throw new Error("player record must be an object");
  }
  if (!player.playerId || typeof player.playerId !== "string") {
    throw new Error("player record requires playerId");
  }
  if (!Number.isFinite(Number(player.createdAt))) {
    throw new Error("player record requires createdAt");
  }
  if (!Number.isFinite(Number(player.lastSeenAt))) {
    throw new Error("player record requires lastSeenAt");
  }
  if (!player.attributes || typeof player.attributes !== "object") {
    throw new Error("player record requires attributes object");
  }
}
