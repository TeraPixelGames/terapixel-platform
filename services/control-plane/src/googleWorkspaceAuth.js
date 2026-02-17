import { createJwksKeyStore } from "../../../adapters/crazygames-auth/index.js";
import {
  JwtValidationError,
  parseJwt,
  validateJwtClaims,
  verifyRs256JwtSignature
} from "../../../packages/shared-utils/index.js";

const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";

export function createGoogleWorkspaceAuth(options = {}) {
  const clientId = String(options.clientId || "").trim();
  if (!clientId) {
    throw new Error("GOOGLE_OAUTH_CLIENT_ID is required");
  }
  const allowedDomains = normalizeList(options.allowedDomains || "");
  const bootstrapEmails = normalizeList(options.bootstrapEmails || "");
  const keyStore = createJwksKeyStore({
    jwksUrl: String(options.jwksUrl || GOOGLE_JWKS_URL),
    ttlSeconds: Number.isFinite(Number(options.jwksTtlSeconds))
      ? Math.max(60, Math.floor(Number(options.jwksTtlSeconds)))
      : 600
  });

  return {
    bootstrapEmails,
    verifyIdToken: async (token, nowSeconds) => {
      const parsed = parseJwt(String(token || ""));
      const keyId = String(parsed.header?.kid || "");
      if (!keyId) {
        throw new JwtValidationError("google token missing kid");
      }
      const publicKey = await keyStore.getPublicKey({
        kid: keyId,
        alg: parsed.header.alg
      });
      if (!publicKey) {
        throw new JwtValidationError("google key not found");
      }
      const verified = verifyRs256JwtSignature(String(token || ""), publicKey);
      validateJwtClaims(verified.payload, {
        issuer: GOOGLE_ISSUERS,
        audience: clientId,
        clockSkewSeconds: 15,
        nowSeconds
      });
      const email = normalizeEmail(verified.payload.email);
      const emailVerified = verified.payload.email_verified === true || String(verified.payload.email_verified) === "true";
      if (!email || !emailVerified) {
        throw new JwtValidationError("google token missing verified email");
      }
      const hostDomain = String(verified.payload.hd || "").trim().toLowerCase();
      if (allowedDomains.length > 0 && (!hostDomain || !allowedDomains.includes(hostDomain))) {
        throw new JwtValidationError("workspace domain is not allowed");
      }
      return {
        googleSub: String(verified.payload.sub || "").trim(),
        email,
        displayName: String(verified.payload.name || verified.payload.email || "").trim(),
        hostDomain
      };
    }
  };
}

function normalizeList(value) {
  if (Array.isArray(value)) {
    return value.map((it) => String(it || "").trim().toLowerCase()).filter(Boolean);
  }
  return String(value || "")
    .split(",")
    .map((it) => it.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}
