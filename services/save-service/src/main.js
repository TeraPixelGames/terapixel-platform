import path from "node:path";
import {
  createSaveHttpServer,
  createSaveService,
  InMemorySaveStore,
  JsonFileSaveStore,
  PostgresSaveStore
} from "../index.js";

async function main() {
  const config = readConfig(process.env);
  const saveStore = await createSaveStore(config);
  const service = createSaveService({ saveStore });
  const server = createSaveHttpServer({
    service,
    bodyLimitBytes: config.bodyLimitBytes,
    allowedOrigins: config.allowedOrigins,
    sessionSecret: config.sessionSecret,
    sessionIssuer: config.sessionIssuer,
    sessionAudience: config.sessionAudience,
    clockSkewSeconds: config.clockSkewSeconds,
    logger: console
  });
  const listenInfo = await server.listen(config.port, config.host);
  console.info(
    JSON.stringify({
      event: "save_service_started",
      host: listenInfo.host,
      port: listenInfo.port,
      store: config.saveStoreType
    })
  );
  registerShutdownHandlers(server, saveStore);
}

async function createSaveStore(config) {
  if (config.saveStoreType === "postgres") {
    const pool = await createPostgresPool(config.databaseUrl);
    const store = new PostgresSaveStore({
      pool,
      tableName: config.saveStoreTable
    });
    await store.init();
    return store;
  }
  if (config.saveStoreType === "file") {
    return new JsonFileSaveStore({
      filePath: config.saveStoreFilePath
    });
  }
  return new InMemorySaveStore();
}

function readConfig(env) {
  const saveStoreType = (env.SAVE_STORE_TYPE || "memory").toLowerCase();
  return {
    host: env.HOST || "0.0.0.0",
    port: parseIntWithDefault(env.PORT, 8090),
    bodyLimitBytes: parseIntWithDefault(env.BODY_LIMIT_BYTES, 256 * 1024),
    sessionSecret: requiredEnv(env, "SESSION_SECRET"),
    allowedOrigins: env.CORS_ALLOWED_ORIGINS || "",
    sessionIssuer: env.SESSION_ISSUER || "terapixel.identity",
    sessionAudience: env.SESSION_AUDIENCE || "terapixel.game",
    clockSkewSeconds: parseIntWithDefault(env.CLOCK_SKEW_SECONDS, 10),
    saveStoreType:
      saveStoreType === "postgres"
        ? "postgres"
        : saveStoreType === "file"
          ? "file"
          : "memory",
    saveStoreFilePath:
      env.SAVE_STORE_FILE_PATH ||
      path.resolve(process.cwd(), "data", "save-service.json"),
    saveStoreTable: env.SAVE_STORE_TABLE || "save_envelopes",
    databaseUrl: env.DATABASE_URL || ""
  };
}

function requiredEnv(env, key) {
  const value = String(env[key] || "");
  if (!value) {
    throw new Error(`missing required env ${key}`);
  }
  return value;
}

function parseIntWithDefault(raw, fallback) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.floor(parsed);
}

function registerShutdownHandlers(server, saveStore) {
  let closing = false;
  const shutdown = async (signal) => {
    if (closing) {
      return;
    }
    closing = true;
    console.info(JSON.stringify({ event: "shutdown", signal }));
    try {
      await server.close();
      if (saveStore && typeof saveStore.close === "function") {
        await saveStore.close();
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

async function createPostgresPool(databaseUrl) {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for SAVE_STORE_TYPE=postgres");
  }
  let pgModule;
  try {
    pgModule = await import("pg");
  } catch (error) {
    throw new Error(
      "pg dependency is missing; install with `npm install pg` for postgres store"
    );
  }
  const { Pool } = pgModule;
  return new Pool({
    connectionString: databaseUrl
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
