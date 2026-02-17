import http from "node:http";
import crypto from "node:crypto";

export function createControlPlaneHttpServer(options = {}) {
  const store = options.store;
  const auth = options.auth;
  if (!store || typeof store.listTitles !== "function") {
    throw new Error("store is required");
  }
  if (!auth || typeof auth.verifyIdToken !== "function") {
    throw new Error("auth.verifyIdToken is required");
  }
  const bodyLimitBytes = Number.isFinite(Number(options.bodyLimitBytes))
    ? Math.max(1024, Math.floor(Number(options.bodyLimitBytes)))
    : 128 * 1024;
  const internalServiceKey = String(options.internalServiceKey || "").trim();
  const cors = createCorsPolicy(options.allowedOrigins);
  const logger = options.logger || console;

  const server = http.createServer(async (req, res) => {
    const requestId = extractRequestId(req);
    res.setHeader("x-request-id", requestId);
    applyCors(req, res, cors);
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    try {
      await handleRequest(req, res, {
        requestId,
        bodyLimitBytes,
        internalServiceKey,
        googleOauthClientId: String(options.googleOauthClientId || "").trim(),
        simpleAuthEnabled: !!String(options.simpleAuthKey || "").trim(),
        simpleAuthKey: String(options.simpleAuthKey || "").trim(),
        store,
        auth,
        logger
      });
    } catch (error) {
      if (error instanceof HttpError) {
        writeJson(res, error.statusCode, {
          request_id: requestId,
          error: {
            code: error.code,
            message: error.message
          }
        });
        return;
      }
      logger.error(error);
      const mapped = mapUnexpectedError(error);
      if (mapped) {
        writeJson(res, mapped.statusCode, {
          request_id: requestId,
          error: {
            code: mapped.code,
            message: mapped.message
          }
        });
        return;
      }
      writeJson(res, 500, {
        request_id: requestId,
        error: {
          code: "internal_error",
          message: "Internal server error"
        }
      });
    }
  });

  return {
    server,
    listen: async (port = 0, host = "127.0.0.1") =>
      listenServer(server, port, host),
    close: async () => closeServer(server)
  };
}

