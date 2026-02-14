import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  JsonFileSaveStore,
  createDefaultSaveEnvelope
} from "../services/save-service/index.js";

describe("json file save store", () => {
  it("persists and reloads save envelopes", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tp-save-store-"));
    const filePath = path.join(dir, "saves.json");
    const storeA = new JsonFileSaveStore({ filePath });
    const envelope = createDefaultSaveEnvelope({
      gameId: "lumarush",
      profileId: "player_file",
      updatedAt: 1_800_000_000,
      payload: {
        high_score: 999
      }
    });
    await storeA.put(envelope);

    const storeB = new JsonFileSaveStore({ filePath });
    const loaded = await storeB.get("lumarush", "player_file");
    assert.equal(loaded.payload.high_score, 999);

    await fs.rm(dir, { recursive: true, force: true });
  });
});
