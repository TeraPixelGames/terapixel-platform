export function createNoopRuntimeConfigProvider() {
  return {
    async getRuntimeConfig() {
      return null;
    },
    async close() {}
  };
}

export async function createRuntimeConfigProvider(options = {}) {
  const mode = String(options.mode || "none").trim().toLowerCase();
  if (mode === "postgres") {
    return createPostgresRuntimeConfigProvider(options);
  }
  if (mode === "http") {
    return createHttpRuntimeConfigProvider(options);
  }
  return createNoopRuntimeConfigProvider();
}

async function createPostgresRuntimeConfigProvider(options = {}) {
  const databaseUrl = String(options.databaseUrl || "").trim();
  if (!databaseUrl) {
    throw new Error("platform runtime config postgres mode requires databaseUrl");
  }
  const environment = normalizeEnvironment(options.environment || "prod");
  const cacheTtlSeconds = normalizeCacheTtl(options.cacheTtlSeconds);
  const pgModule = await import("pg");
  const Pool = resolvePoolConstructor(pgModule);
  const pool = new Pool({
    connectionString: databaseUrl
  });
  const cache = new Map();
  return {
    async getRuntimeConfig(input = {}) {
      const gameId = normalizeGameId(input.gameId);
      const targetEnv = normalizeEnvironment(input.environment || environment);
      if (!gameId) {
        return null;
      }
      const cacheKey = `${gameId}:${targetEnv}`;
      const now = nowSeconds();
      const existing = cache.get(cacheKey);
      if (existing && existing.expiresAt > now) {
        return existing.value;
      }

      const result = await pool.query(
        `
        SELECT
          t.game_id,
          te.environment,
          te.metadata AS environment_metadata,
          tn.tenant_slug
        FROM cp_titles t
        JOIN cp_title_environments te ON te.title_id = t.title_id
        JOIN cp_tenants tn ON tn.tenant_id = t.tenant_id
        WHERE t.game_id = $1
          AND te.environment = $2
          AND t.status = 'active'
          AND te.status = 'active'
        LIMIT 1
      `,
        [gameId, targetEnv]
      );
      const row = result.rows[0];
      if (!row) {
        cache.set(cacheKey, {
          value: null,
          expiresAt: now + cacheTtlSeconds
        });
        return null;
      }

      const [featureFlagsResult, serviceEndpointsResult] = await Promise.all([
        pool.query(
          `
          SELECT ff.flags
          FROM cp_feature_flag_versions ff
          JOIN cp_title_environments te ON te.title_environment_id = ff.title_environment_id
          JOIN cp_titles t ON t.title_id = te.title_id
          WHERE t.game_id = $1
            AND te.environment = $2
            AND ff.status = 'active'
            AND (ff.effective_from IS NULL OR ff.effective_from <= NOW())
            AND (ff.effective_to IS NULL OR ff.effective_to > NOW())
          ORDER BY ff.version_number DESC
          LIMIT 1
        `,
          [gameId, targetEnv]
        ),
        pool.query(
          `
          SELECT se.service_key, se.base_url, se.healthcheck_url, se.metadata
          FROM cp_service_endpoints se
          JOIN cp_title_environments te ON te.title_environment_id = se.title_environment_id
          JOIN cp_titles t ON t.title_id = te.title_id
          WHERE t.game_id = $1
            AND te.environment = $2
            AND se.status = 'active'
          ORDER BY se.service_key ASC
        `,
          [gameId, targetEnv]
        )
      ]);

      const serviceEndpoints = {};
      for (const endpoint of serviceEndpointsResult.rows) {
        const serviceKey = String(endpoint.service_key || "").trim().toLowerCase();
        if (!serviceKey) {
          continue;
        }
        serviceEndpoints[serviceKey] = {
          baseUrl: String(endpoint.base_url || "").trim(),
          healthcheckUrl: String(endpoint.healthcheck_url || "").trim(),
          metadata: normalizeObject(endpoint.metadata)
        };
      }

      const config = {
        gameId,
        environment: targetEnv,
        tenantSlug: String(row.tenant_slug || "").trim(),
        environmentMetadata: normalizeObject(row.environment_metadata),
        featureFlags: normalizeObject(featureFlagsResult.rows[0]?.flags),
        serviceEndpoints
      };
      cache.set(cacheKey, {
        value: config,
        expiresAt: now + cacheTtlSeconds
      });
      return config;
    },
    async close() {
      await pool.end();
    }
  };
}

function createHttpRuntimeConfigProvider(options = {}) {
  const serviceUrl = String(options.serviceUrl || "").trim();
  if (!serviceUrl) {
    throw new Error("platform runtime config http mode requires serviceUrl");
  }
  const environment = normalizeEnvironment(options.environment || "prod");
  const internalKey = String(options.internalKey || "").trim();
  const cacheTtlSeconds = normalizeCacheTtl(options.cacheTtlSeconds);
  const cache = new Map();
  return {
    async getRuntimeConfig(input = {}) {
      const gameId = normalizeGameId(input.gameId);
      const targetEnv = normalizeEnvironment(input.environment || environment);
      if (!gameId) {
        return null;
      }
      const cacheKey = `${gameId}:${targetEnv}`;
      const now = nowSeconds();
      const existing = cache.get(cacheKey);
      if (existing && existing.expiresAt > now) {
        return existing.value;
      }
      const url = new URL("/v1/internal/runtime/identity-config", serviceUrl);
      url.searchParams.set("game_id", gameId);
      url.searchParams.set("environment", targetEnv);
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "x-admin-key": internalKey
        }
      });
      if (response.status === 404) {
        cache.set(cacheKey, {
          value: null,
          expiresAt: now + cacheTtlSeconds
        });
        return null;
      }
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`platform runtime config fetch failed (${response.status}): ${body}`);
      }
      const payload = await response.json();
      const config =
        payload?.config && typeof payload.config === "object" ? payload.config : null;
      cache.set(cacheKey, {
        value: config,
        expiresAt: now + cacheTtlSeconds
      });
      return config;
    },
    async close() {}
  };
}

function normalizeObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value;
}

function normalizeGameId(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeEnvironment(value) {
  const env = String(value || "").trim().toLowerCase();
  if (!env) {
    return "prod";
  }
  if (env === "staging" || env === "prod") {
    return env;
  }
  throw new Error("environment must be staging or prod");
}

function normalizeCacheTtl(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 15;
  }
  return Math.max(5, Math.floor(parsed));
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function resolvePoolConstructor(pgModule) {
  const Pool =
    pgModule?.Pool ||
    pgModule?.default?.Pool ||
    (typeof pgModule?.default === "function" ? pgModule.default : null);
  if (typeof Pool !== "function") {
    throw new Error("pg Pool constructor is unavailable");
  }
  return Pool;
}