async function handleRequest(req, res, ctx) {
  if (req.method === "GET" && req.url === "/healthz") {
    writeJson(res, 200, { ok: true, request_id: ctx.requestId });
    return;
  }

  if (req.method === "GET" && req.url === "/admin") {
    writeHtml(
      res,
      200,
      renderAdminShell(ctx.googleOauthClientId, ctx.simpleAuthEnabled)
    );
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/v1/internal/runtime/identity-config")) {
    requireInternalKey(req, ctx.internalServiceKey);
    const reqUrl = new URL(req.url, "http://control-plane.local");
    const gameId = String(reqUrl.searchParams.get("game_id") || "").trim();
    const environment = String(reqUrl.searchParams.get("environment") || "prod").trim();
    if (!gameId) {
      throw new HttpError(400, "invalid_request", "game_id is required");
    }
    const config = await ctx.store.getRuntimeIdentityConfig({
      gameId,
      environment
    });
    if (!config) {
      throw new HttpError(404, "not_found", "title environment not found");
    }
    writeJson(res, 200, { request_id: ctx.requestId, config });
    return;
  }

  const actor = await requireAdmin(req, ctx.auth, ctx.store, {
    simpleAuthKey: ctx.simpleAuthKey
  });
  if (!actor) {
    throw new HttpError(401, "unauthorized", "missing bearer token or admin key");
  }

  if (req.method === "GET" && req.url === "/v1/admin/me") {
    writeJson(res, 200, {
      request_id: ctx.requestId,
      admin_user: {
        admin_user_id: actor.adminUserId,
        email: actor.email,
        display_name: actor.displayName,
        role: actor.role
      }
    });
    return;
  }

  if (req.method === "GET" && req.url === "/v1/admin/titles") {
    requireRole(actor, ["platform_owner", "platform_admin", "viewer"]);
    const titles = await ctx.store.listTitles();
    writeJson(res, 200, { request_id: ctx.requestId, titles });
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/v1/admin/events")) {
    requireRole(actor, ["platform_owner", "platform_admin", "viewer"]);
    const reqUrl = new URL(req.url, "http://control-plane.local");
    const events = await ctx.store.listServiceEvents({
      serviceKey: reqUrl.searchParams.get("service_key") || "",
      gameId: reqUrl.searchParams.get("game_id") || "",
      environment: reqUrl.searchParams.get("environment") || "",
      limit: reqUrl.searchParams.get("limit") || ""
    });
    writeJson(res, 200, { request_id: ctx.requestId, events });
    return;
  }

  if (req.method === "POST" && req.url === "/v1/admin/titles") {
    requireRole(actor, ["platform_owner", "platform_admin"]);
    const body = await readJsonBody(req, ctx.bodyLimitBytes);
    const created = await ctx.store.onboardTitle({
      tenantSlug: body.tenant_slug || body.tenantSlug,
      tenantName: body.tenant_name || body.tenantName,
      gameId: body.game_id || body.gameId,
      titleName: body.title_name || body.titleName,
      environments: body.environments
    });
    await ctx.store.writeAudit({
      requestId: ctx.requestId,
      actorAdminUserId: actor.adminUserId,
      actorEmail: actor.email,
      actionKey: "title.onboard",
      resourceType: "title",
      resourceId: created.gameId,
      tenantId: created.tenantId,
      titleId: created.titleId,
      oldValue: null,
      newValue: created,
      sourceIp: extractSourceIp(req),
      userAgent: String(req.headers["user-agent"] || "")
    });
    writeJson(res, 200, { request_id: ctx.requestId, title: created });
    return;
  }

  if (req.method === "PATCH" && req.url.startsWith("/v1/admin/titles/") && req.url.endsWith("/status")) {
    requireRole(actor, ["platform_owner", "platform_admin"]);
    const parts = req.url.split("/");
    const gameId = decodeURIComponent(parts[4] || "");
    const body = await readJsonBody(req, ctx.bodyLimitBytes);
    const updated = await ctx.store.setTitleStatus({
      gameId,
      status: body.status
    });
    await ctx.store.writeAudit({
      requestId: ctx.requestId,
      actorAdminUserId: actor.adminUserId,
      actorEmail: actor.email,
      actionKey: "title.status",
      resourceType: "title",
      resourceId: updated.gameId,
      titleId: updated.titleId,
      oldValue: null,
      newValue: updated,
      sourceIp: extractSourceIp(req),
      userAgent: String(req.headers["user-agent"] || "")
    });
    writeJson(res, 200, { request_id: ctx.requestId, title: updated });
    return;
  }

  if (req.method === "PUT" && req.url.startsWith("/v1/admin/titles/") && req.url.includes("/environments/") && req.url.endsWith("/notify-target")) {
    requireRole(actor, ["platform_owner", "platform_admin"]);
    const { gameId, environment } = parseTitleEnvironmentPath(req.url, "/notify-target");
    const body = await readJsonBody(req, ctx.bodyLimitBytes);
    const target = await ctx.store.upsertMagicLinkNotifyTarget({
      gameId,
      environment,
      notifyUrl: body.notify_url || body.notifyUrl,
      notifyHttpKey: body.notify_http_key || body.notifyHttpKey,
      sharedSecret: body.shared_secret || body.sharedSecret,
      status: body.status || "active",
      metadata: body.metadata || {}
    });
    await ctx.store.writeAudit({
      requestId: ctx.requestId,
      actorAdminUserId: actor.adminUserId,
      actorEmail: actor.email,
      actionKey: "notify_target.upsert",
      resourceType: "notify_target",
      resourceId: `${target.gameId}:${target.environment}`,
      environment: target.environment,
      oldValue: null,
      newValue: {
        gameId: target.gameId,
        environment: target.environment,
        notifyUrl: target.notifyUrl,
        status: target.status
      },
      sourceIp: extractSourceIp(req),
      userAgent: String(req.headers["user-agent"] || "")
    });
    writeJson(res, 200, { request_id: ctx.requestId, notify_target: target });
    return;
  }

  if (req.method === "PUT" && req.url.startsWith("/v1/admin/titles/") && req.url.includes("/environments/") && req.url.includes("/services/")) {
    requireRole(actor, ["platform_owner", "platform_admin"]);
    const { gameId, environment, serviceKey } = parseServicePath(req.url);
    const body = await readJsonBody(req, ctx.bodyLimitBytes);
    const endpoint = await ctx.store.upsertServiceEndpoint({
      gameId,
      environment,
      serviceKey,
      baseUrl: body.base_url || body.baseUrl,
      healthcheckUrl: body.healthcheck_url || body.healthcheckUrl || "",
      status: body.status || "active",
      metadata: body.metadata || {}
    });
    await ctx.store.writeAudit({
      requestId: ctx.requestId,
      actorAdminUserId: actor.adminUserId,
      actorEmail: actor.email,
      actionKey: "service_endpoint.upsert",
      resourceType: "service_endpoint",
      resourceId: `${endpoint.gameId}:${endpoint.environment}:${endpoint.serviceKey}`,
      environment: endpoint.environment,
      oldValue: null,
      newValue: endpoint,
      sourceIp: extractSourceIp(req),
      userAgent: String(req.headers["user-agent"] || "")
    });
    writeJson(res, 200, { request_id: ctx.requestId, service_endpoint: endpoint });
    return;
  }

  if (req.method === "POST" && req.url.startsWith("/v1/admin/titles/") && req.url.includes("/environments/") && req.url.endsWith("/feature-flags")) {
    requireRole(actor, ["platform_owner", "platform_admin"]);
    const { gameId, environment } = parseTitleEnvironmentPath(req.url, "/feature-flags");
    const body = await readJsonBody(req, ctx.bodyLimitBytes);
    const version = await ctx.store.publishFeatureFlagsVersion({
      gameId,
      environment,
      flags: body.flags || {},
      status: body.status || "active",
      effectiveFrom: body.effective_from || body.effectiveFrom || null,
      effectiveTo: body.effective_to || body.effectiveTo || null,
      createdByAdminUserId: actor.adminUserId
    });
    await ctx.store.writeAudit({
      requestId: ctx.requestId,
      actorAdminUserId: actor.adminUserId,
      actorEmail: actor.email,
      actionKey: "feature_flags.publish",
      resourceType: "feature_flags",
      resourceId: `${version.gameId}:${version.environment}:v${version.versionNumber}`,
      environment: version.environment,
      newValue: version,
      sourceIp: extractSourceIp(req),
      userAgent: String(req.headers["user-agent"] || "")
    });
    writeJson(res, 200, { request_id: ctx.requestId, feature_flags_version: version });
    return;
  }

  if (req.method === "POST" && req.url.startsWith("/v1/admin/titles/") && req.url.includes("/environments/") && req.url.endsWith("/iap-catalog")) {
    requireRole(actor, ["platform_owner", "platform_admin"]);
    const { gameId, environment } = parseTitleEnvironmentPath(req.url, "/iap-catalog");
    const body = await readJsonBody(req, ctx.bodyLimitBytes);
    const version = await ctx.store.publishIapCatalogVersion({
      gameId,
      environment,
      catalog: body.catalog || {},
      status: body.status || "active",
      effectiveFrom: body.effective_from || body.effectiveFrom || null,
      effectiveTo: body.effective_to || body.effectiveTo || null,
      createdByAdminUserId: actor.adminUserId
    });
    await ctx.store.writeAudit({
      requestId: ctx.requestId,
      actorAdminUserId: actor.adminUserId,
      actorEmail: actor.email,
      actionKey: "iap_catalog.publish",
      resourceType: "iap_catalog",
      resourceId: `${version.gameId}:${version.environment}:v${version.versionNumber}`,
      environment: version.environment,
      newValue: version,
      sourceIp: extractSourceIp(req),
      userAgent: String(req.headers["user-agent"] || "")
    });
    writeJson(res, 200, { request_id: ctx.requestId, iap_catalog_version: version });
    return;
  }

  if (req.method === "POST" && req.url.startsWith("/v1/admin/titles/") && req.url.includes("/environments/") && req.url.endsWith("/iap-schedules")) {
    requireRole(actor, ["platform_owner", "platform_admin"]);
    const { gameId, environment } = parseTitleEnvironmentPath(req.url, "/iap-schedules");
    const body = await readJsonBody(req, ctx.bodyLimitBytes);
    const schedule = await ctx.store.upsertIapSchedule({
      gameId,
      environment,
      scheduleName: body.schedule_name || body.scheduleName,
      startsAt: body.starts_at || body.startsAt,
      endsAt: body.ends_at || body.endsAt || null,
      payload: body.payload || {},
      status: body.status || "active",
      createdByAdminUserId: actor.adminUserId
    });
    await ctx.store.writeAudit({
      requestId: ctx.requestId,
      actorAdminUserId: actor.adminUserId,
      actorEmail: actor.email,
      actionKey: "iap_schedule.upsert",
      resourceType: "iap_schedule",
      resourceId: `${schedule.gameId}:${schedule.environment}:${schedule.scheduleName}`,
      environment: schedule.environment,
      newValue: schedule,
      sourceIp: extractSourceIp(req),
      userAgent: String(req.headers["user-agent"] || "")
    });
    writeJson(res, 200, { request_id: ctx.requestId, iap_schedule: schedule });
    return;
  }

  writeJson(res, 404, {
    request_id: ctx.requestId,
    error: { code: "not_found", message: "Route not found" }
  });
}

