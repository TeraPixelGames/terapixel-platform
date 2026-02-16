import path from "node:path";
import {
  createIapHttpServer,
  createIapService,
  InMemoryIapStore,
  JsonFileIapStore,
  PostgresIapStore
} from "../index.js";

async function main() {
  const config = readConfig(process.env);
  const store = await createStore(config);
  const service = createIapService({
    store,
    providers: config.providers
  });
  const server = createIapHttpServer({
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
      event: "iap_service_started",
      host: listenInfo.host,
      port: listenInfo.port,
      store: config.storeType
    })
  );
  registerShutdownHandlers(server, store);
}

async function createStore(config) {
  if (config.storeType === "postgres") {
    const pool = await createPostgresPool(config.databaseUrl);
    const store = new PostgresIapStore({ pool });
    await store.init();
    return store;
  }
  if (config.storeType === "file") {
    return new JsonFileIapStore({ filePath: config.filePath });
  }
  return new InMemoryIapStore();
}

function readConfig(env) {
  const rawType = String(env.IAP_STORE_TYPE || "memory").trim().toLowerCase();
  return {
    host: env.HOST || "0.0.0.0",
    port: parseIntWithDefault(env.PORT, 8110),
    bodyLimitBytes: parseIntWithDefault(env.BODY_LIMIT_BYTES, 256 * 1024),
    allowedOrigins: env.CORS_ALLOWED_ORIGINS || "",
    sessionSecret: requiredEnv(env, "SESSION_SECRET"),
    sessionIssuer: env.SESSION_ISSUER || "terapixel.identity",
    sessionAudience: env.SESSION_AUDIENCE || "terapixel.game",
    clockSkewSeconds: parseIntWithDefault(env.CLOCK_SKEW_SECONDS, 10),
    storeType:
      rawType === "postgres" ? "postgres" : rawType === "file" ? "file" : "memory",
    filePath:
      env.IAP_STORE_FILE_PATH ||
      path.resolve(process.cwd(), "data", "iap-service.json"),
    databaseUrl: env.DATABASE_URL || "",
    adminKey: String(env.IAP_ADMIN_KEY || env.IDENTITY_ADMIN_KEY || ""),
    providers: {
      apple: {
        sharedSecret: String(env.IAP_APPLE_SHARED_SECRET || ""),
        productionUrl: String(env.IAP_APPLE_VERIFY_URL || ""),
        sandboxUrl: String(env.IAP_APPLE_SANDBOX_VERIFY_URL || "")
      },
      google: {
        clientEmail: String(env.IAP_GOOGLE_CLIENT_EMAIL || ""),
        privateKey: String(env.IAP_GOOGLE_PRIVATE_KEY || ""),
        tokenUrl: String(env.IAP_GOOGLE_TOKEN_URL || ""),
        apiBase: String(env.IAP_GOOGLE_API_BASE || "")
      },
      paypal: {
        clientId: String(env.IAP_PAYPAL_CLIENT_ID || ""),
        clientSecret: String(env.IAP_PAYPAL_CLIENT_SECRET || ""),
        baseUrl: String(env.IAP_PAYPAL_BASE_URL || "")
      }
    }
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

function registerShutdownHandlers(server, store) {
  let closing = false;
  const shutdown = async (signal) => {
    if (closing) {
      return;
    }
    closing = true;
    console.info(JSON.stringify({ event: "shutdown", signal }));
    try {
      await server.close();
      if (store && typeof store.close === "function") {
        await store.close();
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
    throw new Error("DATABASE_URL is required for IAP_STORE_TYPE=postgres");
  }
  let pgModule;
  try {
    pgModule = await import("pg");
  } catch (_error) {
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
