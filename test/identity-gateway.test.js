import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createDeterministicPlayerId,
  createIdentityGatewayService
} from "../services/identity-gateway/index.js";
import { verifySessionToken } from "../packages/shared-utils/index.js";
import {
  createSignedJwt,
  createStaticKeyStore,
  generateRsaKeyPair
} from "../tools/test-helpers/jwtTestUtils.js";

describe("identity-gateway service", () => {
  it("creates new player on first auth and reuses on second auth", async () => {
    const { privateKey, publicKey } = generateRsaKeyPair();
    const keyStore = createStaticKeyStore(publicKey, "cg-kid");
    const service = createIdentityGatewayService();
    const now = 1_800_000_000;

    const firstToken = createSignedJwt(
      {
        userId: "cg_user_44",
        username: "First Name",
        iss: "https://auth.crazygames.com",
        aud: "lumarush",
        exp: now + 300
      },
      { privateKey, kid: "cg-kid" }
    );

    const first = await service.authenticateCrazyGamesUser({
      token: firstToken,
      keyStore,
      expectedIssuer: "https://auth.crazygames.com",
      expectedAudience: "lumarush",
      nowSeconds: now
    });
    assert.equal(first.isNewPlayer, true);

    const secondToken = createSignedJwt(
      {
        userId: "cg_user_44",
        username: "Updated Name",
        iss: "https://auth.crazygames.com",
        aud: "lumarush",
        exp: now + 300
      },
      { privateKey, kid: "cg-kid" }
    );
    const second = await service.authenticateCrazyGamesUser({
      token: secondToken,
      keyStore,
      expectedIssuer: "https://auth.crazygames.com",
      expectedAudience: "lumarush",
      nowSeconds: now + 10
    });

    assert.equal(second.isNewPlayer, false);
    assert.equal(second.player.playerId, first.player.playerId);
    assert.equal(second.player.displayName, "Updated Name");
    assert.equal(second.player.lastSeenAt, now + 10);
  });

  it("creates deterministic player ids", () => {
    const a = createDeterministicPlayerId("crazygames", "u1");
    const b = createDeterministicPlayerId("crazygames", "u1");
    const c = createDeterministicPlayerId("crazygames", "u2");
    assert.equal(a, b);
    assert.notEqual(a, c);
  });

  it("mints session token when configured", async () => {
    const { privateKey, publicKey } = generateRsaKeyPair();
    const keyStore = createStaticKeyStore(publicKey, "cg-kid");
    const now = 1_800_000_000;
    const service = createIdentityGatewayService({
      sessionSecret: "identity-session-secret-12345",
      sessionIssuer: "terapixel.identity",
      sessionAudience: "terapixel.game",
      sessionTtlSeconds: 300
    });
    const token = createSignedJwt(
      {
        userId: "cg_user_55",
        iss: "https://auth.crazygames.com",
        aud: "lumarush",
        exp: now + 300
      },
      { privateKey, kid: "cg-kid" }
    );
    const result = await service.authenticateCrazyGamesUser({
      token,
      keyStore,
      expectedIssuer: "https://auth.crazygames.com",
      expectedAudience: "lumarush",
      nowSeconds: now
    });
    assert.ok(result.sessionToken);
    assert.equal(result.sessionExpiresAt, now + 300);
    const claims = verifySessionToken(
      result.sessionToken,
      "identity-session-secret-12345",
      {
        issuer: "terapixel.identity",
        audience: "terapixel.game",
        nowSeconds: now
      }
    );
    assert.equal(claims.sub, result.player.playerId);
  });
});
