import { createJwksKeyStore } from "../../../adapters/crazygames-auth/index.js";
import {
  createIdentityGatewayHttpServer,
  InMemoryIdentityStore,
  PostgresIdentityStore
} from "../index.js";
import {
  createHttpMergeCoordinator,
  createIdentityGatewayService
} from "./identityGatewayService.js";
import { createMagicLinkEmailSender } from "./magicLinkEmailSender.js";

async function main() {
  const config = readConfig(process.env);
  const keyStore = createJwksKeyStore({
    jwksUrl: config.crazyGamesJwksUrl,
    ttlSeconds: config.jwksTtlSeconds
  });

  const service = createIdentityGatewayService({
    identityStore: await createIdentityStore(config),
    mergeCoordinator: createHttpMergeCoordinator({
      adminKey: config.internalServiceKey,
      iapMergeUrl: config.iapMergeUrl,
      saveMergeUrl: config.saveMergeUrl,
      flagsMergeUrl: config.flagsMergeUrl,
      telemetryMergeUrl: config.telemetryMergeUrl
    }),
    sessionSecret: config.sessionSecret,
    sessionIssuer: config.sessionIssuer,
    sessionAudience: config.sessionAudience,
    sessionTtlSeconds: config.sessionTtlSeconds,
    magicLinkBaseUrl: config.magicLinkBaseUrl,
    magicLinkMobileBaseUrl: config.magicLinkMobileBaseUrl,
    magicLinkTtlSeconds: config.magicLinkTtlSeconds,
    magicLinkRateLimitPerHour: config.magicLinkRateLimitPerHour,
    usernameModerationGlobalTokens: parseTokenList(config.usernameBlocklistGlobalRaw),
    usernameModerationByGame: parsePerGameTokenMap(config.usernameBlocklistByGameJsonRaw),
    magicLinkSigningSecret: config.magicLinkSigningSecret,
    magicLinkCompletionNotifier: createNakamaMagicLinkNotifier({
      targetsByGameId: config.magicLinkNakamaNotifyTargets,
      defaultGameId: config.magicLinkDefaultGameId,
      legacyNotifyUrl: config.magicLinkNakamaNotifyUrl,
      legacyNotifyHttpKey: config.magicLinkNakamaNotifyHttpKey,
      legacySharedSecret: config.magicLinkNakamaNotifySecret
    }),
    magicLinkEmailSender: createMagicLinkEmailSender({
      fromEmail: config.magicLinkFromEmail,
      replyToEmail: config.magicLinkReplyToEmail,
      subject: config.magicLinkSubject,
      senderName: "Terapixel Games",
      smtpHost: config.smtpHost,
      smtpPort: config.smtpPort,
      smtpUser: config.smtpUser,
      smtpPass: config.smtpPass,
      smtpSecure: config.smtpSecure,
      smtpRequireTls: config.smtpRequireTls
    })
  });

  const server = createIdentityGatewayHttpServer({
    service,
    bodyLimitBytes: config.bodyLimitBytes,
    allowedOrigins: config.allowedOrigins,
    sessionSecret: config.sessionSecret,
    sessionIssuer: config.sessionIssuer,
    sessionAudience: config.sessionAudience,
    clockSkewSeconds: config.clockSkewSeconds,
    internalServiceKey: config.internalServiceKey,
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
      port: listenInfo.port,
      store: config.identityStoreType
    })
  );
  registerShutdownHandlers(server, service.identityStore);
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
    sessionTtlSeconds: parseIntWithDefault(env.SESSION_TTL_SECONDS, 3600),
    identityStoreType: normalizeStoreType(env.IDENTITY_STORE_TYPE || "memory"),
    databaseUrl: String(env.DATABASE_URL || ""),
    internalServiceKey: String(env.INTERNAL_SERVICE_KEY || env.IDENTITY_ADMIN_KEY || ""),
    iapMergeUrl: String(env.IAP_INTERNAL_MERGE_URL || ""),
    saveMergeUrl: String(env.SAVE_INTERNAL_MERGE_URL || ""),
    flagsMergeUrl: String(env.FLAGS_INTERNAL_MERGE_URL || ""),
    telemetryMergeUrl: String(env.TELEMETRY_INTERNAL_MERGE_URL || ""),
    magicLinkFromEmail: String(env.MAGIC_LINK_FROM_EMAIL || ""),
    magicLinkReplyToEmail: String(env.MAGIC_LINK_REPLY_TO_EMAIL || ""),
    magicLinkSubject: String(env.MAGIC_LINK_SUBJECT || "Terapixel Games Magic Link"),
    magicLinkBaseUrl: String(env.MAGIC_LINK_BASE_URL || ""),
    magicLinkMobileBaseUrl: String(env.MAGIC_LINK_MOBILE_BASE_URL || ""),
    magicLinkSigningSecret: String(env.MAGIC_LINK_SIGNING_SECRET || ""),
    magicLinkTtlSeconds: parseIntWithDefault(env.MAGIC_LINK_TTL_SECONDS, 900),
    magicLinkRateLimitPerHour: parseIntWithDefault(env.MAGIC_LINK_RATE_LIMIT_PER_HOUR, 5),
    usernameBlocklistGlobalRaw: String(env.USERNAME_BLOCKLIST_GLOBAL || ""),
    usernameBlocklistByGameJsonRaw: String(env.USERNAME_BLOCKLIST_BY_GAME_JSON || ""),
    magicLinkDefaultGameId: String(env.MAGIC_LINK_DEFAULT_GAME_ID || ""),
    magicLinkNakamaNotifyTargets: parseNotifyTargets(
      env.MAGIC_LINK_NAKAMA_NOTIFY_TARGETS_JSON
    ),
    magicLinkNakamaNotifyUrl: String(env.MAGIC_LINK_NAKAMA_NOTIFY_URL || ""),
    magicLinkNakamaNotifyHttpKey: String(env.MAGIC_LINK_NAKAMA_NOTIFY_HTTP_KEY || ""),
    magicLinkNakamaNotifySecret: String(env.MAGIC_LINK_NAKAMA_NOTIFY_SECRET || ""),
    smtpHost: String(env.SMTP_HOST || ""),
    smtpPort: parseIntWithDefault(env.SMTP_PORT, 587),
    smtpUser: String(env.SMTP_USER || ""),
    smtpPass: String(env.SMTP_PASS || ""),
    smtpSecure: parseBoolWithDefault(env.SMTP_SECURE, false),
    smtpRequireTls: parseBoolWithDefault(env.SMTP_REQUIRE_TLS, true)
  };
}

