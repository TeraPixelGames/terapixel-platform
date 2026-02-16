import path from "node:path";
import {
  JsonFileFlagStore,
  InMemoryFlagStore,
  createFeatureFlagsHttpServer,
  createFeatureFlagsService
} from "../index.js";

async function main() {
  const config = readConfig(process.env);
  const flagStore = createFlagStore(config);
  const service = createFeatureFlagsService({ flagStore });
  await applyBootstrapConfig(service, config.bootstrapJson);

  const server = createFeatureFlagsHttpServer({
    service,
    bodyLimitBytes: config.bodyLimitBytes,
    allowedOrigins: config.allowedOrigins,
    sessionSecret: config.sessionSecret,
    sessionIssuer: config.sessionIssuer,
    sessionAudience: config.sessionAudience,
    clockSkewSeconds: config.clockSkewSeconds,
    adminKey: config.adminKey,
    logger: console
  });

  const listenInfo = await server.listen(config.port, config.host);
  console.info(
    JSON.stringify({
      event: "feature_flags_started",
      host: listenInfo.host,
      port: listenInfo.port,
      store: config.storeType
    })
  );
  registerShutdownHandlers(server);
}

function readConfig(env) {
  const storeType = (env.FLAG_STORE_TYPE || "memory").toLowerCase();
  return {
    host: env.HOST || "0.0.0.0",
    port: parseIntWithDefault(env.PORT, 8070),
    bodyLimitBytes: parseIntWithDefault(env.BODY_LIMIT_BYTES, 64 * 1024),
    allowedOrigins: env.CORS_ALLOWED_ORIGINS || "",
    sessionSecret: String(env.SESSION_SECRET || ""),
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
    bootstrapJson: String(env.FEATURE_FLAGS_BOOTSTRAP_JSON || "")
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

function registerShutdownHandlers(server) {
  let closing = false;
  const shutdown = async (signal) => {
    if (closing) {
      return;
    }
    closing = true;
    console.info(JSON.stringify({ event: "shutdown", signal }));
    try {
      await server.close();
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

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
