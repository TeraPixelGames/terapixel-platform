import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createIdentityGatewayHttpServer,
  createIdentityGatewayService
} from "../services/identity-gateway/index.js";
import { verifySessionToken } from "../packages/shared-utils/index.js";
import {
  createSignedJwt,
  createStaticKeyStore,
  generateRsaKeyPair
} from "../tools/test-helpers/jwtTestUtils.js";

describe("identity-gateway http", () => {
  const { privateKey, publicKey } = generateRsaKeyPair();
  const keyStore = createStaticKeyStore(publicKey, "cg-kid-1");
  const sessionSecret = "identity-session-secret-12345";
  const service = createIdentityGatewayService({
    sessionSecret,
    sessionIssuer: "terapixel.identity",
    sessionAudience: "terapixel.game"
  });
  const httpServer = createIdentityGatewayHttpServer({
    service,
    allowedOrigins: "*",
    authConfig: {
      keyStore,
      expectedIssuer: "https://auth.crazygames.com",
      expectedAudience: "lumarush",
      clockSkewSeconds: 5
    }
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
    assert.ok(typeof body.request_id === "string");
  });

  it("authenticates crazygames token", async () => {
    const now = 1_800_000_000;
    const token = createSignedJwt(
      {
        userId: "cg_user_9",
        username: "Nova",
        iss: "https://auth.crazygames.com",
        aud: "lumarush",
        exp: now + 300
      },
      { privateKey, kid: "cg-kid-1" }
    );
    const response = await fetch(`${baseUrl}/v1/auth/crazygames`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        token,
        nowSeconds: now
      })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.provider, "crazygames");
    assert.ok(typeof body.request_id === "string");
    assert.equal(body.provider_user_id, "cg_user_9");
    assert.equal(body.display_name, "Nova");
    assert.equal(body.is_new_player, true);
    assert.ok(typeof body.session_token === "string" && body.session_token);
    const claims = verifySessionToken(body.session_token, sessionSecret, {
      issuer: "terapixel.identity",
      audience: "terapixel.game",
      nowSeconds: now
    });
    assert.equal(claims.sub, body.player_id);
    assert.ok(body.session_expires_at > now);
  });

  it("returns invalid token for wrong audience", async () => {
    const now = 1_800_000_000;
    const token = createSignedJwt(
      {
        userId: "cg_user_10",
        iss: "https://auth.crazygames.com",
        aud: "wrong-game",
        exp: now + 300
      },
      { privateKey, kid: "cg-kid-1" }
    );
    const response = await fetch(`${baseUrl}/v1/auth/crazygames`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        token,
        nowSeconds: now
      })
    });
    assert.equal(response.status, 401);
    const body = await response.json();
    assert.equal(body.error.code, "invalid_token");
  });

  it("returns bad request when token is missing", async () => {
    const response = await fetch(`${baseUrl}/v1/auth/crazygames`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({})
    });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error.code, "invalid_request");
  });

  it("returns invalid_json on malformed JSON body", async () => {
    const response = await fetch(`${baseUrl}/v1/auth/crazygames`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: "{bad-json"
    });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error.code, "invalid_json");
  });

  it("handles CORS preflight", async () => {
    const response = await fetch(`${baseUrl}/v1/auth/crazygames`, {
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
