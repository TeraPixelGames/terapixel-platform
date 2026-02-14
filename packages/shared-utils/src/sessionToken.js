import crypto from "node:crypto";
import { decodeBase64Url, encodeBase64Url } from "./base64url.js";
import { JwtValidationError, parseJwt, validateJwtClaims } from "./jwt.js";

const HS256_ALG = "HS256";

export function createSessionToken(payload, secret, options = {}) {
  validateSecret(secret);
  if (!payload || typeof payload !== "object") {
    throw new JwtValidationError("session payload must be an object");
  }

  const now = normalizeNow(options.nowSeconds);
  const ttl = normalizeTtl(options.ttlSeconds);
  const exp = now + ttl;
  const header = {
    alg: HS256_ALG,
    typ: "JWT",
    ...(options.header || {})
  };
  const claims = {
    ...payload,
    iat: now,
    exp
  };
  if (options.issuer) {
    claims.iss = String(options.issuer);
  }
  if (options.audience) {
    claims.aud = options.audience;
  }

  const headerPart = encodeBase64Url(Buffer.from(JSON.stringify(header)));
  const payloadPart = encodeBase64Url(Buffer.from(JSON.stringify(claims)));
  const signingInput = `${headerPart}.${payloadPart}`;
  const signature = signHs256(signingInput, secret);
  return `${signingInput}.${signature}`;
}

export function verifySessionToken(token, secret, options = {}) {
  validateSecret(secret);
  const parsed = parseJwt(token);
  const alg = String(parsed.header?.alg || "");
  if (alg !== HS256_ALG) {
    throw new JwtValidationError(`unsupported jwt alg '${alg}'`);
  }

  const expectedSignature = signHs256(parsed.signingInput, secret);
  if (!timingSafeBase64UrlEqual(parsed.signaturePart, expectedSignature)) {
    throw new JwtValidationError("jwt signature verification failed");
  }

  validateJwtClaims(parsed.payload, {
    issuer: options.issuer,
    audience: options.audience,
    clockSkewSeconds: options.clockSkewSeconds,
    nowSeconds: options.nowSeconds
  });

  return parsed.payload;
}

function signHs256(signingInput, secret) {
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(signingInput);
  return encodeBase64Url(hmac.digest());
}

function timingSafeBase64UrlEqual(a, b) {
  const ab = decodeBase64Url(a);
  const bb = decodeBase64Url(b);
  if (ab.length !== bb.length) {
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

function normalizeNow(nowSeconds) {
  if (Number.isFinite(Number(nowSeconds)) && Number(nowSeconds) > 0) {
    return Math.floor(Number(nowSeconds));
  }
  return Math.floor(Date.now() / 1000);
}

function normalizeTtl(ttlSeconds) {
  if (Number.isFinite(Number(ttlSeconds)) && Number(ttlSeconds) > 0) {
    return Math.floor(Number(ttlSeconds));
  }
  return 60 * 60;
}

function validateSecret(secret) {
  if (typeof secret !== "string" || secret.length < 16) {
    throw new JwtValidationError(
      "session secret must be a string with length >= 16"
    );
  }
}
