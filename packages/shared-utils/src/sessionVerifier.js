import {
  JwtValidationError,
  parseJwt,
  validateJwtClaims,
  verifyRs256JwtSignature
} from "./jwt.js";
import { verifySessionToken } from "./sessionToken.js";

export function createSessionTokenVerifier(options = {}) {
  const defaultIssuer = normalizeOptional(options.issuer);
  const defaultAudience = normalizeOptional(options.audience);
  const defaultClockSkewSeconds = normalizeInt(options.clockSkewSeconds, 10);
  const hsSecret = String(options.hsSecret || options.secret || "").trim();
  const rsPublicKey = String(options.publicKey || options.rsPublicKey || "").trim();
  const jwksKeyStore = options.jwksKeyStore || null;
  const allowLegacyHmac = options.allowLegacyHmac !== false;
  return {
    verify: async (token, verifyOptions = {}) => {
      const parsed = parseJwt(String(token || ""));
      const alg = String(parsed.header?.alg || "").trim().toUpperCase();
      const issuer = normalizeOptional(verifyOptions.issuer ?? defaultIssuer);
      const audience = normalizeOptional(verifyOptions.audience ?? defaultAudience);
      const clockSkewSeconds = normalizeInt(
        verifyOptions.clockSkewSeconds ?? defaultClockSkewSeconds,
        10
      );
      const nowSeconds = Number.isFinite(Number(verifyOptions.nowSeconds))
        ? Math.floor(Number(verifyOptions.nowSeconds))
        : undefined;
      const requireSubject = verifyOptions.requireSubject === true;

      if (alg === "HS256") {
        if (!allowLegacyHmac) {
          throw new JwtValidationError("legacy hs256 sessions are disabled");
        }
        if (!hsSecret) {
          throw new JwtValidationError("session secret is not configured");
        }
        return verifySessionToken(token, hsSecret, {
          issuer,
          audience,
          clockSkewSeconds,
          nowSeconds,
          requireSubject
        });
      }

      if (alg !== "RS256") {
        throw new JwtValidationError(`unsupported jwt alg '${alg}'`);
      }

      const publicKey = await resolvePublicKey({
        parsed,
        explicitPublicKey: rsPublicKey,
        jwksKeyStore
      });
      const verified = verifyRs256JwtSignature(token, publicKey);
      validateJwtClaims(verified.payload, {
        issuer,
        audience,
        clockSkewSeconds,
        nowSeconds
      });
      if (requireSubject && !String(verified.payload?.sub || "").trim()) {
        throw new JwtValidationError("session token missing sub");
      }
      return verified.payload;
    }
  };
}

async function resolvePublicKey(input) {
  if (input.explicitPublicKey) {
    return input.explicitPublicKey;
  }
  if (!input.jwksKeyStore || typeof input.jwksKeyStore.getPublicKey !== "function") {
    throw new JwtValidationError("session jwks keystore is not configured");
  }
  const kid = String(input.parsed?.header?.kid || "").trim();
  if (!kid) {
    throw new JwtValidationError("session token missing kid");
  }
  const publicKey = await input.jwksKeyStore.getPublicKey({
    kid,
    alg: "RS256"
  });
  if (!publicKey) {
    throw new JwtValidationError("session verification key not found");
  }
  return String(publicKey);
}

function normalizeOptional(value) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  return value;
}

function normalizeInt(value, fallback) {
  if (Number.isFinite(Number(value))) {
    return Math.floor(Number(value));
  }
  return fallback;
}
