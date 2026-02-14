import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  JwtValidationError,
  parseJwt,
  validateJwtClaims,
  verifyRs256JwtSignature
} from "../packages/shared-utils/index.js";
import {
  createSignedJwt,
  generateRsaKeyPair
} from "../tools/test-helpers/jwtTestUtils.js";

describe("shared-utils jwt", () => {
  it("verifies RS256 signature and claims", () => {
    const { privateKey, publicKey } = generateRsaKeyPair();
    const now = 1_800_000_000;
    const token = createSignedJwt(
      {
        sub: "u123",
        iss: "https://auth.crazygames.com",
        aud: "lumarush",
        iat: now - 10,
        nbf: now - 5,
        exp: now + 300
      },
      { privateKey }
    );

    const parsed = verifyRs256JwtSignature(token, publicKey);
    assert.equal(parsed.payload.sub, "u123");
    const claims = validateJwtClaims(parsed.payload, {
      issuer: "https://auth.crazygames.com",
      audience: "lumarush",
      nowSeconds: now,
      clockSkewSeconds: 10
    });
    assert.equal(claims.aud, "lumarush");
  });

  it("rejects invalid audience", () => {
    const { privateKey, publicKey } = generateRsaKeyPair();
    const now = 1_800_000_000;
    const token = createSignedJwt(
      {
        sub: "u123",
        iss: "https://auth.crazygames.com",
        aud: "other-game",
        exp: now + 60
      },
      { privateKey }
    );
    const parsed = verifyRs256JwtSignature(token, publicKey);
    assert.throws(
      () =>
        validateJwtClaims(parsed.payload, {
          issuer: "https://auth.crazygames.com",
          audience: "lumarush",
          nowSeconds: now
        }),
      JwtValidationError
    );
  });

  it("rejects expired token", () => {
    const { privateKey, publicKey } = generateRsaKeyPair();
    const now = 1_800_000_000;
    const token = createSignedJwt(
      {
        sub: "u123",
        iss: "https://auth.crazygames.com",
        aud: "lumarush",
        exp: now - 1
      },
      { privateKey }
    );
    const parsed = verifyRs256JwtSignature(token, publicKey);
    assert.throws(
      () => validateJwtClaims(parsed.payload, { nowSeconds: now }),
      JwtValidationError
    );
  });

  it("rejects unsupported alg", () => {
    const { privateKey, publicKey } = generateRsaKeyPair();
    const token = createSignedJwt(
      {
        sub: "u123"
      },
      { privateKey, header: { alg: "HS256" } }
    );
    assert.throws(
      () => verifyRs256JwtSignature(token, publicKey),
      /unsupported jwt alg/
    );
  });

  it("parses jwt structure", () => {
    const { privateKey } = generateRsaKeyPair();
    const token = createSignedJwt(
      {
        sub: "u123"
      },
      { privateKey }
    );
    const parsed = parseJwt(token);
    assert.equal(parsed.header.typ, "JWT");
    assert.equal(parsed.payload.sub, "u123");
  });
});