async function requireAdmin(req, auth, store, options = {}) {
  const simpleAuthKey = String(options.simpleAuthKey || "").trim();
  const simpleProvided = String(req.headers["x-admin-key"] || "").trim();
  if (simpleAuthKey && simpleProvided && simpleProvided === simpleAuthKey) {
    return {
      adminUserId: "",
      email: "simple_admin@local",
      displayName: "Simple Admin",
      role: "platform_owner"
    };
  }
  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    return null;
  }
  const claims = await auth.verifyIdToken(token);
  const actor = await store.upsertAdminUserFromGoogle({
    googleSub: claims.googleSub,
    email: claims.email,
    displayName: claims.displayName,
    bootstrapEmails: auth.bootstrapEmails
  });
  if (!actor) {
    throw new HttpError(403, "forbidden", "admin access not granted");
  }
  return actor;
}

function requireRole(actor, allowedRoles) {
  if (!allowedRoles.includes(String(actor.role || ""))) {
    throw new HttpError(403, "forbidden", "insufficient role");
  }
}

function requireInternalKey(req, expected) {
  if (!expected) {
    throw new HttpError(500, "config_error", "internal service key is not configured");
  }
  const provided = String(req.headers["x-admin-key"] || "").trim();
  if (!provided || provided !== expected) {
    throw new HttpError(401, "unauthorized", "invalid internal key");
  }
}

