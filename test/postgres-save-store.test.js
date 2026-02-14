import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PostgresSaveStore,
  createDefaultSaveEnvelope
} from "../services/save-service/index.js";

describe("postgres save store", () => {
  it("initializes and performs get/put operations", async () => {
    const rows = new Map();
    const pool = {
      query: async (sql, params = []) => {
        if (sql.includes("CREATE TABLE")) {
          return { rows: [] };
        }
        if (sql.includes("INSERT INTO")) {
          const [gameId, profileId, envelopeJson] = params;
          const key = `${gameId}:${profileId}`;
          const envelope = JSON.parse(envelopeJson);
          rows.set(key, envelope);
          return {
            rows: [{ envelope }]
          };
        }
        if (sql.includes("SELECT envelope")) {
          const [gameId, profileId] = params;
          const key = `${gameId}:${profileId}`;
          const envelope = rows.get(key);
          return {
            rows: envelope ? [{ envelope }] : []
          };
        }
        throw new Error("unexpected query");
      }
    };

    const store = new PostgresSaveStore({ pool });
    await store.init();
    const envelope = createDefaultSaveEnvelope({
      gameId: "lumarush",
      profileId: "player_pg",
      updatedAt: 1_800_000_000,
      payload: {
        high_score: 451
      }
    });

    await store.put(envelope);
    const loaded = await store.get("lumarush", "player_pg");
    assert.equal(loaded.payload.high_score, 451);
  });
});
