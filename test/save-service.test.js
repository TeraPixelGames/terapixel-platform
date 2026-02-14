import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  InMemorySaveStore,
  createDefaultSaveEnvelope,
  createSaveService
} from "../services/save-service/index.js";

describe("save-service", () => {
  it("creates default envelope when none exists", async () => {
    const service = createSaveService({
      saveStore: new InMemorySaveStore()
    });
    const result = await service.syncSave({
      gameId: "lumarush",
      profileId: "player_1",
      nowSeconds: 1_800_000_000
    });

    assert.equal(result.source, "created_default");
    assert.equal(result.envelope.game_id, "lumarush");
    assert.equal(result.envelope.profile_id, "player_1");
  });

  it("persists first client envelope", async () => {
    const service = createSaveService({
      saveStore: new InMemorySaveStore()
    });
    const envelope = createDefaultSaveEnvelope({
      gameId: "lumarush",
      profileId: "player_2",
      updatedAt: 1_800_000_000,
      payload: {
        high_score: 120
      }
    });
    const result = await service.syncSave({
      gameId: "lumarush",
      profileId: "player_2",
      clientEnvelope: envelope,
      nowSeconds: 1_800_000_010
    });
    assert.equal(result.source, "client_first_write");
    assert.equal(result.envelope.payload.high_score, 120);
  });

  it("merges client and server envelopes", async () => {
    const service = createSaveService({
      saveStore: new InMemorySaveStore()
    });
    await service.syncSave({
      gameId: "lumarush",
      profileId: "player_3",
      clientEnvelope: createDefaultSaveEnvelope({
        gameId: "lumarush",
        profileId: "player_3",
        revision: 2,
        updatedAt: 1_800_000_000,
        payload: {
          high_score: 100
        }
      }),
      nowSeconds: 1_800_000_005
    });

    const result = await service.syncSave({
      gameId: "lumarush",
      profileId: "player_3",
      clientEnvelope: createDefaultSaveEnvelope({
        gameId: "lumarush",
        profileId: "player_3",
        revision: 3,
        updatedAt: 1_800_000_010,
        payload: {
          high_score: 180,
          games_played: 4
        }
      }),
      nowSeconds: 1_800_000_020
    });
    assert.equal(result.source, "merged");
    assert.equal(result.envelope.payload.high_score, 180);
    assert.equal(result.envelope.revision, 4);
  });
});