function parseTitleEnvironmentPath(url, suffix) {
  const pathOnly = url.split("?")[0];
  if (!pathOnly.endsWith(suffix)) {
    throw new HttpError(404, "not_found", "route not found");
  }
  const trimmed = pathOnly.slice(0, -suffix.length);
  const parts = trimmed.split("/").filter(Boolean);
  if (parts.length < 6) {
    throw new HttpError(400, "invalid_request", "invalid path");
  }
  return {
    gameId: decodeURIComponent(parts[3]),
    environment: decodeURIComponent(parts[5])
  };
}

function parseServicePath(url) {
  const pathOnly = url.split("?")[0];
  const parts = pathOnly.split("/").filter(Boolean);
  if (parts.length < 8) {
    throw new HttpError(400, "invalid_request", "invalid service path");
  }
  return {
    gameId: decodeURIComponent(parts[3]),
    environment: decodeURIComponent(parts[5]),
    serviceKey: decodeURIComponent(parts[7])
  };
}

function extractBearerToken(authHeader) {
  if (typeof authHeader !== "string" || !authHeader.trim()) {
    return "";
  }
  const [scheme, token] = authHeader.trim().split(" ");
  if (String(scheme || "").toLowerCase() !== "bearer" || !token) {
    return "";
  }
  return token.trim();
}

async function readJsonBody(req, bodyLimitBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const part = Buffer.from(chunk);
    total += part.length;
    if (total > bodyLimitBytes) {
      throw new HttpError(413, "payload_too_large", "request body too large");
    }
    chunks.push(part);
  }
  if (chunks.length === 0) {
    return {};
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch (_error) {
    throw new HttpError(400, "invalid_json", "invalid json body");
  }
}

function extractRequestId(req) {
  const incoming = String(req.headers["x-request-id"] || "").trim();
  if (incoming) {
    return incoming;
  }
  return crypto.randomUUID();
}

function extractSourceIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  if (forwarded) {
    return forwarded;
  }
  return String(req.socket?.remoteAddress || "");
}

function writeJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("content-length", Buffer.byteLength(body));
  res.end(body);
}

function writeHtml(res, statusCode, html) {
  const body = String(html || "");
  res.statusCode = statusCode;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("content-length", Buffer.byteLength(body));
  res.end(body);
}

async function listenServer(server, port, host) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  const actualPort = address && typeof address === "object" ? address.port : port;
  return {
    host,
    port: actualPort,
    baseUrl: `http://${host}:${actualPort}`
  };
}

async function closeServer(server) {
  if (!server.listening) {
    return;
  }
  if (typeof server.closeIdleConnections === "function") {
    server.closeIdleConnections();
  }
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
  if (typeof server.closeAllConnections === "function") {
    server.closeAllConnections();
  }
}

class HttpError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function mapUnexpectedError(error) {
  const code = String(error?.code || "").trim();
  const message = String(error?.message || "").trim();
  if (code === "42P01") {
    return {
      statusCode: 500,
      code: "db_schema_missing",
      message:
        "Control-plane database schema is missing. Run migrations (npm run db:migrate)."
    };
  }
  if (code === "23505") {
    return {
      statusCode: 409,
      code: "conflict",
      message: message || "resource conflict"
    };
  }
  if (looksLikeInvalidRequest(message)) {
    return {
      statusCode: 400,
      code: "invalid_request",
      message
    };
  }
  return null;
}

function looksLikeInvalidRequest(message) {
  const text = String(message || "").toLowerCase();
  if (!text) {
    return false;
  }
  const patterns = [
    "is required",
    "must be ",
    "invalid ",
    "title environment not found",
    "title not found"
  ];
  for (const pattern of patterns) {
    if (text.includes(pattern)) {
      return true;
    }
  }
  return false;
}

function createCorsPolicy(rawAllowedOrigins) {
  const raw = String(rawAllowedOrigins || "").trim();
  if (!raw || raw === "*") {
    return { allowAll: true, values: [] };
  }
  const values = raw
    .split(",")
    .map((it) => it.trim())
    .filter(Boolean);
  return { allowAll: false, values };
}

function applyCors(req, res, cors) {
  const origin = String(req.headers.origin || "").trim();
  if (!origin) {
    return;
  }
  if (cors.allowAll) {
    res.setHeader("access-control-allow-origin", "*");
  } else if (cors.values.includes(origin)) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("vary", "Origin");
  } else {
    return;
  }
  res.setHeader("access-control-allow-methods", "GET,POST,PUT,PATCH,OPTIONS");
  res.setHeader("access-control-allow-headers", "Content-Type,Authorization,X-Admin-Key,X-Request-Id");
}

