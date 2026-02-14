import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { verifyCrazyGamesToken } from "../adapters/crazygames-auth/index.js";
import {
  createSignedJwt,
  createStaticKeyStore,
  generateRsaKeyPair
} from "../tools/test-helpers/jwtTestUtils.js";

describe("crazygames auth adapter", () => {
  it("verifies token and normalizes identity", async () => {
    const { privateKey, publicKey } = generateRsaKeyPair();
    const now = 1_800_000_000;
    const token = createSignedJwt(
      {
        userId: "cg_abc123",
        username: "Player One",
        iss: "https://auth.crazygames.com",
        aud: "lumarush",
        iat: now - 5,
        exp: now + 60
      },
      { privateKey, kid: "cg-key-1" }
    );
    const keyStore = createStaticKeyStore(publicKey, "cg-key-1");

    const result = await verifyCrazyGamesToken({
      token,
      keyStore,
      expectedIssuer: "https://auth.crazygames.com",
      expectedAudience: "lumarush",
      nowSeconds: now
    });

    assert.equal(result.provider, "crazygames");
    assert.equal(result.providerUserId, "cg_abc123");
    assert.equal(result.displayName, "Player One");
  });

  it("rejects token when key is missing", async () => {
    const { privateKey, publicKey } = generateRsaKeyPair();
    const now = 1_800_000_000;
    const token = createSignedJwt(
      {
        sub: "u1",
        iss: "https://auth.crazygames.com",
        aud: "lumarush",
        exp: now + 60
      },
      { privateKey, kid: "cg-key-2" }
    );
    const keyStore = createStaticKeyStore(publicKey, "different-key");

    await assert.rejects(
      () =>
        verifyCrazyGamesToken({
          token,
          keyStore,
          expectedIssuer: "https://auth.crazygames.com",
          expectedAudience: "lumarush",
          nowSeconds: now
        }),
      /no public key found/
    );
  });
});
