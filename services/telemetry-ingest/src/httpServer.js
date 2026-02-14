import http from "node:http";
import crypto from "node:crypto";
import {
  JwtValidationError,
  verifySessionToken
} from "../../../packages/shared-utils/index.js";

export function createTelemetryIngestHttpServer(options = {}) {
  const service = options.service;
  if (!service || typeof service.ingestEvents !== "function") {
    throw new Error("service.ingestEvents is required");
  }

  const bodyLimitBytes = Number.isFinite(Number(options.bodyLimitBytes))
    ? Math.max(1024, Math.floor(Number(options.bodyLimitBytes)))
    : 256 * 1024;
  const cors = createCorsPolicy(options.allowedOrigins);
  const requireSession = options.requireSession !== false;
  const sessionConfig = {
    secret: String(options.sessionSecret || ""),
    issuer: String(options.sessionIssuer || ""),
    audience: String(options.sessionAudience || ""),
    clockSkewSeconds: Number.isFinite(Number(options.clockSkewSeconds))
      ? Math.max(0, Math.floor(Number(options.clockSkewSeconds)))
      : 10
  };
  if (requireSession && !sessionConfig.secret) {
    throw new Error("sessionSecret is required when requireSession=true");
  }

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
        service,
        bodyLimitBytes,
        requestId,
        requireSession,
        sessionConfig
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
      writeJson(res, 500, {
        request_id: requestId,
        error: {
          code: "internal_error",
          message: "Internal server error"
        }
      });
      if (options.logger?.error) {
        options.logger.error(error);
      }
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
  const url = new URL(req.url || "/", "http://localhost");

  if (req.method === "GET" && url.pathname === "/healthz") {
    writeJson(res, 200, { ok: true, request_id: ctx.requestId });
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/telemetry/events") {
    const claims = ctx.requireSession
      ? requireSessionClaims(req, ctx.sessionConfig)
      : tryGetSessionClaims(req, ctx.sessionConfig);

    const body = await readJsonBody(req, ctx.bodyLimitBytes);
    ensureObjectBody(body);

    const gameId = String(body.game_id || "").trim();
    if (!gameId) {
      throw new HttpError(400, "invalid_request", "game_id is required");
    }

    const tokenProfileId = String(claims?.sub || "").trim();
    let profileId = String(body.profile_id || "").trim();
    if (tokenProfileId) {
      if (profileId && profileId !== tokenProfileId) {
        throw new HttpError(403, "forbidden", "profile_id mismatch");
      }
      profileId = tokenProfileId;
    } else if (ctx.requireSession) {
      throw new HttpError(401, "invalid_session", "session missing subject");
    }

    const result = await ctx.service.ingestEvents({
      gameId,
      profileId,
      sessionId: String(body.session_id || "").trim(),
      events: body.events,
      nowSeconds: body.now_seconds,
      requestId: ctx.requestId,
      clientIp: extractClientIp(req)
    });

    writeJson(res, 202, {
      request_id: ctx.requestId,
      game_id: result.game_id,
      profile_id: result.profile_id,
      accepted_events: result.accepted_events
    });
    return;
  }

  writeJson(res, 404, {
    request_id: ctx.requestId,
    error: { code: "not_found", message: "Route not found" }
  });
}

function requireSessionClaims(req, sessionConfig) {
  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    throw new HttpError(401, "missing_session", "missing bearer session");
  }
  if (!sessionConfig.secret) {
    throw new HttpError(500, "config_error", "session secret not configured");
  }
  try {
    return verifySessionToken(token, sessionConfig.secret, {
      issuer: sessionConfig.issuer || undefined,
      audience: sessionConfig.audience || undefined,
      clockSkewSeconds: sessionConfig.clockSkewSeconds
    });
  } catch (error) {
    if (error instanceof JwtValidationError) {
      throw new HttpError(401, "invalid_session", error.message);
    }
    throw error;
  }
}

function tryGetSessionClaims(req, sessionConfig) {
  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    return null;
  }
  if (!sessionConfig.secret) {
    throw new HttpError(500, "config_error", "session secret not configured");
  }
  try {
    return verifySessionToken(token, sessionConfig.secret, {
      issuer: sessionConfig.issuer || undefined,
      audience: sessionConfig.audience || undefined,
      clockSkewSeconds: sessionConfig.clockSkewSeconds
    });
  } catch (error) {
    if (error instanceof JwtValidationError) {
      throw new HttpError(401, "invalid_session", error.message);
    }
    throw error;
  }
}

function extractBearerToken(authHeader) {
  if (typeof authHeader !== "string" || !authHeader.trim()) {
    return "";
  }
  const [scheme, token] = authHeader.trim().split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return "";
  }
  return token.trim();
}

function extractClientIp(req) {
  const forwardedFor = String(req.headers["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();
  if (forwardedFor) {
    return forwardedFor;
  }
  const socketIp = req.socket?.remoteAddress;
  return socketIp ? String(socketIp) : "";
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
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch (_error) {
    throw new HttpError(400, "invalid_json", "invalid json body");
  }
}

function ensureObjectBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "invalid_json", "json body must be an object");
  }
}

function createCorsPolicy(allowedOriginsOption) {
  if (!allowedOriginsOption) {
    return { allowAny: false, origins: [] };
  }
  if (allowedOriginsOption === "*") {
    return { allowAny: true, origins: [] };
  }
  const origins = Array.isArray(allowedOriginsOption)
    ? allowedOriginsOption
    : String(allowedOriginsOption)
        .split(",")
        .map((it) => it.trim())
        .filter(Boolean);
  return { allowAny: false, origins };
}

function applyCors(req, res, cors) {
  const origin = String(req.headers.origin || "");
  if (cors.allowAny) {
    res.setHeader("access-control-allow-origin", "*");
  } else if (origin && cors.origins.includes(origin)) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("vary", "origin");
  }
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  res.setHeader(
    "access-control-allow-headers",
    "content-type,authorization,x-request-id"
  );
}

function writeJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
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
  const addr = server.address();
  const actualPort =
    addr && typeof addr === "object" && addr.port ? addr.port : port;
  return {
    port: actualPort,
    host,
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

function extractRequestId(req) {
  const headerValue = req.headers["x-request-id"];
  if (typeof headerValue === "string" && headerValue.trim()) {
    return headerValue.trim().slice(0, 100);
  }
  return crypto.randomUUID();
}