function parseTokenList(raw) {
  const text = String(raw || "").trim();
  if (!text) {
    return [];
  }
  if (text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch (_error) {
      // Fall through to CSV parse.
    }
  }
  return text.split(",").map((it) => String(it || "").trim()).filter(Boolean);
}

function parsePerGameTokenMap(raw) {
  const text = String(raw || "").trim();
  if (!text) {
    return {};
  }
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out = {};
    for (const [gameId, value] of Object.entries(parsed)) {
      out[gameId] = Array.isArray(value) ? value : parseTokenList(String(value || ""));
    }
    return out;
  } catch (_error) {
    return {};
  }
}

function createNakamaMagicLinkNotifier(config) {
  const targetsByGameId = normalizeNotifyTargets(config?.targetsByGameId || {});
  const defaultGameId = String(config?.defaultGameId || "").trim().toLowerCase();
  const legacyNotifyUrl = String(config?.legacyNotifyUrl || "").trim();
  const legacyNotifyHttpKey = String(config?.legacyNotifyHttpKey || "").trim();
  const legacySharedSecret = String(config?.legacySharedSecret || "").trim();
  const hasLegacy =
    !!legacyNotifyUrl && !!legacyNotifyHttpKey && !!legacySharedSecret;
  if (Object.keys(targetsByGameId).length === 0 && !hasLegacy) {
    return {
      notify: async () => ({ ok: false, skipped: true })
    };
  }
  return {
    notify: async (event) => {
      const eventGameId = String(event?.gameId || "").trim().toLowerCase();
      var target = null;
      if (eventGameId && targetsByGameId[eventGameId]) {
        target = targetsByGameId[eventGameId];
      } else if (defaultGameId && targetsByGameId[defaultGameId]) {
        target = targetsByGameId[defaultGameId];
      } else if (hasLegacy) {
        target = {
          notifyUrl: legacyNotifyUrl,
          notifyHttpKey: legacyNotifyHttpKey,
          sharedSecret: legacySharedSecret
        };
      } else {
        return { ok: false, skipped: true, reason: "no_target_for_game_id" };
      }
      const payload = {
        secret: target.sharedSecret,
        game_id: eventGameId,
        profile_id: String(event?.profileId || ""),
        status: String(event?.status || ""),
        email: String(event?.email || ""),
        primary_profile_id: String(event?.primaryProfileId || ""),
        secondary_profile_id: String(event?.secondaryProfileId || ""),
        completed_at: Number.isFinite(Number(event?.usedAt))
          ? Math.floor(Number(event.usedAt))
          : Math.floor(Date.now() / 1000)
      };
      const notifyUrl = target.notifyUrl;
      const response = await fetch(`${notifyUrl}${notifyUrl.includes("?") ? "&" : "?"}http_key=${encodeURIComponent(target.notifyHttpKey)}`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(JSON.stringify(payload))
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`nakama notify failed: ${response.status} ${text}`);
      }
      return { ok: true };
    }
  };
}

