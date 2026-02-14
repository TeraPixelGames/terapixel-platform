import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createJwksKeyStore } from "../adapters/crazygames-auth/index.js";

describe("jwks key store", () => {
  it("loads and resolves public keys by kid", async () => {
    const { publicKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048
    });
    const jwk = publicKey.export({ format: "jwk" });
    jwk.kid = "kid-1";
    jwk.alg = "RS256";

    let fetchCount = 0;
    const store = createJwksKeyStore({
      jwksUrl: "https://example.test/jwks",
      ttlSeconds: 600,
      fetchImpl: async () => {
        fetchCount += 1;
        return {
          ok: true,
          async json() {
            return {
              keys: [jwk]
            };
          }
        };
      }
    });

    const key1 = await store.getPublicKey({ kid: "kid-1" });
    const key2 = await store.getPublicKey({ kid: "kid-1" });
    assert.ok(typeof key1 === "string" && key1.includes("BEGIN PUBLIC KEY"));
    assert.equal(key1, key2);
    assert.equal(fetchCount, 1);
  });

  it("returns null when kid is unknown", async () => {
    const store = createJwksKeyStore({
      jwksUrl: "https://example.test/jwks",
      fetchImpl: async () => ({
        ok: true,
        async json() {
          return { keys: [] };
        }
      })
    });
    const key = await store.getPublicKey({ kid: "missing" });
    assert.equal(key, null);
  });
});
