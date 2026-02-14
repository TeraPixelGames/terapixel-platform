import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { JsonFileTelemetrySink } from "../services/telemetry-ingest/index.js";

describe("json file telemetry sink", () => {
  const tempDir = path.join(
    os.tmpdir(),
    `terapixel-telemetry-sink-${process.pid}-${Date.now()}`
  );
  const filePath = path.join(tempDir, "telemetry.jsonl");

  after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("appends and reads recent batches", async () => {
    const sinkA = new JsonFileTelemetrySink({ filePath });
    await sinkA.appendBatch({
      game_id: "lumarush",
      profile_id: "player_1",
      events: [{ event_name: "a", event_time: 1 }]
    });
    await sinkA.appendBatch({
      game_id: "lumarush",
      profile_id: "player_2",
      events: [{ event_name: "b", event_time: 2 }]
    });

    const sinkB = new JsonFileTelemetrySink({ filePath });
    const recent = await sinkB.getRecent(2);
    assert.equal(recent.length, 2);
    assert.equal(recent[1].profile_id, "player_2");
  });
});
