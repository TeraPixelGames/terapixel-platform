import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createFeatureFlagsService,
  InMemoryFlagStore
} from "../services/feature-flags/index.js";

describe("feature-flags service", () => {
  it("returns defaults merged with profile overrides", async () => {
    const service = createFeatureFlagsService({
      flagStore: new InMemoryFlagStore()
    });
    await service.setGameDefaults({
      gameId: "lumarush",
      defaults: {
        new_ui: false,
        daily_bonus: true
      }
    });
    await service.setProfileOverrides({
      gameId: "lumarush",
      profileId: "player_1",
      overrides: {
        new_ui: true
      }
    });

    const result = await service.getFlags({
      gameId: "lumarush",
      profileId: "player_1"
    });
    assert.deepEqual(result, {
      game_id: "lumarush",
      profile_id: "player_1",
      flags: {
        new_ui: true,
        daily_bonus: true
      }
    });
  });

  it("returns defaults when profile is not provided", async () => {
    const service = createFeatureFlagsService({
      flagStore: new InMemoryFlagStore()
    });
    await service.setGameDefaults({
      gameId: "lumarush",
      defaults: {
        event_pass: false
      }
    });
    const result = await service.getFlags({
      gameId: "lumarush"
    });
    assert.equal(result.profile_id, "");
    assert.deepEqual(result.flags, {
      event_pass: false
    });
  });

  it("throws when gameId is missing", async () => {
    const service = createFeatureFlagsService({
      flagStore: new InMemoryFlagStore()
    });
    await assert.rejects(
      () =>
        service.getFlags({
          gameId: ""
        }),
      /gameId is required/
    );
  });
});
