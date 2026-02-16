import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createIdentityGatewayHttpServer,
  createIdentityGatewayService
} from "../services/identity-gateway/index.js";
import { createSessionToken } from "../packages/shared-utils/index.js";
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
    sessionAudience: "terapixel.game",
    magicLinkBaseUrl: "https://terapixel.games/auth/magic-link"
  });
  const httpServer = createIdentityGatewayHttpServer({
    service,
    allowedOrigins: "*",
    sessionSecret,
    sessionIssuer: "terapixel.identity",
    sessionAudience: "terapixel.game",
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
  });

  it("authenticates nakama user", async () => {
    const response = await fetch(`${baseUrl}/v1/auth/nakama`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        game_id: "lumarush",
        nakama_user_id: "nk-http-77"
      })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.nakama_user_id, "nk-http-77");
  });

  it("issues and redeems merge code", async () => {
    const primaryToken = createSessionToken(
      { sub: "legacy", nakama_user_id: "primary_nk" },
      sessionSecret,
      {
        issuer: "terapixel.identity",
        audience: "terapixel.game",
        ttlSeconds: 600,
        nowSeconds: 1_800_000_000
      }
    );
    const createResponse = await fetch(`${baseUrl}/v1/account/merge/code`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${primaryToken}`
      }
    });
    assert.equal(createResponse.status, 200);
    const createBody = await createResponse.json();
    assert.ok(createBody.merge_code);

    const secondaryToken = createSessionToken(
      { sub: "legacy", nakama_user_id: "secondary_nk" },
      sessionSecret,
      {
        issuer: "terapixel.identity",
        audience: "terapixel.game",
        ttlSeconds: 600,
        nowSeconds: 1_800_000_001
      }
    );
    const redeemResponse = await fetch(`${baseUrl}/v1/account/merge/redeem`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${secondaryToken}`
      },
      body: JSON.stringify({
        merge_code: createBody.merge_code
      })
    });
    assert.equal(redeemResponse.status, 200);
  });

  it("starts and completes magic link flow", async () => {
    const now = 1_800_000_200;
    const session = createSessionToken(
      { sub: "legacy", nakama_user_id: "nk_magic_a" },
      sessionSecret,
      {
        issuer: "terapixel.identity",
        audience: "terapixel.game",
        ttlSeconds: 600,
        nowSeconds: now
      }
    );
    const start = await fetch(`${baseUrl}/v1/account/magic-link/start`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${session}`
      },
      body: JSON.stringify({
        email: "magic@example.com",
        nowSeconds: now
      })
    });
    assert.equal(start.status, 200);
    const startBody = await start.json();
    assert.equal(startBody.accepted, true);

    const tokenRow = await service.identityStore.createMagicLinkToken(
      "magic@example.com",
      "nk_magic_a",
      { nowSeconds: now, ttlSeconds: 900 }
    );
    const complete = await fetch(`${baseUrl}/v1/account/magic-link/complete`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${session}`
      },
      body: JSON.stringify({
        ml_token: tokenRow.token,
        nowSeconds: now + 1
      })
    });
    assert.equal(complete.status, 200);
    const completeBody = await complete.json();
    assert.equal(completeBody.status, "upgraded");
  });

  it("consumes magic link via web endpoint", async () => {
    const now = 1_800_000_300;
    const tokenRow = await service.identityStore.createMagicLinkToken(
      "consume@example.com",
      "nk_magic_consume",
      { nowSeconds: now, ttlSeconds: 900 }
    );
    const response = await fetch(
      `${baseUrl}/v1/account/magic-link/consume?ml_token=${encodeURIComponent(tokenRow.token)}`
    );
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /Account Linked/i);
  });
});
