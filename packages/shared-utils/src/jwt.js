import crypto from "node:crypto";
import { decodeBase64Url } from "./base64url.js";

export class JwtValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "JwtValidationError";
  }
}

export function parseJwt(token) {
  if (typeof token !== "string") {
    throw new JwtValidationError("token must be a string");
  }
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new JwtValidationError("token must have three parts");
  }
  const [headerPart, payloadPart, signaturePart] = parts;
  let header;
  let payload;
  try {
    header = JSON.parse(decodeBase64Url(headerPart).toString("utf8"));
    payload = JSON.parse(decodeBase64Url(payloadPart).toString("utf8"));
  } catch (_err) {
    throw new JwtValidationError("token contains invalid JSON");
  }
  if (!signaturePart) {
    throw new JwtValidationError("token signature part is empty");
  }
  return {
    headerPart,
    payloadPart,
    signaturePart,
    header,
    payload,
    signingInput: `${headerPart}.${payloadPart}`
  };
}

export function verifyRs256JwtSignature(token, publicKey) {
  const parsed = parseJwt(token);
  const alg = String(parsed.header?.alg || "");
  if (alg !== "RS256") {
    throw new JwtValidationError(`unsupported jwt alg '${alg}'`);
  }
  const verify = crypto.createVerify("RSA-SHA256");
  verify.update(parsed.signingInput);
  verify.end();
  const signature = decodeBase64Url(parsed.signaturePart);
  const ok = verify.verify(publicKey, signature);
  if (!ok) {
    throw new JwtValidationError("jwt signature verification failed");
  }
  return parsed;
}

export function validateJwtClaims(payload, options = {}) {
  const nowSeconds =
    Number.isFinite(options.nowSeconds) && options.nowSeconds > 0
      ? Math.floor(options.nowSeconds)
      : Math.floor(Date.now() / 1000);
  const skew = Number.isFinite(options.clockSkewSeconds)
    ? Math.max(0, Math.floor(options.clockSkewSeconds))
    : 0;

  validateIssuer(payload, options.issuer);
  validateAudience(payload, options.audience);
  validateExpiry(payload, nowSeconds, skew);
  validateNotBefore(payload, nowSeconds, skew);

  return payload;
}

function validateIssuer(payload, expectedIssuer) {
  if (!expectedIssuer) {
    return;
  }
  const issuers = Array.isArray(expectedIssuer)
    ? expectedIssuer.map((it) => String(it))
    : [String(expectedIssuer)];
  const actual = String(payload.iss || "");
  if (!issuers.includes(actual)) {
    throw new JwtValidationError("jwt issuer mismatch");
  }
}

function validateAudience(payload, expectedAudience) {
  if (!expectedAudience) {
    return;
  }
  const expected = Array.isArray(expectedAudience)
    ? expectedAudience.map((it) => String(it))
    : [String(expectedAudience)];

  const actualAud = payload.aud;
  const actual = Array.isArray(actualAud)
    ? actualAud.map((it) => String(it))
    : [String(actualAud || "")];

  const hit = expected.some((aud) => actual.includes(aud));
  if (!hit) {
    throw new JwtValidationError("jwt audience mismatch");
  }
}

function validateExpiry(payload, nowSeconds, skew) {
  if (payload.exp === undefined) {
    return;
  }
  const exp = Number(payload.exp);
  if (!Number.isFinite(exp)) {
    throw new JwtValidationError("jwt exp claim is invalid");
  }
  if (nowSeconds - skew >= exp) {
    throw new JwtValidationError("jwt is expired");
  }
}

function validateNotBefore(payload, nowSeconds, skew) {
  if (payload.nbf === undefined) {
    return;
  }
  const nbf = Number(payload.nbf);
  if (!Number.isFinite(nbf)) {
    throw new JwtValidationError("jwt nbf claim is invalid");
  }
  if (nowSeconds + skew < nbf) {
    throw new JwtValidationError("jwt is not yet valid");
  }
}
