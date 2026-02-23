import path from "node:path";
import { createJwksKeyStore } from "../../../adapters/crazygames-auth/index.js";
import {
  createRuntimeConfigProvider,
  createNoopRuntimeConfigProvider,
  resolveSessionLegacyPolicy
} from "../../../packages/shared-utils/index.js";
import {
  JsonFileFlagStore,
  InMemoryFlagStore,
  createFeatureFlagsHttpServer,
  createFeatureFlagsService
} from "../index.js";

async function main() {
  const config = readConfig(process.env);
  const flagStore = createFlagStore(config);
  const runtimeConfigProvider = await createFlagsRuntimeConfigProvider(config);
  const sessionJwksKeyStore = config.sessionJwksUrl
    ? createJwksKeyStore({
        jwksUrl: config.sessionJwksUrl,
        ttlSeconds: config.sessionJwksTtlSeconds
      })
    : null;
  const service = createFeatureFlagsService({
    flagStore,
    runtimeConfigProvider,
    runtimeConfigRequired: config.platformConfigStoreType !== "none"
  });
  await applyBootstrapConfig(service, config.bootstrapJson);

  const server = createFeatureFlagsHttpServer({
    service,
    bodyLimitBytes: config.bodyLimitBytes,
    allowedOrigins: config.allowedOrigins,
    sessionSecret: config.sessionSecret,
    sessionPublicKey: config.sessionPublicKey,
    sessionJwksKeyStore,
    sessionIssuer: config.sessionIssuer,
    sessionAudience: config.sessionAudience,
    clockSkewSeconds: config.clockSkewSeconds,
    allowLegacySessionHmac: config.sessionAllowLegacyHs256,
    allowLegacyNakamaSubject: config.sessionAllowLegacyNakamaSubject,
    requireSessionSubject: config.sessionRequireSub,
    adminKey: config.adminKey,
    logger: console
  });

  const listenInfo = await server.listen(config.port, config.host);
  console.info(
    JSON.stringify({
      event: "feature_flags_started",
      host: listenInfo.host,
      port: listenInfo.port,
      store: config.storeType,
      platformConfigStoreType: config.platformConfigStoreType,
      session_policy_environment: config.sessionLegacyPolicy.environment,
      session_legacy_cutoff_utc: config.sessionLegacyPolicy.cutoffUtc,
      session_legacy_cutoff_reached: config.sessionLegacyPolicy.cutoffReached,
      session_allow_legacy_hs256: config.sessionAllowLegacyHs256,
      session_allow_legacy_nakama_subject: config.sessionAllowLegacyNakamaSubject,
      session_require_sub: config.sessionRequireSub
    })
  );
  registerShutdownHandlers(server, runtimeConfigProvider);
}

