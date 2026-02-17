import crypto from "node:crypto";

const SECRET_PREFIX = "v1";

export function createSecretCrypto(options = {}) {
  const normalizedKey = normalizeKey(options.key || options.encryptionKey || "");
  return {
    enabled: !!normalizedKey,
    encrypt: (plaintext) => {
      const input = String(plaintext || "");
      if (!input) {
        return "";
      }
      if (!normalizedKey) {
        throw new Error("secret encryption key is not configured");
      }
      return encryptValue(input, normalizedKey);
    },
    decrypt: (ciphertextOrPlain) => {
      const value = String(ciphertextOrPlain || "");
      if (!value) {
        return "";
      }
      if (!value.startsWith(`${SECRET_PREFIX}:`)) {
        return value;
      }
      if (!normalizedKey) {
        throw new Error("secret encryption key is not configured");
      }
      return decryptValue(value, normalizedKey);
    }
  };
}

function normalizeKey(raw) {
  const value = String(raw || "").trim();
  if (!value) {
    return null;
  }
  const base64Key = tryDecodeBase64(value);
  if (base64Key && base64Key.length === 32) {
    return base64Key;
  }
  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    return Buffer.from(value, "hex");
  }
  throw new Error("secret encryption key must be 32-byte base64 or 64-char hex");
}

function tryDecodeBase64(value) {
  try {
    return Buffer.from(value, "base64");
  } catch (_error) {
    return null;
  }
}

function encryptValue(plaintext, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();
  return `${SECRET_PREFIX}:${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
}

function decryptValue(encoded, key) {
  const parts = String(encoded || "").split(":");
  if (parts.length !== 4 || parts[0] !== SECRET_PREFIX) {
    throw new Error("invalid encrypted secret format");
  }
  const iv = Buffer.from(parts[1], "base64");
  const tag = Buffer.from(parts[2], "base64");
  const ciphertext = Buffer.from(parts[3], "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
