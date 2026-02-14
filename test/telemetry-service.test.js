import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createTelemetryIngestService,
  InMemoryTelemetrySink
} from "../services/telemetry-ingest/index.js";

describe("telemetry service", () => {
  it("ingests and normalizes event batches", async () => {
    const sink = new InMemoryTelemetrySink();
    const service = createTelemetryIngestService({ sink });
    const result = await service.ingestEvents({
      gameId: "lumarush",
      profileId: "player_1",
      sessionId: "session_abc",
      nowSeconds: 1_800_000_000,
      events: [
        {
          event_name: "run_start",
          properties: {
            difficulty: "hard"
          }
        }
      ]
    });
    assert.equal(result.accepted_events, 1);
    const batches = await sink.getRecent(5);
    assert.equal(batches.length, 1);
    assert.equal(batches[0].events[0].event_time, 1_800_000_000);
  });

  it("rejects empty events", async () => {
    const service = createTelemetryIngestService({
      sink: new InMemoryTelemetrySink()
    });
    await assert.rejects(
      () =>
        service.ingestEvents({
          gameId: "lumarush",
          events: []
        }),
      /events must be a non-empty array/
    );
  });

  it("enforces max events per request", async () => {
    const service = createTelemetryIngestService({
      sink: new InMemoryTelemetrySink(),
      maxEventsPerRequest: 2
    });
    await assert.rejects(
      () =>
        service.ingestEvents({
          gameId: "lumarush",
          events: [
            { event_name: "a" },
            { event_name: "b" },
            { event_name: "c" }
          ]
        }),
      /maxEventsPerRequest/
    );
  });
});
