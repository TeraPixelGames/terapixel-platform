import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  JwtValidationError,
  createSessionToken,
  verifySessionToken
} from "../packages/shared-utils/index.js";

describe("session token", () => {
  it("creates and verifies HS256 session token", () => {
    const secret = "supersecret-supersecret";
    const now = 1_800_000_000;
    const token = createSessionToken(
      { sub: "player_1", scope: "player_session" },
      secret,
      {
        issuer: "terapixel.identity",
        audience: "terapixel.game",
        ttlSeconds: 120,
        nowSeconds: now
      }
    );

    const claims = verifySessionToken(token, secret, {
      issuer: "terapixel.identity",
      audience: "terapixel.game",
      nowSeconds: now + 60
    });

    assert.equal(claims.sub, "player_1");
    assert.equal(claims.scope, "player_session");
    assert.equal(claims.exp, now + 120);
  });

  it("rejects invalid signature", () => {
    const token = createSessionToken(
      { sub: "player_1" },
      "supersecret-supersecret",
      { nowSeconds: 1_800_000_000 }
    );
    assert.throws(
      () => verifySessionToken(token, "wrongsecret-wrongsecret"),
      JwtValidationError
    );
  });
});