function parseNotifyTargets(raw) {
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(String(raw));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed;
  } catch (_error) {
    return {};
  }
}

function normalizeNotifyTargets(input) {
  const out = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return out;
  }
  for (const [rawGameId, value] of Object.entries(input)) {
    const gameId = String(rawGameId || "").trim().toLowerCase();
    if (!gameId || !value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }
    const notifyUrl = String(
      value.notify_url || value.notifyUrl || value.url || ""
    ).trim();
    const notifyHttpKey = String(
      value.notify_http_key || value.notifyHttpKey || value.http_key || value.httpKey || ""
    ).trim();
    const sharedSecret = String(
      value.shared_secret || value.sharedSecret || value.secret || ""
    ).trim();
    if (!notifyUrl || !notifyHttpKey || !sharedSecret) {
      continue;
    }
    out[gameId] = {
      notifyUrl,
      notifyHttpKey,
      sharedSecret
    };
  }
  return out;
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

function parseBoolWithDefault(raw, fallback) {
  if (typeof raw === "boolean") {
    return raw;
  }
  const normalized = String(raw || "").trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(normalized);
}

function registerShutdownHandlers(server, identityStore) {
  let closing = false;
  const shutdown = async (signal) => {
    if (closing) {
      return;
    }
    closing = true;
    console.info(JSON.stringify({ event: "shutdown", signal }));
    try {
      await server.close();
      if (identityStore && typeof identityStore.close === "function") {
        await identityStore.close();
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

async function createIdentityStore(config) {
  if (config.identityStoreType === "postgres") {
    const pool = await createPostgresPool(config.databaseUrl);
    const store = new PostgresIdentityStore({ pool });
    await store.init();
    return store;
  }
  return new InMemoryIdentityStore();
}

function normalizeStoreType(raw) {
  const value = String(raw || "").trim().toLowerCase();
  if (value === "postgres") {
    return "postgres";
  }
  return "memory";
}

async function createPostgresPool(databaseUrl) {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for IDENTITY_STORE_TYPE=postgres");
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
