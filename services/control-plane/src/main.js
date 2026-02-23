import { createControlPlaneHttpServer } from "./httpServer.js";
import { PostgresControlPlaneStore } from "./controlPlaneStore.js";
import { createGoogleWorkspaceAuth } from "./googleWorkspaceAuth.js";

async function main() {
  const config = readConfig(process.env);
  const pgModule = await import("pg");
  const Pool = resolvePoolConstructor(pgModule);
  const pool = new Pool({
    connectionString: config.databaseUrl
  });
  const store = new PostgresControlPlaneStore({
    pool,
    encryptionKey: config.encryptionKey
  });
  const auth = createAdminAuth(config);
  const server = createControlPlaneHttpServer({
    store,
    auth,
    bodyLimitBytes: config.bodyLimitBytes,
    allowedOrigins: config.allowedOrigins,
    internalServiceKey: config.internalServiceKey,
    internalOnboardingKey: config.internalOnboardingKey,
    googleOauthClientId: config.googleOauthClientId,
    simpleAuthKey: config.simpleAuthKey,
    logger: console
  });
  const listenInfo = await server.listen(config.port, config.host);
  console.info(
    JSON.stringify({
      event: "control_plane_started",
      host: listenInfo.host,
      port: listenInfo.port
    })
  );

  registerShutdownHandlers(server, store);
}

function readConfig(env) {
  const simpleAuthKey = String(env.CONTROL_PLANE_SIMPLE_AUTH_KEY || "").trim();
  const googleOauthClientId = String(env.GOOGLE_OAUTH_CLIENT_ID || "").trim();
  const internalServiceKey = String(env.INTERNAL_SERVICE_KEY || env.IDENTITY_ADMIN_KEY || "");
  const onboardingKey = String(env.CONTROL_PLANE_ONBOARDING_KEY || "").trim();
  if (!simpleAuthKey && !googleOauthClientId && !internalServiceKey && !onboardingKey) {
    throw new Error(
      "missing auth config: set GOOGLE_OAUTH_CLIENT_ID or CONTROL_PLANE_SIMPLE_AUTH_KEY or INTERNAL_SERVICE_KEY/CONTROL_PLANE_ONBOARDING_KEY"
    );
  }
  return {
    host: env.HOST || "0.0.0.0",
    port: parseIntWithDefault(env.PORT, 8090),
    bodyLimitBytes: parseIntWithDefault(env.BODY_LIMIT_BYTES, 128 * 1024),
    allowedOrigins: String(env.CORS_ALLOWED_ORIGINS || ""),
    databaseUrl: requiredEnv(env, "DATABASE_URL"),
    googleOauthClientId,
    googleWorkspaceDomains: String(env.GOOGLE_WORKSPACE_DOMAINS || ""),
    bootstrapEmails: String(env.CONTROL_PLANE_BOOTSTRAP_EMAILS || ""),
    internalServiceKey,
    internalOnboardingKey: String(
      env.CONTROL_PLANE_ONBOARDING_KEY ||
      env.INTERNAL_SERVICE_KEY ||
        env.IDENTITY_ADMIN_KEY ||
        ""
    ),
    simpleAuthKey,
    encryptionKey: String(env.PLATFORM_CONFIG_ENCRYPTION_KEY || ""),
    jwksTtlSeconds: parseIntWithDefault(env.JWKS_TTL_SECONDS, 600)
  };
}

function createAdminAuth(config) {
  if (String(config.googleOauthClientId || "").trim()) {
    return createGoogleWorkspaceAuth({
      clientId: config.googleOauthClientId,
      allowedDomains: config.googleWorkspaceDomains,
      bootstrapEmails: config.bootstrapEmails,
      jwksTtlSeconds: config.jwksTtlSeconds
    });
  }
  return {
    bootstrapEmails: [],
    async verifyIdToken() {
      throw new Error("google oauth is not configured");
    }
  };
}

function requiredEnv(env, key) {
  const value = String(env[key] || "").trim();
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
      await store.close();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
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

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
