import http from "node:http";
import crypto from "node:crypto";
import { JwtValidationError } from "../../../packages/shared-utils/index.js";

export function createIdentityGatewayHttpServer(options = {}) {
  const service = options.service;
  if (!service || typeof service.authenticateCrazyGamesUser !== "function") {
    throw new Error("service.authenticateCrazyGamesUser is required");
  }

  const authConfig = options.authConfig || {};
  const bodyLimitBytes = Number.isFinite(Number(options.bodyLimitBytes))
    ? Math.max(1024, Math.floor(Number(options.bodyLimitBytes)))
    : 64 * 1024;
  const cors = createCorsPolicy(options.allowedOrigins);

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
        authConfig,
        bodyLimitBytes,
        requestId
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
  if (req.method === "GET" && req.url === "/healthz") {
    writeJson(res, 200, { ok: true, request_id: ctx.requestId });
    return;
  }

  if (req.method === "POST" && req.url === "/v1/auth/crazygames") {
    const body = await readJsonBody(req, ctx.bodyLimitBytes);
    ensureObjectBody(body);
    const token = String(body.token || "");
    if (!token) {
      writeJson(res, 400, {
        request_id: ctx.requestId,
        error: { code: "invalid_request", message: "token is required" }
      });
      return;
    }

    try {
      const result = await ctx.service.authenticateCrazyGamesUser({
        token,
        keyStore: ctx.authConfig.keyStore,
        expectedIssuer: ctx.authConfig.expectedIssuer,
        expectedAudience: ctx.authConfig.expectedAudience,
        clockSkewSeconds: ctx.authConfig.clockSkewSeconds,
        nowSeconds: body.nowSeconds
      });

      writeJson(res, 200, {
        request_id: ctx.requestId,
        player_id: result.player.playerId,
        display_name: result.player.displayName || "",
        is_new_player: result.isNewPlayer,
        provider: result.provider,
        provider_user_id: result.providerUserId,
        created_at: result.player.createdAt,
        last_seen_at: result.player.lastSeenAt,
        session_token: result.sessionToken || "",
        session_expires_at: result.sessionExpiresAt || 0
      });
      return;
    } catch (error) {
      if (error instanceof JwtValidationError) {
        writeJson(res, 401, {
          request_id: ctx.requestId,
          error: { code: "invalid_token", message: error.message }
        });
        return;
      }
      throw error;
    }
  }

  writeJson(res, 404, {
    request_id: ctx.requestId,
    error: { code: "not_found", message: "Route not found" }
  });
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

function ensureObjectBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "invalid_json", "json body must be an object");
  }
}

function extractRequestId(req) {
  const headerValue = req.headers["x-request-id"];
  if (typeof headerValue === "string" && headerValue.trim()) {
    return headerValue.trim().slice(0, 100);
  }
  return crypto.randomUUID();
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