function readConfig(env) {
  const storeType = (env.FLAG_STORE_TYPE || "memory").toLowerCase();
  const sessionLegacyPolicy = resolveSessionLegacyPolicy(env, {
    defaultEnvironment: String(env.PLATFORM_CONFIG_ENVIRONMENT || env.DEPLOY_ENV || "prod")
  });
  const sessionSecret = String(env.SESSION_SECRET || "");
  const sessionPublicKey = String(env.SESSION_PUBLIC_KEY_PEM || "");
  const sessionJwksUrl = String(env.SESSION_JWKS_URL || "");
  if (!sessionSecret && !sessionPublicKey && !sessionJwksUrl) {
    throw new Error(
      "missing required session verifier config: set SESSION_SECRET or SESSION_PUBLIC_KEY_PEM or SESSION_JWKS_URL"
    );
  }
  return {
    host: env.HOST || "0.0.0.0",
    port: parseIntWithDefault(env.PORT, 8070),
    bodyLimitBytes: parseIntWithDefault(env.BODY_LIMIT_BYTES, 64 * 1024),
    allowedOrigins: env.CORS_ALLOWED_ORIGINS || "",
    sessionSecret,
    sessionPublicKey,
    sessionJwksUrl,
    sessionJwksTtlSeconds: parseIntWithDefault(env.SESSION_JWKS_TTL_SECONDS, 600),
    sessionAllowLegacyHs256: sessionLegacyPolicy.allowLegacyHs256,
    sessionAllowLegacyNakamaSubject: sessionLegacyPolicy.allowLegacyNakamaSubject,
    sessionRequireSub: sessionLegacyPolicy.requireSub,
    sessionIssuer: env.SESSION_ISSUER || "terapixel.identity",
    sessionAudience: env.SESSION_AUDIENCE || "terapixel.game",
    clockSkewSeconds: parseIntWithDefault(env.CLOCK_SKEW_SECONDS, 10),
    adminKey: String(
      env.INTERNAL_SERVICE_KEY || env.FEATURE_FLAGS_ADMIN_KEY || env.IDENTITY_ADMIN_KEY || ""
    ),
    storeType: storeType === "file" ? "file" : "memory",
    filePath:
      env.FLAG_STORE_FILE_PATH ||
      path.resolve(process.cwd(), "data", "feature-flags.json"),
    bootstrapJson: String(env.FEATURE_FLAGS_BOOTSTRAP_JSON || ""),
    databaseUrl: String(env.DATABASE_URL || ""),
    platformConfigStoreType: String(env.PLATFORM_CONFIG_STORE_TYPE || "none"),
    platformConfigServiceUrl: String(env.PLATFORM_CONFIG_SERVICE_URL || ""),
    platformConfigInternalKey: String(
      env.PLATFORM_CONFIG_INTERNAL_KEY ||
        env.INTERNAL_SERVICE_KEY ||
        env.IDENTITY_ADMIN_KEY ||
        ""
    ),
    platformConfigEnvironment: String(
      env.PLATFORM_CONFIG_ENVIRONMENT || env.DEPLOY_ENV || "prod"
    ),
    platformConfigCacheTtlSeconds: parseIntWithDefault(
      env.PLATFORM_CONFIG_CACHE_TTL_SECONDS,
      15
    ),
    sessionLegacyPolicy
  };
}

function createFlagStore(config) {
  if (config.storeType === "file") {
    return new JsonFileFlagStore({
      filePath: config.filePath
    });
  }
  return new InMemoryFlagStore();
}

async function applyBootstrapConfig(service, bootstrapJson) {
  if (!bootstrapJson) {
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(bootstrapJson);
  } catch (_error) {
    throw new Error("FEATURE_FLAGS_BOOTSTRAP_JSON is invalid JSON");
  }
  if (!parsed || typeof parsed !== "object") {
    return;
  }
  const games = parsed.games;
  if (!games || typeof games !== "object") {
    return;
  }
  for (const [gameId, gameConfig] of Object.entries(games)) {
    if (!gameId || !gameConfig || typeof gameConfig !== "object") {
      continue;
    }
    if (gameConfig.defaults && typeof gameConfig.defaults === "object") {
      await service.setGameDefaults({
        gameId,
        defaults: gameConfig.defaults
      });
    }
    if (gameConfig.profiles && typeof gameConfig.profiles === "object") {
      for (const [profileId, overrides] of Object.entries(gameConfig.profiles)) {
        if (!profileId || !overrides || typeof overrides !== "object") {
          continue;
        }
        await service.setProfileOverrides({
          gameId,
          profileId,
          overrides
        });
      }
    }
  }
}

function parseIntWithDefault(raw, fallback) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.floor(parsed);
}


function registerShutdownHandlers(server, runtimeConfigProvider) {
  let closing = false;
  const shutdown = async (signal) => {
    if (closing) {
      return;
    }
    closing = true;
    console.info(JSON.stringify({ event: "shutdown", signal }));
    try {
      await server.close();
      if (runtimeConfigProvider && typeof runtimeConfigProvider.close === "function") {
        await runtimeConfigProvider.close();
      }
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGTERM", () => {
    shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    shutdown("SIGINT");
  });
}

async function createFlagsRuntimeConfigProvider(config) {
  const mode = String(config.platformConfigStoreType || "none").trim().toLowerCase();
  if (mode === "none") {
    return createNoopRuntimeConfigProvider();
  }
  return createRuntimeConfigProvider({
    mode,
    databaseUrl: config.databaseUrl,
    serviceUrl: config.platformConfigServiceUrl,
    internalKey: config.platformConfigInternalKey,
    environment: config.platformConfigEnvironment,
    cacheTtlSeconds: config.platformConfigCacheTtlSeconds
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
