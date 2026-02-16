import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createFeatureFlagsHttpServer,
  createFeatureFlagsService,
  InMemoryFlagStore
} from "../services/feature-flags/index.js";
import { createSessionToken } from "../packages/shared-utils/index.js";

describe("feature-flags http", () => {
  const sessionSecret = "feature-flags-session-secret-12345";
  const sessionIssuer = "terapixel.identity";
  const sessionAudience = "terapixel.game";
  const service = createFeatureFlagsService({
    flagStore: new InMemoryFlagStore()
  });
  const httpServer = createFeatureFlagsHttpServer({
    service,
    allowedOrigins: "*",
    adminKey: "feature-flags-admin-key",
    sessionSecret,
    sessionIssuer,
    sessionAudience
  });
  let baseUrl = "";

  before(async () => {
    await service.setGameDefaults({
      gameId: "lumarush",
      defaults: {
        new_ui: false,
        seasonal_event: true
      }
    });
    await service.setProfileOverrides({
      gameId: "lumarush",
      profileId: "player_100",
      overrides: {
        new_ui: true
      }
    });
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
    assert.ok(typeof body.request_id === "string");
  });

  it("returns defaults for game without session token", async () => {
    const response = await fetch(`${baseUrl}/v1/flags?game_id=lumarush`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.profile_id, "");
    assert.deepEqual(body.flags, {
      new_ui: false,
      seasonal_event: true
    });
  });

  it("requires session when profile_id is explicitly requested", async () => {
    const response = await fetch(
      `${baseUrl}/v1/flags?game_id=lumarush&profile_id=player_100`
    );
    assert.equal(response.status, 401);
    const body = await response.json();
    assert.equal(body.error.code, "missing_session");
  });

  it("returns profile override when bearer session subject matches profile_id", async () => {
    const token = createSessionToken({ sub: "player_100" }, sessionSecret, {
      issuer: sessionIssuer,
      audience: sessionAudience,
      ttlSeconds: 600,
      nowSeconds: 1_800_000_000
    });
    const response = await fetch(
      `${baseUrl}/v1/flags?game_id=lumarush&profile_id=player_100`,
      {
        headers: {
          authorization: `Bearer ${token}`
        }
      }
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.profile_id, "player_100");
    assert.deepEqual(body.flags, {
      new_ui: true,
      seasonal_event: true
    });
  });

  it("rejects mismatched profile id", async () => {
    const token = createSessionToken({ sub: "player_200" }, sessionSecret, {
      issuer: sessionIssuer,
      audience: sessionAudience,
      ttlSeconds: 600,
      nowSeconds: 1_800_000_000
    });
    const response = await fetch(
      `${baseUrl}/v1/flags?game_id=lumarush&profile_id=player_100`,
      {
        headers: {
          authorization: `Bearer ${token}`
        }
      }
    );
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.error.code, "forbidden");
  });

  it("supports admin flag upsert", async () => {
    const response = await fetch(`${baseUrl}/v1/flags/admin`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-admin-key": "feature-flags-admin-key"
      },
      body: JSON.stringify({
        game_id: "nova",
        defaults: {
          hard_mode: true
        }
      })
    });
    assert.equal(response.status, 200);
    const getResponse = await fetch(`${baseUrl}/v1/flags?game_id=nova`);
    const getBody = await getResponse.json();
    assert.equal(getBody.flags.hard_mode, true);
  });

  it("handles CORS preflight", async () => {
    const response = await fetch(`${baseUrl}/v1/flags?game_id=lumarush`, {
      method: "OPTIONS",
      headers: {
        origin: "https://example.com",
        "access-control-request-method": "GET"
      }
    });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
  });

  it("derives profile from nakama_user_id claim when no profile_id is supplied", async () => {
    await service.setProfileOverrides({
      gameId: "lumarush",
      profileId: "nk_user_777",
      overrides: {
        seasonal_event: false
      }
    });
    const token = createSessionToken(
      { sub: "legacy_player", nakama_user_id: "nk_user_777" },
      sessionSecret,
      {
        issuer: sessionIssuer,
        audience: sessionAudience,
        ttlSeconds: 600,
        nowSeconds: 1_800_000_000
      }
    );
    const response = await fetch(`${baseUrl}/v1/flags?game_id=lumarush`, {
      headers: {
        authorization: `Bearer ${token}`
      }
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.profile_id, "nk_user_777");
    assert.equal(body.flags.seasonal_event, false);
  });
});
