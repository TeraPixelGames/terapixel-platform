import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createSecretCrypto } from "../packages/shared-utils/index.js";

describe("secret crypto", () => {
  it("round-trips encrypted values", () => {
    const key = Buffer.alloc(32, 7).toString("base64");
    const crypto = createSecretCrypto({ encryptionKey: key });
    const encrypted = crypto.encrypt("super-secret-value");
    assert.ok(encrypted.startsWith("v1:"));
    const decrypted = crypto.decrypt(encrypted);
    assert.equal(decrypted, "super-secret-value");
  });

  it("passes through plain values during decrypt", () => {
    const crypto = createSecretCrypto({});
    assert.equal(crypto.decrypt("plain-text"), "plain-text");
  });
});
