import { createJwksKeyStore } from "../../../adapters/crazygames-auth/index.js";
import { createIdentityGatewayHttpServer } from "../index.js";
import { createIdentityGatewayService } from "./identityGatewayService.js";

async function main() {
  const config = readConfig(process.env);
  const keyStore = createJwksKeyStore({
    jwksUrl: config.crazyGamesJwksUrl,
    ttlSeconds: config.jwksTtlSeconds
  });

  const service = createIdentityGatewayService({
    sessionSecret: config.sessionSecret,
    sessionIssuer: config.sessionIssuer,
    sessionAudience: config.sessionAudience,
    sessionTtlSeconds: config.sessionTtlSeconds
  });

  const server = createIdentityGatewayHttpServer({
    service,
    bodyLimitBytes: config.bodyLimitBytes,
    allowedOrigins: config.allowedOrigins,
    authConfig: {
      keyStore,
      expectedIssuer: config.expectedIssuer,
      expectedAudience: config.expectedAudience,
      clockSkewSeconds: config.clockSkewSeconds
    },
    logger: console
  });

  const listenInfo = await server.listen(config.port, config.host);
  console.info(
    JSON.stringify({
      event: "identity_gateway_started",
      host: listenInfo.host,
      port: listenInfo.port
    })
  );
  registerShutdownHandlers(server);
}

function readConfig(env) {
  return {
    host: env.HOST || "0.0.0.0",
    port: parseIntWithDefault(env.PORT, 8080),
    bodyLimitBytes: parseIntWithDefault(env.BODY_LIMIT_BYTES, 64 * 1024),
    crazyGamesJwksUrl:
      env.CRAZYGAMES_JWKS_URL ||
      "https://sdk.crazygames.com/authentication/keys.json",
    expectedIssuer:
      env.CRAZYGAMES_EXPECTED_ISSUER ||
      "https://sdk.crazygames.com/authentication/",
    expectedAudience: requiredEnv(env, "CRAZYGAMES_EXPECTED_AUDIENCE"),
    allowedOrigins: env.CORS_ALLOWED_ORIGINS || "",
    jwksTtlSeconds: parseIntWithDefault(env.JWKS_TTL_SECONDS, 600),
    clockSkewSeconds: parseIntWithDefault(env.CLOCK_SKEW_SECONDS, 10),
    sessionSecret: requiredEnv(env, "SESSION_SECRET"),
    sessionIssuer: env.SESSION_ISSUER || "terapixel.identity",
    sessionAudience: env.SESSION_AUDIENCE || "terapixel.game",
    sessionTtlSeconds: parseIntWithDefault(env.SESSION_TTL_SECONDS, 3600)
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
