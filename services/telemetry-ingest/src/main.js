import path from "node:path";
import {
  createTelemetryIngestHttpServer,
  createTelemetryIngestService,
  InMemoryTelemetrySink,
  JsonFileTelemetrySink
} from "../index.js";

async function main() {
  const config = readConfig(process.env);
  const sink = createSink(config);
  const service = createTelemetryIngestService({
    sink,
    maxEventsPerRequest: config.maxEventsPerRequest
  });
  const server = createTelemetryIngestHttpServer({
    service,
    bodyLimitBytes: config.bodyLimitBytes,
    allowedOrigins: config.allowedOrigins,
    requireSession: config.requireSession,
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
      event: "telemetry_ingest_started",
      host: listenInfo.host,
      port: listenInfo.port,
      require_session: config.requireSession,
      store: config.storeType
    })
  );
  registerShutdownHandlers(server);
}

function readConfig(env) {
  const storeType = (env.TELEMETRY_STORE_TYPE || "memory").toLowerCase();
  return {
    host: env.HOST || "0.0.0.0",
    port: parseIntWithDefault(env.PORT, 8100),
    bodyLimitBytes: parseIntWithDefault(env.BODY_LIMIT_BYTES, 256 * 1024),
    allowedOrigins: env.CORS_ALLOWED_ORIGINS || "",
    requireSession: parseBooleanWithDefault(env.TELEMETRY_REQUIRE_SESSION, true),
    sessionSecret: String(env.SESSION_SECRET || ""),
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
    adminKey: String(env.INTERNAL_SERVICE_KEY || env.IDENTITY_ADMIN_KEY || "")
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
