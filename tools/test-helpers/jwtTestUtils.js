import crypto from "node:crypto";
import { encodeBase64Url } from "../../packages/shared-utils/index.js";

export function generateRsaKeyPair() {
  return crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048
  });
}

export function createSignedJwt(payload, options = {}) {
  const header = {
    alg: options.alg || "RS256",
    typ: "JWT",
    kid: options.kid || "test-key-1",
    ...(options.header || {})
  };
  const privateKey = options.privateKey;
  if (!privateKey) {
    throw new Error("createSignedJwt requires privateKey");
  }

  const headerPart = encodeBase64Url(Buffer.from(JSON.stringify(header)));
  const payloadPart = encodeBase64Url(Buffer.from(JSON.stringify(payload)));
  const input = `${headerPart}.${payloadPart}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(input);
  signer.end();
  const signaturePart = encodeBase64Url(signer.sign(privateKey));
  return `${input}.${signaturePart}`;
}

export function createStaticKeyStore(publicKey, kid = "test-key-1") {
  return {
    getPublicKey: async ({ kid: lookupKid }) => {
      if (lookupKid !== kid) {
        return null;
      }
      return publicKey;
    }
  };
}
