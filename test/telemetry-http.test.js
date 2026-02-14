import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createTelemetryIngestHttpServer,
  createTelemetryIngestService,
  InMemoryTelemetrySink
} from "../services/telemetry-ingest/index.js";
import { createSessionToken } from "../packages/shared-utils/index.js";

describe("telemetry-ingest http", () => {
  const sessionSecret = "telemetry-session-secret-12345";
  const sessionIssuer = "terapixel.identity";
  const sessionAudience = "terapixel.game";
  const service = createTelemetryIngestService({
    sink: new InMemoryTelemetrySink()
  });
  const httpServer = createTelemetryIngestHttpServer({
    service,
    allowedOrigins: "*",
    requireSession: true,
    sessionSecret,
    sessionIssuer,
    sessionAudience
  });
  let baseUrl = "";

  before(async () => {
    const listenInfo = await httpServer.listen(0, "127.0.0.1");
    baseUrl = listenInfo.baseUrl;
  });

  after(async () => {
    await httpServer.close();
  });

  it("serves health", async () => {
    const response = await fetch(`${baseUrl}/healthz`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
  });

  it("rejects missing session", async () => {
    const response = await fetch(`${baseUrl}/v1/telemetry/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        game_id: "lumarush",
        events: [{ event_name: "run_start" }]
      })
    });
    assert.equal(response.status, 401);
    const body = await response.json();
    assert.equal(body.error.code, "missing_session");
  });

  it("accepts event batch with valid session", async () => {
    const token = createSessionToken({ sub: "player_100" }, sessionSecret, {
      issuer: sessionIssuer,
      audience: sessionAudience,
      ttlSeconds: 600,
      nowSeconds: 1_800_000_000
    });
    const response = await fetch(`${baseUrl}/v1/telemetry/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        game_id: "lumarush",
        events: [{ event_name: "run_complete" }]
      })
    });
    assert.equal(response.status, 202);
    const body = await response.json();
    assert.equal(body.accepted_events, 1);
    assert.equal(body.profile_id, "player_100");
  });

  it("rejects profile_id mismatch", async () => {
    const token = createSessionToken({ sub: "player_111" }, sessionSecret, {
      issuer: sessionIssuer,
      audience: sessionAudience,
      ttlSeconds: 600,
      nowSeconds: 1_800_000_000
    });
    const response = await fetch(`${baseUrl}/v1/telemetry/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        game_id: "lumarush",
        profile_id: "player_222",
        events: [{ event_name: "run_complete" }]
      })
    });
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.error.code, "forbidden");
  });

  it("handles CORS preflight", async () => {
    const response = await fetch(`${baseUrl}/v1/telemetry/events`, {
      method: "OPTIONS",
      headers: {
        origin: "https://example.com",
        "access-control-request-method": "POST"
      }
    });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
  });
});
