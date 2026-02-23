import crypto from "node:crypto";
import { decodeBase64Url, encodeBase64Url } from "./base64url.js";
import {
  JwtValidationError,
  parseJwt,
  validateJwtClaims,
  verifyRs256JwtSignature
} from "./jwt.js";

const HS256_ALG = "HS256";
const RS256_ALG = "RS256";

export function createSessionToken(payload, secretOrSigner, options = {}) {
  if (!payload || typeof payload !== "object") {
    throw new JwtValidationError("session payload must be an object");
  }

  const signer = normalizeSigner(secretOrSigner);
  const now = normalizeNow(options.nowSeconds);
  const ttl = normalizeTtl(options.ttlSeconds);
  const exp = now + ttl;
  const header = {
    alg: signer.alg,
    typ: "JWT",
    ...(signer.kid ? { kid: signer.kid } : {}),
    ...(options.header || {})
  };
  const claims = {
    ...payload,
    iat: now,
    exp,
    jti: String(payload.jti || "").trim() || crypto.randomUUID()
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
  const signature =
    signer.alg === HS256_ALG
      ? signHs256(signingInput, signer.secret)
      : signRs256(signingInput, signer.privateKey);
  return `${signingInput}.${signature}`;
}

export function verifySessionToken(token, secretOrVerifier, options = {}) {
  const verifier = normalizeVerifier(secretOrVerifier);
  const parsed = parseJwt(token);
  const alg = String(parsed.header?.alg || "");
  if (alg !== HS256_ALG && alg !== RS256_ALG) {
    throw new JwtValidationError(`unsupported jwt alg '${alg}'`);
  }
  if (alg === HS256_ALG) {
    if (!verifier.secret) {
      throw new JwtValidationError("session secret is not configured");
    }
    const expectedSignature = signHs256(parsed.signingInput, verifier.secret);
    if (!timingSafeBase64UrlEqual(parsed.signaturePart, expectedSignature)) {
      throw new JwtValidationError("jwt signature verification failed");
    }
  } else {
    if (!verifier.publicKey) {
      throw new JwtValidationError("session public key is not configured");
    }
    verifyRs256JwtSignature(token, verifier.publicKey);
  }

  validateJwtClaims(parsed.payload, {
    issuer: options.issuer,
    audience: options.audience,
    clockSkewSeconds: options.clockSkewSeconds,
    nowSeconds: options.nowSeconds
  });
  if (options.requireSubject === true && !String(parsed.payload?.sub || "").trim()) {
    throw new JwtValidationError("session token missing sub");
  }

  return parsed.payload;
}

function signHs256(signingInput, secret) {
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(signingInput);
  return encodeBase64Url(hmac.digest());
}

function signRs256(signingInput, privateKey) {
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  return encodeBase64Url(signer.sign(privateKey));
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

function normalizeSigner(secretOrSigner) {
  if (typeof secretOrSigner === "string") {
    validateSecret(secretOrSigner);
    return {
      alg: HS256_ALG,
      secret: secretOrSigner
    };
  }
  const input =
    secretOrSigner && typeof secretOrSigner === "object" ? secretOrSigner : {};
  const alg = String(input.alg || "").trim().toUpperCase() || HS256_ALG;
  if (alg === HS256_ALG) {
    const secret = String(input.secret || input.hsSecret || "").trim();
    validateSecret(secret);
    return {
      alg,
      secret,
      kid: String(input.kid || "").trim()
    };
  }
  if (alg === RS256_ALG) {
    const privateKey = String(input.privateKey || input.rsPrivateKey || "").trim();
    if (!privateKey) {
      throw new JwtValidationError("session private key is required for RS256");
    }
    return {
      alg,
      privateKey,
      kid: String(input.kid || input.keyId || "").trim()
    };
  }
  throw new JwtValidationError(`unsupported session alg '${alg}'`);
}

function normalizeVerifier(secretOrVerifier) {
  if (typeof secretOrVerifier === "string") {
    validateSecret(secretOrVerifier);
    return {
      secret: secretOrVerifier,
      publicKey: ""
    };
  }
  const input =
    secretOrVerifier && typeof secretOrVerifier === "object"
      ? secretOrVerifier
      : {};
  const secret = String(input.secret || input.hsSecret || "").trim();
  const publicKey = String(input.publicKey || input.rsPublicKey || "").trim();
  if (secret) {
    validateSecret(secret);
  }
  return { secret, publicKey };
}