function renderAdminShell(googleOauthClientId, simpleAuthEnabled) {
  const safeGoogleClientId = escapeHtml(String(googleOauthClientId || "").trim());
  const safeSimpleAuthEnabled = simpleAuthEnabled ? "true" : "false";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Terapixel Control Plane</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #0b1220;
      --bg-panel: #0f1728;
      --line: #293347;
      --fg: #f4f7ff;
      --muted: #a8b3cc;
      --accent: #7dd3fc;
      --ok: #34d399;
      --warn: #f59e0b;
      --err: #f87171;
    }
    body {
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      margin: 0;
      background: radial-gradient(1200px 700px at 80% -10%, #1a2742 0%, #0b1220 45%, #090f1a 100%);
      color: var(--fg);
    }
    main { max-width: 1120px; margin: 24px auto; padding: 0 18px 28px; }
    h1 { margin: 0; font-size: 30px; }
    h2 { margin: 0; font-size: 18px; }
    p { margin: 8px 0; color: var(--muted); line-height: 1.4; }
    code { background: #121d31; padding: 2px 6px; border-radius: 4px; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 14px; }
    .panel {
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 14px;
      background: linear-gradient(180deg, rgba(125,211,252,0.08) 0%, rgba(125,211,252,0.01) 20%), var(--bg-panel);
    }
    label { display: block; font-size: 12px; color: var(--muted); margin: 8px 0 4px; }
    input, select, textarea {
      width: 100%;
      box-sizing: border-box;
      border: 1px solid #3b4964;
      border-radius: 8px;
      background: #0a1323;
      color: var(--fg);
      padding: 8px 10px;
      font-size: 13px;
    }
    textarea { min-height: 84px; resize: vertical; }
    button {
      border: 1px solid #4f6386;
      background: #10213c;
      color: var(--fg);
      border-radius: 8px;
      padding: 8px 12px;
      cursor: pointer;
      margin-top: 10px;
      margin-right: 6px;
      font-weight: 600;
    }
    button:hover { border-color: var(--accent); }
    .status { font-size: 12px; margin-top: 6px; min-height: 18px; }
    .status.ok { color: var(--ok); }
    .status.warn { color: var(--warn); }
    .status.err { color: var(--err); }
    .mono {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
      white-space: pre-wrap;
      font-size: 12px;
      background: #0a1322;
      border: 1px solid #32425f;
      border-radius: 8px;
      padding: 10px;
      margin-top: 10px;
      min-height: 120px;
      max-height: 320px;
      overflow: auto;
    }
    .pill {
      display: inline-block;
      font-size: 11px;
      margin-left: 8px;
      padding: 3px 7px;
      border-radius: 999px;
      border: 1px solid #3d567e;
      color: #c4d7ff;
      background: #0f1f37;
    }
    .top { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    @media (max-width: 980px) { .row { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main>
    <div class="top">
      <h1>Terapixel Control Plane</h1>
      <span class="pill">Admin Panel v1</span>
    </div>
    <p>Use either Google Workspace sign-in or a temporary simple admin key (if enabled).</p>

    <div class="panel">
      <h2>Authentication</h2>
      <p>Recommended: Google sign-in. Simple key mode is for temporary bring-up only.</p>
      <div id="googleSignin" style="margin:8px 0 4px;"></div>
      <button id="googleSignOut">Clear Session</button>
      <label for="simpleKey">Simple Admin Key (optional)</label>
      <input id="simpleKey" placeholder="CONTROL_PLANE_SIMPLE_AUTH_KEY" />
      <button id="saveSimpleKey">Save Simple Key</button>
      <label for="token">Google ID Token (Bearer)</label>
      <textarea id="token" placeholder="Paste ID token here"></textarea>
      <button id="saveToken">Save Token</button>
      <button id="loadMe">Load /v1/admin/me</button>
      <div id="authStatus" class="status"></div>
      <div id="authOutput" class="mono"></div>
    </div>

    <div class="row">
      <div class="panel">
        <h2>Onboard Title</h2>
        <label>Tenant Slug</label>
        <input id="tenantSlug" value="terapixel" />
        <label>Tenant Name</label>
        <input id="tenantName" value="TeraPixel" />
        <label>Game ID</label>
        <input id="gameId" placeholder="color_crunch" />
        <label>Title Name</label>
        <input id="titleName" placeholder="Color Crunch" />
        <label>Environments (CSV)</label>
        <input id="environments" value="staging,prod" />
        <button id="onboardTitle">Create / Update Title</button>
        <div id="onboardStatus" class="status"></div>
      </div>

      <div class="panel">
        <h2>Title Status</h2>
        <label>Game ID</label>
        <input id="statusGameId" placeholder="color_crunch" />
        <label>Status</label>
        <select id="statusValue">
          <option value="active">active</option>
          <option value="suspended">suspended</option>
          <option value="offboarded">offboarded</option>
        </select>
        <button id="setTitleStatus">Apply Status</button>
        <div id="titleStatusState" class="status"></div>
      </div>
    </div>

    <div class="row">
      <div class="panel">
        <h2>Notify Target</h2>
        <label>Game ID</label>
        <input id="notifyGameId" placeholder="color_crunch" />
        <label>Environment</label>
        <select id="notifyEnvironment">
          <option value="staging">staging</option>
          <option value="prod">prod</option>
        </select>
        <label>Nakama Notify URL</label>
        <input id="notifyUrl" placeholder="https://<nakama>/v2/rpc/tpx_account_magic_link_notify" />
        <label>Nakama Runtime HTTP Key</label>
        <input id="notifyHttpKey" placeholder="NAKAMA_RUNTIME_HTTP_KEY" />
        <label>Shared Secret</label>
        <input id="notifySharedSecret" placeholder="TPX_MAGIC_LINK_NOTIFY_SECRET" />
        <button id="upsertNotify">Upsert Notify Target</button>
        <div id="notifyStatus" class="status"></div>
      </div>

      <div class="panel">
        <h2>Read Model</h2>
        <button id="refreshTitles">Refresh Titles</button>
        <button id="refreshEvents">Recent Events</button>
        <div id="listStatus" class="status"></div>
        <div id="listOutput" class="mono"></div>
      </div>
    </div>

    <div class="panel">
      <h2>API Notes</h2>
      <p><code>GET /v1/admin/titles</code>, <code>POST /v1/admin/titles</code>, <code>PATCH /v1/admin/titles/:gameId/status</code></p>
      <p><code>PUT /v1/admin/titles/:gameId/environments/:environment/notify-target</code></p>
      <p><code>GET /v1/internal/runtime/identity-config?game_id=...&environment=...</code> (internal key only)</p>
    </div>
  </main>
  <script>
    (function () {
      var GOOGLE_OAUTH_CLIENT_ID = "${safeGoogleClientId}";
      var SIMPLE_AUTH_ENABLED = ${safeSimpleAuthEnabled};
      var $ = function (id) { return document.getElementById(id); };

      function getToken() {
        return String($("token").value || "").trim();
      }

      function getSimpleKey() {
        return String($("simpleKey").value || "").trim();
      }

      function authHeaders() {
        var simpleKey = getSimpleKey();
        if (simpleKey) {
          return {
            "x-admin-key": simpleKey,
            "Content-Type": "application/json"
          };
        }
        var token = getToken();
        if (!token) {
          throw new Error("Missing token or simple admin key");
        }
        return {
          "Authorization": "Bearer " + token,
          "Content-Type": "application/json"
        };
      }

      function setStatus(elId, text, kind) {
        var el = $(elId);
        el.className = "status " + (kind || "");
        el.textContent = text || "";
      }

      function pretty(elId, payload) {
        $(elId).textContent = JSON.stringify(payload, null, 2);
      }

      async function api(method, path, body) {
        var response = await fetch(path, {
          method: method,
          headers: authHeaders(),
          body: body ? JSON.stringify(body) : undefined
        });
        var json = {};
        try { json = await response.json(); } catch (_e) {}
        if (!response.ok) {
          var msg = "HTTP " + response.status;
          if (json && json.error && json.error.message) {
            msg += ": " + json.error.message;
          }
          throw new Error(msg);
        }
        return json;
      }

      $("saveToken").addEventListener("click", function () {
        localStorage.setItem("tpx_control_plane_token", getToken());
        setStatus("authStatus", "Token saved locally.", "ok");
      });

      $("saveSimpleKey").addEventListener("click", function () {
        localStorage.setItem("tpx_control_plane_simple_key", getSimpleKey());
        setStatus("authStatus", "Simple key saved locally.", "ok");
      });

      $("googleSignOut").addEventListener("click", function () {
        $("token").value = "";
        $("simpleKey").value = "";
        localStorage.removeItem("tpx_control_plane_token");
        localStorage.removeItem("tpx_control_plane_simple_key");
        setStatus("authStatus", "Session cleared.", "warn");
      });

      $("loadMe").addEventListener("click", async function () {
        try {
          setStatus("authStatus", "Loading admin identity...", "warn");
          var data = await api("GET", "/v1/admin/me");
          pretty("authOutput", data);
          setStatus("authStatus", "Authenticated.", "ok");
        } catch (error) {
          setStatus("authStatus", String(error.message || error), "err");
        }
      });

      $("onboardTitle").addEventListener("click", async function () {
        try {
          setStatus("onboardStatus", "Submitting title onboarding...", "warn");
          var body = {
            tenant_slug: $("tenantSlug").value,
            tenant_name: $("tenantName").value,
            game_id: $("gameId").value,
            title_name: $("titleName").value,
            environments: String($("environments").value || "")
              .split(",")
              .map(function (it) { return it.trim(); })
              .filter(Boolean)
          };
          var data = await api("POST", "/v1/admin/titles", body);
          setStatus("onboardStatus", "Title onboarded.", "ok");
          pretty("listOutput", data);
        } catch (error) {
          setStatus("onboardStatus", String(error.message || error), "err");
        }
      });

      $("setTitleStatus").addEventListener("click", async function () {
        try {
          var gameId = String($("statusGameId").value || "").trim();
          if (!gameId) {
            throw new Error("Game ID is required");
          }
          setStatus("titleStatusState", "Updating status...", "warn");
          var path = "/v1/admin/titles/" + encodeURIComponent(gameId) + "/status";
          var data = await api("PATCH", path, { status: $("statusValue").value });
          setStatus("titleStatusState", "Status updated.", "ok");
          pretty("listOutput", data);
        } catch (error) {
          setStatus("titleStatusState", String(error.message || error), "err");
        }
      });

      $("upsertNotify").addEventListener("click", async function () {
        try {
          var gameId = String($("notifyGameId").value || "").trim();
          var env = String($("notifyEnvironment").value || "").trim();
          if (!gameId || !env) {
            throw new Error("Game ID and environment are required");
          }
          setStatus("notifyStatus", "Upserting notify target...", "warn");
          var path = "/v1/admin/titles/" + encodeURIComponent(gameId) +
            "/environments/" + encodeURIComponent(env) + "/notify-target";
          var body = {
            notify_url: $("notifyUrl").value,
            notify_http_key: $("notifyHttpKey").value,
            shared_secret: $("notifySharedSecret").value,
            status: "active"
          };
          var data = await api("PUT", path, body);
          setStatus("notifyStatus", "Notify target upserted.", "ok");
          pretty("listOutput", data);
        } catch (error) {
          setStatus("notifyStatus", String(error.message || error), "err");
        }
      });

      $("refreshTitles").addEventListener("click", async function () {
        try {
          setStatus("listStatus", "Loading titles...", "warn");
          var data = await api("GET", "/v1/admin/titles");
          pretty("listOutput", data);
          setStatus("listStatus", "Titles loaded.", "ok");
        } catch (error) {
          setStatus("listStatus", String(error.message || error), "err");
        }
      });

      $("refreshEvents").addEventListener("click", async function () {
        try {
          setStatus("listStatus", "Loading recent events...", "warn");
          var data = await api("GET", "/v1/admin/events?limit=100");
          pretty("listOutput", data);
          setStatus("listStatus", "Events loaded.", "ok");
        } catch (error) {
          setStatus("listStatus", String(error.message || error), "err");
        }
      });

      var savedToken = localStorage.getItem("tpx_control_plane_token") || "";
      if (savedToken) {
        $("token").value = savedToken;
      }
      var savedSimpleKey = localStorage.getItem("tpx_control_plane_simple_key") || "";
      if (savedSimpleKey) {
        $("simpleKey").value = savedSimpleKey;
      }

      function onGoogleCredential(response) {
        var token = String((response && response.credential) || "").trim();
        if (!token) {
          setStatus("authStatus", "Google sign-in did not return a token.", "err");
          return;
        }
        $("token").value = token;
        localStorage.setItem("tpx_control_plane_token", token);
        setStatus("authStatus", "Google sign-in succeeded. Click 'Load /v1/admin/me'.", "ok");
      }

      function initGoogleSignIn() {
        if (!GOOGLE_OAUTH_CLIENT_ID) {
          if (SIMPLE_AUTH_ENABLED) {
            setStatus("authStatus", "Simple key mode enabled. Google sign-in is optional.", "warn");
            return;
          }
          setStatus("authStatus", "GOOGLE_OAUTH_CLIENT_ID is not configured for this panel.", "warn");
          return;
        }
        if (!window.google || !window.google.accounts || !window.google.accounts.id) {
          setStatus("authStatus", "Google Identity script failed to load.", "err");
          return;
        }
        try {
          window.google.accounts.id.initialize({
            client_id: GOOGLE_OAUTH_CLIENT_ID,
            callback: onGoogleCredential,
            auto_select: false
          });
          window.google.accounts.id.renderButton(
            $("googleSignin"),
            {
              theme: "outline",
              size: "large",
              shape: "pill",
              text: "signin_with",
              logo_alignment: "left",
              width: 280
            }
          );
          window.google.accounts.id.prompt();
        } catch (error) {
          setStatus("authStatus", String(error.message || error), "err");
        }
      }

      initGoogleSignIn();
    })();
  </script>
  <script src="https://accounts.google.com/gsi/client" async defer></script>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
