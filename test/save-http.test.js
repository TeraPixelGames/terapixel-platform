import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createSaveHttpServer,
  createDefaultSaveEnvelope,
  createSaveService,
  InMemorySaveStore
} from "../services/save-service/index.js";
import { createSessionToken } from "../packages/shared-utils/index.js";

describe("save-service http", () => {
  const sessionSecret = "save-service-secret-12345";
  const sessionIssuer = "terapixel.identity";
  const sessionAudience = "terapixel.game";
  const service = createSaveService({
    saveStore: new InMemorySaveStore()
  });
  const httpServer = createSaveHttpServer({
    service,
    allowedOrigins: "*",
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

  it("rejects missing auth token", async () => {
    const response = await fetch(`${baseUrl}/v1/save/sync`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        game_id: "lumarush"
      })
    });
    assert.equal(response.status, 401);
    const body = await response.json();
    assert.equal(body.error.code, "missing_session");
  });

  it("syncs save using bearer session", async () => {
    const token = createSessionToken(
      { sub: "player_100", scope: "player_session" },
      sessionSecret,
      {
        issuer: sessionIssuer,
        audience: sessionAudience,
        ttlSeconds: 600,
        nowSeconds: 1_800_000_000
      }
    );

    const response = await fetch(`${baseUrl}/v1/save/sync`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        game_id: "lumarush",
        now_seconds: 1_800_000_001
      })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.source, "created_default");
    assert.equal(body.envelope.profile_id, "player_100");
    assert.equal(body.envelope.game_id, "lumarush");
  });

  it("rejects expired session token", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = createSessionToken({ sub: "player_200" }, sessionSecret, {
      issuer: sessionIssuer,
      audience: sessionAudience,
      ttlSeconds: 1,
      nowSeconds: now - 30
    });

    const response = await fetch(`${baseUrl}/v1/save/sync`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        game_id: "lumarush"
      })
    });
    assert.equal(response.status, 401);
    const body = await response.json();
    assert.equal(body.error.code, "invalid_session");
  });

  it("rejects client envelope for different profile", async () => {
    const token = createSessionToken(
      { sub: "player_300", scope: "player_session" },
      sessionSecret,
      {
        issuer: sessionIssuer,
        audience: sessionAudience,
        ttlSeconds: 600,
        nowSeconds: 1_800_000_000
      }
    );
    const response = await fetch(`${baseUrl}/v1/save/sync`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        game_id: "lumarush",
        client_envelope: createDefaultSaveEnvelope({
          gameId: "lumarush",
          profileId: "another_player",
          updatedAt: 1_800_000_000
        })
      })
    });
    assert.equal(response.status, 422);
    const body = await response.json();
    assert.equal(body.error.code, "invalid_request");
  });

  it("handles CORS preflight", async () => {
    const response = await fetch(`${baseUrl}/v1/save/sync`, {
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
