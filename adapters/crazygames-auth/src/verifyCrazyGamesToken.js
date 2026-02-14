import {
  JwtValidationError,
  parseJwt,
  validateJwtClaims,
  verifyRs256JwtSignature
} from "../../../packages/shared-utils/index.js";

export async function verifyCrazyGamesToken(input) {
  if (!input || typeof input !== "object") {
    throw new JwtValidationError("verifyCrazyGamesToken input is required");
  }
  const token = String(input.token || "");
  const keyStore = input.keyStore;
  if (!token) {
    throw new JwtValidationError("crazygames token is required");
  }
  if (!keyStore || typeof keyStore.getPublicKey !== "function") {
    throw new JwtValidationError("keyStore.getPublicKey is required");
  }

  const parsed = parseJwt(token);
  const keyId = String(parsed.header?.kid || "");
  if (!keyId) {
    throw new JwtValidationError("crazygames token is missing kid header");
  }

  const publicKey = await keyStore.getPublicKey({
    kid: keyId,
    alg: parsed.header.alg
  });
  if (!publicKey) {
    throw new JwtValidationError("no public key found for token kid");
  }

  const verified = verifyRs256JwtSignature(token, publicKey);
  validateJwtClaims(verified.payload, {
    issuer: input.expectedIssuer,
    audience: input.expectedAudience,
    clockSkewSeconds: input.clockSkewSeconds,
    nowSeconds: input.nowSeconds
  });

  const providerUserId = extractProviderUserId(verified.payload);
  if (!providerUserId) {
    throw new JwtValidationError("crazygames token missing provider user id");
  }

  return {
    provider: "crazygames",
    providerUserId,
    displayName: extractDisplayName(verified.payload),
    issuedAt: Number.isFinite(Number(verified.payload.iat))
      ? Number(verified.payload.iat)
      : null,
    expiresAt: Number.isFinite(Number(verified.payload.exp))
      ? Number(verified.payload.exp)
      : null,
    claims: verified.payload
  };
}

function extractProviderUserId(payload) {
  const userId =
    typeof payload.userId === "string" && payload.userId
      ? payload.userId
      : typeof payload.sub === "string"
        ? payload.sub
        : "";
  return userId;
}

function extractDisplayName(payload) {
  if (typeof payload.username === "string" && payload.username) {
    return payload.username;
  }
  if (typeof payload.name === "string" && payload.name) {
    return payload.name;
  }
  return "";
}
