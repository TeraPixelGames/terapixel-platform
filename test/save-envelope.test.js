import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createDefaultSaveEnvelope,
  mergeSaveEnvelopes,
  validateSaveEnvelope
} from "../services/save-service/index.js";

describe("save envelope", () => {
  it("creates and validates default envelope", () => {
    const envelope = createDefaultSaveEnvelope({
      gameId: "lumarush",
      profileId: "player_1",
      updatedAt: 1_800_000_000
    });
    validateSaveEnvelope(envelope);
    assert.equal(envelope.payload.selected_track_id, "glassgrid");
  });

  it("merges fields with deterministic policy", () => {
    const local = createDefaultSaveEnvelope({
      gameId: "lumarush",
      profileId: "player_1",
      revision: 5,
      updatedAt: 1_800_000_010,
      payload: {
        high_score: 100,
        games_played: 6,
        streak_days: 3,
        streak_at_risk: 2,
        last_play_date: "2026-02-13",
        selected_track_id: "glassgrid",
        local_only_flag: true
      }
    });
    const remote = createDefaultSaveEnvelope({
      gameId: "lumarush",
      profileId: "player_1",
      revision: 6,
      updatedAt: 1_800_000_020,
      payload: {
        high_score: 180,
        games_played: 4,
        streak_days: 2,
        streak_at_risk: 0,
        last_play_date: "2026-02-14",
        selected_track_id: "neon",
        remote_bonus: 7
      }
    });

    const merged = mergeSaveEnvelopes(local, remote, {
      nowSeconds: 1_800_000_030
    });

    assert.equal(merged.revision, 7);
    assert.equal(merged.payload.high_score, 180);
    assert.equal(merged.payload.games_played, 6);
    assert.equal(merged.payload.streak_days, 3);
    assert.equal(merged.payload.streak_at_risk, 2);
    assert.equal(merged.payload.last_play_date, "2026-02-14");
    assert.equal(merged.payload.selected_track_id, "neon");
    assert.equal(merged.payload.local_only_flag, true);
    assert.equal(merged.payload.remote_bonus, 7);
  });

  it("rejects merges for mismatched profile", () => {
    const a = createDefaultSaveEnvelope({
      gameId: "lumarush",
      profileId: "player_a",
      updatedAt: 1_800_000_000
    });
    const b = createDefaultSaveEnvelope({
      gameId: "lumarush",
      profileId: "player_b",
      updatedAt: 1_800_000_000
    });

    assert.throws(() => mergeSaveEnvelopes(a, b), /different profile_id/);
  });
});
