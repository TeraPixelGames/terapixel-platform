import { InMemoryFlagStore } from "./flagStore.js";

export function createFeatureFlagsService(options = {}) {
  const flagStore = options.flagStore || new InMemoryFlagStore();

  return {
    flagStore,
    getFlags: async ({ gameId, profileId }) => {
      assertRequiredString(gameId, "gameId");
      const normalizedProfileId =
        typeof profileId === "string" && profileId.trim()
          ? profileId.trim()
          : "";
      const gameConfig = await flagStore.getGameConfig(gameId);
      const defaults = gameConfig.defaults || {};
      const profileOverrides =
        normalizedProfileId && gameConfig.profiles
          ? gameConfig.profiles[normalizedProfileId] || {}
          : {};
      return {
        game_id: gameId,
        profile_id: normalizedProfileId,
        flags: {
          ...defaults,
          ...profileOverrides
        }
      };
    },
    setGameDefaults: async ({ gameId, defaults }) => {
      assertRequiredString(gameId, "gameId");
      await flagStore.upsertGameDefaults(gameId, defaults || {});
    },
    setProfileOverrides: async ({ gameId, profileId, overrides }) => {
      assertRequiredString(gameId, "gameId");
      assertRequiredString(profileId, "profileId");
      await flagStore.upsertProfileOverrides(gameId, profileId, overrides || {});
    }
  };
}

function assertRequiredString(value, fieldName) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName} is required`);
  }
}
