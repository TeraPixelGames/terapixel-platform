import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createPlayerService } from "../services/player-service/index.js";

describe("player-service", () => {
  it("creates and fetches player", async () => {
    const service = createPlayerService();
    const now = 1_800_000_000;
    const created = await service.upsertPlayer({
      playerId: "player_1",
      displayName: "Arcade Hero",
      attributes: { region: "us" },
      nowSeconds: now
    });

    assert.equal(created.playerId, "player_1");
    assert.equal(created.displayName, "Arcade Hero");
    assert.equal(created.createdAt, now);
    assert.equal(created.lastSeenAt, now);
    assert.deepEqual(created.attributes, { region: "us" });

    const loaded = await service.getPlayer("player_1");
    assert.deepEqual(loaded, created);
  });

  it("updates existing player while preserving createdAt and merging attributes", async () => {
    const service = createPlayerService();
    await service.upsertPlayer({
      playerId: "player_2",
      displayName: "First",
      attributes: { region: "us", level: 3 },
      nowSeconds: 100
    });

    const updated = await service.upsertPlayer({
      playerId: "player_2",
      displayName: "Second",
      attributes: { level: 4, vip: true },
      nowSeconds: 110
    });

    assert.equal(updated.createdAt, 100);
    assert.equal(updated.lastSeenAt, 110);
    assert.equal(updated.displayName, "Second");
    assert.deepEqual(updated.attributes, {
      region: "us",
      level: 4,
      vip: true
    });
  });

  it("lists players", async () => {
    const service = createPlayerService();
    await service.upsertPlayer({
      playerId: "a",
      nowSeconds: 100
    });
    await service.upsertPlayer({
      playerId: "b",
      nowSeconds: 100
    });
    const list = await service.listPlayers();
    assert.equal(list.length, 2);
    const ids = list.map((it) => it.playerId).sort();
    assert.deepEqual(ids, ["a", "b"]);
  });
});
