export class InMemoryIdentityStore {
  constructor() {
    this._providerLinks = new Map();
    this._players = new Map();
  }

  async findPlayerByProvider(provider, providerUserId) {
    const key = linkKey(provider, providerUserId);
    const playerId = this._providerLinks.get(key);
    if (!playerId) {
      return null;
    }
    return this._players.get(playerId) || null;
  }

  async upsertProviderLink(provider, providerUserId, player) {
    const key = linkKey(provider, providerUserId);
    this._providerLinks.set(key, player.playerId);
    this._players.set(player.playerId, { ...player });
    return { ...player };
  }

  async getPlayer(playerId) {
    return this._players.get(playerId) || null;
  }
}

function linkKey(provider, providerUserId) {
  return `${provider}:${providerUserId}`;
}
