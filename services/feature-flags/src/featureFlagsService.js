import { InMemoryFlagStore } from "./flagStore.js";
import { createNoopRuntimeConfigProvider } from "../../../packages/shared-utils/index.js";

export function createFeatureFlagsService(options = {}) {
  const flagStore = options.flagStore || new InMemoryFlagStore();
  const runtimeConfigProvider =
    options.runtimeConfigProvider || createNoopRuntimeConfigProvider();
  const runtimeConfigRequired = options.runtimeConfigRequired === true;

  return {
    flagStore,
    getFlags: async ({ gameId, profileId }) => {
      assertRequiredString(gameId, "gameId");
      const normalizedProfileId =
        typeof profileId === "string" && profileId.trim()
          ? profileId.trim()
          : "";
      const runtimeConfig = await getRuntimeConfigForGame({
        gameId,
        runtimeConfigProvider,
        runtimeConfigRequired
      });
      const gameConfig = await flagStore.getGameConfig(gameId);
      const defaults = {
        ...(gameConfig.defaults || {}),
        ...(runtimeConfig?.featureFlags || {})
      };
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
    },
    mergeProfiles: async ({ primaryProfileId, secondaryProfileId }) => {
      assertRequiredString(primaryProfileId, "primaryProfileId");
      assertRequiredString(secondaryProfileId, "secondaryProfileId");
      if (primaryProfileId === secondaryProfileId) {
        return { merged: false };
      }
      if (typeof flagStore.mergeProfileOverrides === "function") {
        await flagStore.mergeProfileOverrides(primaryProfileId, secondaryProfileId);
      }
      return { merged: true };
    }
  };
}

async function getRuntimeConfigForGame(input = {}) {
  if (!input.runtimeConfigRequired) {
    return null;
  }
  const config = await input.runtimeConfigProvider.getRuntimeConfig({
    gameId: input.gameId
  });
  if (!config) {
    throw new Error("game_id is not onboarded or is inactive");
  }
  return config;
}

function assertRequiredString(value, fieldName) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName} is required`);
  }
}
