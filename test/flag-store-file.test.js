import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { JsonFileFlagStore } from "../services/feature-flags/index.js";

describe("json file flag store", () => {
  const tempDir = path.join(
    os.tmpdir(),
    `terapixel-flag-store-${process.pid}-${Date.now()}`
  );
  const filePath = path.join(tempDir, "flags.json");

  after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("persists defaults and overrides", async () => {
    const storeA = new JsonFileFlagStore({ filePath });
    await storeA.upsertGameDefaults("lumarush", {
      daily_bonus: true
    });
    await storeA.upsertProfileOverrides("lumarush", "player_9", {
      daily_bonus: false
    });

    const storeB = new JsonFileFlagStore({ filePath });
    const gameConfig = await storeB.getGameConfig("lumarush");
    assert.equal(gameConfig.defaults.daily_bonus, true);
    assert.equal(gameConfig.profiles.player_9.daily_bonus, false);
  });
});
