import fs from "node:fs/promises";
import path from "node:path";

export class InMemoryFlagStore {
  constructor(seed = {}) {
    this._state = normalizeState(seed);
  }

  async getGameConfig(gameId) {
    const gameKey = normalizeKey(gameId);
    const gameConfig = this._state.games[gameKey];
    if (!gameConfig) {
      return {
        defaults: {},
        profiles: {}
      };
    }
    return deepClone(gameConfig);
  }

  async upsertGameDefaults(gameId, defaults) {
    const gameKey = normalizeKey(gameId);
    if (!this._state.games[gameKey]) {
      this._state.games[gameKey] = {
        defaults: {},
        profiles: {}
      };
    }
    this._state.games[gameKey].defaults = {
      ...this._state.games[gameKey].defaults,
      ...normalizeObject(defaults)
    };
  }

  async upsertProfileOverrides(gameId, profileId, overrides) {
    const gameKey = normalizeKey(gameId);
    const profileKey = normalizeKey(profileId);
    if (!this._state.games[gameKey]) {
      this._state.games[gameKey] = {
        defaults: {},
        profiles: {}
      };
    }
    const profiles = this._state.games[gameKey].profiles;
    profiles[profileKey] = {
      ...(profiles[profileKey] || {}),
      ...normalizeObject(overrides)
    };
  }
}

export class JsonFileFlagStore {
  constructor(options = {}) {
    const filePath = String(options.filePath || "").trim();
    if (!filePath) {
      throw new Error("JsonFileFlagStore filePath is required");
    }
    this._filePath = filePath;
    this._state = { games: {} };
    this._loaded = false;
    this._writeQueue = Promise.resolve();
  }

  async getGameConfig(gameId) {
    await this._ensureLoaded();
    const gameKey = normalizeKey(gameId);
    const gameConfig = this._state.games[gameKey];
    if (!gameConfig) {
      return {
        defaults: {},
        profiles: {}
      };
    }
    return deepClone(gameConfig);
  }

  async upsertGameDefaults(gameId, defaults) {
    await this._ensureLoaded();
    const gameKey = normalizeKey(gameId);
    if (!this._state.games[gameKey]) {
      this._state.games[gameKey] = {
        defaults: {},
        profiles: {}
      };
    }
    this._state.games[gameKey].defaults = {
      ...this._state.games[gameKey].defaults,
      ...normalizeObject(defaults)
    };
    await this._enqueueWrite();
  }

  async upsertProfileOverrides(gameId, profileId, overrides) {
    await this._ensureLoaded();
    const gameKey = normalizeKey(gameId);
    const profileKey = normalizeKey(profileId);
    if (!this._state.games[gameKey]) {
      this._state.games[gameKey] = {
        defaults: {},
        profiles: {}
      };
    }
    const profiles = this._state.games[gameKey].profiles;
    profiles[profileKey] = {
      ...(profiles[profileKey] || {}),
      ...normalizeObject(overrides)
    };
    await this._enqueueWrite();
  }

  async _ensureLoaded() {
    if (this._loaded) {
      return;
    }
    this._loaded = true;
    await fs.mkdir(path.dirname(this._filePath), { recursive: true });
    try {
      const raw = await fs.readFile(this._filePath, "utf8");
      if (!raw.trim()) {
        return;
      }
      const parsed = JSON.parse(raw);
      this._state = normalizeState(parsed);
    } catch (error) {
      if (error && error.code === "ENOENT") {
        return;
      }
      throw error;
    }
  }

  async _enqueueWrite() {
    this._writeQueue = this._writeQueue.then(async () => {
      const tempPath = `${this._filePath}.tmp`;
      await fs.writeFile(tempPath, JSON.stringify(this._state), "utf8");
      await fs.rename(tempPath, this._filePath);
    });
    await this._writeQueue;
  }
}

function normalizeState(raw) {
  const state = {
    games: {}
  };
  const games = raw && typeof raw === "object" ? raw.games : null;
  if (!games || typeof games !== "object") {
    return state;
  }
  for (const [gameId, gameConfig] of Object.entries(games)) {
    if (!gameId) {
      continue;
    }
    const defaults = normalizeObject(gameConfig?.defaults);
    const profilesRaw = gameConfig?.profiles;
    const profiles = {};
    if (profilesRaw && typeof profilesRaw === "object") {
      for (const [profileId, profileFlags] of Object.entries(profilesRaw)) {
        if (!profileId) {
          continue;
        }
        profiles[profileId] = normalizeObject(profileFlags);
      }
    }
    state.games[gameId] = { defaults, profiles };
  }
  return state;
}

function normalizeObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return { ...value };
}

function normalizeKey(value) {
  const key = String(value || "").trim();
  if (!key) {
    throw new Error("key is required");
  }
  return key;
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}
