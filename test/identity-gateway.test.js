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
  it("creates deterministic player ids", () => {
    const a = createDeterministicPlayerId("crazygames", "u1");
    const b = createDeterministicPlayerId("crazygames", "u1");
    const c = createDeterministicPlayerId("crazygames", "u2");
    assert.equal(a, b);
    assert.notEqual(a, c);
  });

  it("authenticates nakama user and mints session with nakama claim", async () => {
    const now = 1_800_000_050;
    const service = createIdentityGatewayService({
      sessionSecret: "identity-session-secret-12345",
      sessionIssuer: "terapixel.identity",
      sessionAudience: "terapixel.game",
      sessionTtlSeconds: 300
    });
    const result = await service.authenticateNakamaUser({
      gameId: "lumarush",
      nakamaUserId: "nk-user-1",
      nowSeconds: now
    });
    const claims = verifySessionToken(
      result.sessionToken,
      "identity-session-secret-12345",
      {
        issuer: "terapixel.identity",
        audience: "terapixel.game",
        nowSeconds: now
      }
    );
    assert.equal(claims.nakama_user_id, "nk-user-1");
  });

  it("creates and redeems merge code", async () => {
    const service = createIdentityGatewayService();
    await service.authenticateNakamaUser({
      gameId: "lumarush",
      nakamaUserId: "primary",
      nowSeconds: 1_800_000_100
    });
    await service.authenticateNakamaUser({
      gameId: "lumarush",
      nakamaUserId: "secondary",
      nowSeconds: 1_800_000_101
    });
    const codeResult = await service.createMergeCodeForProfile({
      primaryProfileId: "primary"
    });
    assert.ok(codeResult.mergeCode);
    const merged = await service.redeemMergeCodeForProfile({
      secondaryProfileId: "secondary",
      mergeCode: codeResult.mergeCode
    });
    assert.equal(merged.primaryProfileId, "primary");
    assert.equal(merged.secondaryProfileId, "secondary");
  });

  it("authenticates crazygames token", async () => {
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
  });

  it("upgrades new email link via magic link completion", async () => {
    const service = createIdentityGatewayService({
      magicLinkBaseUrl: "https://terapixel.games/auth/magic-link"
    });
    const token = await service.identityStore.createMagicLinkToken(
      "new@example.com",
      "nk_a",
      { ttlSeconds: 900, nowSeconds: 1_800_000_000 }
    );
    const result = await service.completeMagicLinkForProfile({
      profileId: "nk_a",
      token: token.token,
      nowSeconds: 1_800_000_001
    });
    assert.equal(result.status, "upgraded");
  });

  it("merges when email is linked to another profile", async () => {
    const service = createIdentityGatewayService({
      magicLinkBaseUrl: "https://terapixel.games/auth/magic-link"
    });
    await service.identityStore.upsertEmailLink("linked@example.com", "nk_primary");
    const token = await service.identityStore.createMagicLinkToken(
      "linked@example.com",
      "nk_secondary",
      { ttlSeconds: 900, nowSeconds: 1_800_000_100 }
    );
    const result = await service.completeMagicLinkForProfile({
      profileId: "nk_secondary",
      token: token.token,
      nowSeconds: 1_800_000_101
    });
    assert.equal(result.status, "merged");
    assert.equal(result.primaryProfileId, "nk_primary");
  });
});
