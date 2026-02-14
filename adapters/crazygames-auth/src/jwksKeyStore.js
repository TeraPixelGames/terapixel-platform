import { createPublicKey } from "node:crypto";

export function createJwksKeyStore(options = {}) {
  const jwksUrl = String(options.jwksUrl || "");
  if (!jwksUrl) {
    throw new Error("jwksUrl is required");
  }
  const ttlSeconds = normalizeTtl(options.ttlSeconds);
  const fetchImpl = options.fetchImpl || fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch implementation is required");
  }

  const state = {
    expiresAt: 0,
    byKid: new Map(),
    inflight: null
  };

  return {
    getPublicKey: async ({ kid }) => {
      if (!kid) {
        return null;
      }
      const now = nowSeconds();
      if (state.expiresAt <= now || !state.byKid.has(kid)) {
        await refreshKeys();
      }
      return state.byKid.get(kid) || null;
    }
  };

  async function refreshKeys() {
    if (state.inflight) {
      await state.inflight;
      return;
    }
    state.inflight = (async () => {
      const response = await fetchImpl(jwksUrl, {
        method: "GET",
        headers: {
          accept: "application/json"
        }
      });
      if (!response.ok) {
        throw new Error(`jwks request failed with status ${response.status}`);
      }
      const payload = await response.json();
      const keys = Array.isArray(payload?.keys) ? payload.keys : [];
      const mapped = new Map();
      for (const jwk of keys) {
        const kid = String(jwk?.kid || "");
        const kty = String(jwk?.kty || "");
        const alg = String(jwk?.alg || "");
        if (!kid || kty !== "RSA") {
          continue;
        }
        if (alg && alg !== "RS256") {
          continue;
        }
        const publicKey = createPublicKey({
          key: jwk,
          format: "jwk"
        })
          .export({ type: "spki", format: "pem" })
          .toString("utf8");
        mapped.set(kid, publicKey);
      }

      state.byKid = mapped;
      state.expiresAt = nowSeconds() + ttlSeconds;
    })();

    try {
      await state.inflight;
    } finally {
      state.inflight = null;
    }
  }
}

function normalizeTtl(ttlSeconds) {
  if (Number.isFinite(Number(ttlSeconds)) && Number(ttlSeconds) > 0) {
    return Math.max(30, Math.floor(Number(ttlSeconds)));
  }
  return 10 * 60;
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}
