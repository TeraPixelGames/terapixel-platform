import path from "node:path";
import { createJwksKeyStore } from "../../../adapters/crazygames-auth/index.js";
import {
  createRuntimeConfigProvider,
  createNoopRuntimeConfigProvider,
  resolveSessionLegacyPolicy
} from "../../../packages/shared-utils/index.js";
import {
  createTelemetryIngestHttpServer,
  createTelemetryIngestService,
  InMemoryTelemetrySink,
  JsonFileTelemetrySink
} from "../index.js";

async function main() {
  const config = readConfig(process.env);
  const sink = createSink(config);
  const runtimeConfigProvider = await createTelemetryRuntimeConfigProvider(config);
  const sessionJwksKeyStore = config.sessionJwksUrl
    ? createJwksKeyStore({
        jwksUrl: config.sessionJwksUrl,
        ttlSeconds: config.sessionJwksTtlSeconds
      })
    : null;
  const service = createTelemetryIngestService({
    sink,
    maxEventsPerRequest: config.maxEventsPerRequest,
    runtimeConfigProvider,
    runtimeConfigRequired: config.platformConfigStoreType !== "none"
  });
  const server = createTelemetryIngestHttpServer({
    service,
    bodyLimitBytes: config.bodyLimitBytes,
    allowedOrigins: config.allowedOrigins,
    requireSession: config.requireSession,
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
      event: "telemetry_ingest_started",
      host: listenInfo.host,
      port: listenInfo.port,
      require_session: config.requireSession,
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
  const storeType = (env.TELEMETRY_STORE_TYPE || "memory").toLowerCase();
  const requireSession = parseBooleanWithDefault(env.TELEMETRY_REQUIRE_SESSION, true);
  const sessionLegacyPolicy = resolveSessionLegacyPolicy(env, {
    defaultEnvironment: String(env.PLATFORM_CONFIG_ENVIRONMENT || env.DEPLOY_ENV || "prod")
  });
  const sessionSecret = String(env.SESSION_SECRET || "");
  const sessionPublicKey = String(env.SESSION_PUBLIC_KEY_PEM || "");
  const sessionJwksUrl = String(env.SESSION_JWKS_URL || "");
  if (requireSession && !sessionSecret && !sessionPublicKey && !sessionJwksUrl) {
    throw new Error(
      "missing required session verifier config: set SESSION_SECRET or SESSION_PUBLIC_KEY_PEM or SESSION_JWKS_URL"
    );
  }
  return {
    host: env.HOST || "0.0.0.0",
    port: parseIntWithDefault(env.PORT, 8100),
    bodyLimitBytes: parseIntWithDefault(env.BODY_LIMIT_BYTES, 256 * 1024),
    allowedOrigins: env.CORS_ALLOWED_ORIGINS || "",
    requireSession,
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
    maxEventsPerRequest: parseIntWithDefault(
      env.TELEMETRY_MAX_EVENTS_PER_REQUEST,
      100
    ),
    storeType: storeType === "file" ? "file" : "memory",
    filePath:
      env.TELEMETRY_FILE_PATH ||
      path.resolve(process.cwd(), "data", "telemetry-events.jsonl"),
    adminKey: String(env.INTERNAL_SERVICE_KEY || env.IDENTITY_ADMIN_KEY || ""),
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

function createSink(config) {
  if (config.storeType === "file") {
    return new JsonFileTelemetrySink({
      filePath: config.filePath
    });
  }
  return new InMemoryTelemetrySink();
}

function parseIntWithDefault(raw, fallback) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.floor(parsed);
}

function parseBooleanWithDefault(raw, fallback) {
  if (raw === undefined || raw === null || raw === "") {
    return fallback;
  }
  const normalized = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
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

async function createTelemetryRuntimeConfigProvider(config) {
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
