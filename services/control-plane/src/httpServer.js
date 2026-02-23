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
  const internalOnboardingKey = String(options.internalOnboardingKey || "").trim();
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
        internalOnboardingKey,
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

  if (req.method === "POST" && matchesPath(req.url, "/v1/internal/onboarding/title-registration")) {
    requireInternalKey(req, ctx.internalOnboardingKey || ctx.internalServiceKey);
    const body = await readJsonBody(req, ctx.bodyLimitBytes);
    const payload = parseInternalTitleRegistrationPayload(body);
    const registration = await registerTitleInternal(payload, ctx.store);
    await ctx.store.writeAudit({
      requestId: ctx.requestId,
      actorAdminUserId: null,
      actorEmail: "internal_onboarding@local",
      actionKey: "title.onboard.internal",
      resourceType: "title",
      resourceId: registration.title.gameId,
      tenantId: registration.title.tenantId,
      titleId: registration.title.titleId,
      oldValue: null,
      newValue: registration.auditSnapshot,
      sourceIp: extractSourceIp(req),
      userAgent: String(req.headers["user-agent"] || "")
    });
    writeJson(res, 200, {
      request_id: ctx.requestId,
      registration: registration.response
    });
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

  if (
    req.method === "GET" &&
    req.url.startsWith("/v1/admin/titles/") &&
    req.url.includes("/environments/") &&
    req.url.endsWith("/config")
  ) {
    requireRole(actor, ["platform_owner", "platform_admin", "viewer"]);
    const { gameId, environment } = parseTitleEnvironmentPath(req.url, "/config");
    const config = await ctx.store.getTitleEnvironmentConfig({
      gameId,
      environment
    });
    writeJson(res, 200, { request_id: ctx.requestId, config });
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

  if (req.method === "PUT" && req.url.startsWith("/v1/admin/titles/") && req.url.includes("/environments/") && req.url.includes("/iap-providers/")) {
    requireRole(actor, ["platform_owner", "platform_admin"]);
    const { gameId, environment, providerKey } = parseIapProviderPath(req.url);
    const body = await readJsonBody(req, ctx.bodyLimitBytes);
    const providerConfig = await ctx.store.upsertIapProviderConfig({
      gameId,
      environment,
      providerKey,
      clientId: body.client_id || body.clientId,
      clientSecret: body.client_secret || body.clientSecret,
      baseUrl: body.base_url || body.baseUrl || "",
      status: body.status || "active",
      metadata: body.metadata || {}
    });
    await ctx.store.writeAudit({
      requestId: ctx.requestId,
      actorAdminUserId: actor.adminUserId,
      actorEmail: actor.email,
      actionKey: "iap_provider.upsert",
      resourceType: "iap_provider",
      resourceId: `${providerConfig.gameId}:${providerConfig.environment}:${providerConfig.providerKey}`,
      environment: providerConfig.environment,
      newValue: providerConfig,
      sourceIp: extractSourceIp(req),
      userAgent: String(req.headers["user-agent"] || "")
    });
    writeJson(res, 200, { request_id: ctx.requestId, iap_provider: providerConfig });
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

async function registerTitleInternal(payload, store) {
  const title = await store.onboardTitle({
    tenantSlug: payload.tenantSlug,
    tenantName: payload.tenantName,
    gameId: payload.gameId,
    titleName: payload.titleName,
    environments: payload.environments
  });

  const featureFlags = [];
  if (payload.publishFeatureFlags) {
    for (const request of payload.featureFlagRequests) {
      let unchanged = false;
      if (payload.skipIfFeatureFlagsUnchanged) {
        const runtimeConfig = await store.getRuntimeIdentityConfig({
          gameId: title.gameId,
          environment: request.environment
        });
        const activeFlags = normalizePlainObject(runtimeConfig?.featureFlags);
        unchanged = deepEqualValues(activeFlags, request.flags);
      }
      if (unchanged) {
        featureFlags.push({
          gameId: title.gameId,
          environment: request.environment,
          status: request.status,
          flags: request.flags,
          skipped: true
        });
        continue;
      }
      const published = await store.publishFeatureFlagsVersion({
        gameId: title.gameId,
        environment: request.environment,
        flags: request.flags,
        status: request.status,
        effectiveFrom: request.effectiveFrom,
        effectiveTo: request.effectiveTo,
        createdByAdminUserId: null
      });
      featureFlags.push({
        gameId: published.gameId,
        environment: published.environment,
        versionNumber: published.versionNumber,
        status: published.status,
        flags: published.flags,
        effectiveFrom: published.effectiveFrom,
        effectiveTo: published.effectiveTo,
        skipped: false
      });
    }
  }

  const notifyTargets = [];
  for (const request of payload.notifyTargets) {
    const target = await store.upsertMagicLinkNotifyTarget({
      gameId: title.gameId,
      environment: request.environment,
      notifyUrl: request.notifyUrl,
      notifyHttpKey: request.notifyHttpKey,
      sharedSecret: request.sharedSecret,
      status: request.status,
      metadata: request.metadata
    });
    notifyTargets.push(target);
  }

  const serviceEndpoints = [];
  for (const request of payload.serviceEndpoints) {
    const endpoint = await store.upsertServiceEndpoint({
      gameId: title.gameId,
      environment: request.environment,
      serviceKey: request.serviceKey,
      baseUrl: request.baseUrl,
      healthcheckUrl: request.healthcheckUrl,
      status: request.status,
      metadata: request.metadata
    });
    serviceEndpoints.push(endpoint);
  }

  const iapProviderConfigs = [];
  for (const request of payload.iapProviderConfigs) {
    const provider = await store.upsertIapProviderConfig({
      gameId: title.gameId,
      environment: request.environment,
      providerKey: request.providerKey,
      clientId: request.clientId,
      clientSecret: request.clientSecret,
      baseUrl: request.baseUrl,
      status: request.status,
      metadata: request.metadata
    });
    iapProviderConfigs.push(provider);
  }

  let titleStatus = null;
  if (payload.titleStatus) {
    titleStatus = await store.setTitleStatus({
      gameId: title.gameId,
      status: payload.titleStatus
    });
  }

  return {
    title,
    response: {
      title,
      titleStatus,
      featureFlags,
      notifyTargets,
      serviceEndpoints,
      iapProviderConfigs
    },
    auditSnapshot: {
      gameId: title.gameId,
      titleName: title.titleName,
      tenantSlug: title.tenantSlug,
      tenantName: title.tenantName,
      environments: title.environments,
      titleStatus: titleStatus ? titleStatus.status : "active",
      featureFlags: featureFlags.map((entry) => ({
        environment: entry.environment,
        status: entry.status,
        versionNumber: entry.versionNumber || null,
        skipped: !!entry.skipped
      })),
      notifyTargets: notifyTargets.map((entry) => ({
        environment: entry.environment,
        notifyUrl: entry.notifyUrl,
        status: entry.status
      })),
      serviceEndpoints: serviceEndpoints.map((entry) => ({
        environment: entry.environment,
        serviceKey: entry.serviceKey,
        baseUrl: entry.baseUrl,
        status: entry.status
      })),
      iapProviderConfigs: iapProviderConfigs.map((entry) => ({
        environment: entry.environment,
        providerKey: entry.providerKey,
        baseUrl: entry.baseUrl,
        status: entry.status
      }))
    }
  };
}

function parseInternalTitleRegistrationPayload(body) {
  const input = normalizePlainObject(body);
  const tenantSlug = normalizeInternalSlug(input.tenant_slug ?? input.tenantSlug);
  const tenantName = String(input.tenant_name ?? input.tenantName ?? "").trim();
  const gameId = normalizeInternalSlug(input.game_id ?? input.gameId);
  const titleName = String(input.title_name ?? input.titleName ?? "").trim();
  const environments = normalizeInternalEnvironments(input.environments);
  const titleStatusRaw = String(
    input.title_status ?? input.titleStatus ?? ""
  ).trim();
  const titleStatus = titleStatusRaw
    ? normalizeInternalTitleStatus(titleStatusRaw)
    : "";
  const serviceEndpoints = normalizeServiceEndpointRequests(
    input.service_endpoints ?? input.serviceEndpoints
  );
  const notifyTargets = normalizeNotifyTargetRequests(
    input.notify_targets ?? input.notifyTargets
  );
  const iapProviderConfigs = normalizeIapProviderRequests(
    input.iap_provider_configs ?? input.iapProviderConfigs
  );
  const publishFeatureFlags = parseBooleanWithDefault(
    input.publish_feature_flags ?? input.publishFeatureFlags,
    true
  );
  const skipIfFeatureFlagsUnchanged = parseBooleanWithDefault(
    input.skip_if_feature_flags_unchanged ?? input.skipIfFeatureFlagsUnchanged,
    true
  );
  const featureFlagRequests = publishFeatureFlags
    ? normalizeFeatureFlagRequests(input, environments)
    : [];

  if (!tenantSlug || !tenantName || !gameId || !titleName) {
    throw new Error("tenantSlug, tenantName, gameId, and titleName are required");
  }

  for (const request of serviceEndpoints) {
    if (!environments.includes(request.environment)) {
      throw new Error(
        `service endpoint environment ${request.environment} must be one of onboarded environments`
      );
    }
  }
  for (const request of notifyTargets) {
    if (!environments.includes(request.environment)) {
      throw new Error(
        `notify target environment ${request.environment} must be one of onboarded environments`
      );
    }
  }
  for (const request of iapProviderConfigs) {
    if (!environments.includes(request.environment)) {
      throw new Error(
        `iap provider environment ${request.environment} must be one of onboarded environments`
      );
    }
  }

  return {
    tenantSlug,
    tenantName,
    gameId,
    titleName,
    environments,
    titleStatus,
    publishFeatureFlags,
    skipIfFeatureFlagsUnchanged,
    featureFlagRequests,
    serviceEndpoints,
    notifyTargets,
    iapProviderConfigs
  };
}

function normalizeFeatureFlagRequests(input, environments) {
  const launchGateFlagKey = normalizeFeatureFlagKey(
    input.launch_gate_flag_key ?? input.launchGateFlagKey ?? "title_enabled"
  );
  const launchGateEnabled = parseBooleanWithDefault(
    input.launch_gate_enabled ?? input.launchGateEnabled,
    false
  );
  const globalFlagsRaw = input.feature_flags ?? input.featureFlags;
  const globalFlags =
    globalFlagsRaw && typeof globalFlagsRaw === "object"
      ? normalizePlainObject(globalFlagsRaw)
      : { [launchGateFlagKey]: launchGateEnabled };
  const status = normalizeInternalVersionStatus(
    input.feature_flags_status ?? input.featureFlagsStatus ?? "active"
  );
  const effectiveFrom = normalizeOptionalIsoDate(
    input.feature_flags_effective_from ?? input.featureFlagsEffectiveFrom ?? null
  );
  const effectiveTo = normalizeOptionalIsoDate(
    input.feature_flags_effective_to ?? input.featureFlagsEffectiveTo ?? null
  );
  const byEnvironment = normalizeFeatureFlagMapByEnvironment(
    input.feature_flags_by_environment ?? input.featureFlagsByEnvironment
  );
  return environments.map((environment) => ({
    environment,
    flags: normalizePlainObject(byEnvironment[environment] ?? globalFlags),
    status,
    effectiveFrom,
    effectiveTo
  }));
}

function normalizeFeatureFlagMapByEnvironment(raw) {
  if (!raw) {
    return {};
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("featureFlagsByEnvironment must be an object keyed by environment");
  }
  const out = {};
  for (const [environment, flags] of Object.entries(raw)) {
    out[normalizeInternalEnvironment(environment)] = normalizePlainObject(flags);
  }
  return out;
}

function normalizeServiceEndpointRequests(raw) {
  if (!raw) {
    return [];
  }
  if (Array.isArray(raw)) {
    return raw.map((entry) => normalizeServiceEndpointEntry(entry));
  }
  if (typeof raw !== "object") {
    throw new Error("serviceEndpoints must be an array or object");
  }
  const out = [];
  for (const [environment, services] of Object.entries(raw)) {
    const env = normalizeInternalEnvironment(environment);
    const serviceMap = normalizePlainObject(services);
    for (const [serviceKey, serviceConfig] of Object.entries(serviceMap)) {
      out.push(
        normalizeServiceEndpointEntry({
          environment: env,
          service_key: serviceKey,
          ...normalizePlainObject(serviceConfig)
        })
      );
    }
  }
  return out;
}

function normalizeServiceEndpointEntry(raw) {
  const entry = normalizePlainObject(raw);
  const environment = normalizeInternalEnvironment(
    entry.environment ?? entry.env ?? ""
  );
  const serviceKey = normalizeServiceKey(entry.service_key ?? entry.serviceKey ?? "");
  const baseUrl = String(entry.base_url ?? entry.baseUrl ?? "").trim();
  const healthcheckUrl = String(
    entry.healthcheck_url ?? entry.healthcheckUrl ?? ""
  ).trim();
  const status = normalizeOnOffStatus(entry.status ?? "active");
  const metadata = normalizePlainObject(entry.metadata);
  if (!baseUrl) {
    throw new Error("service endpoint baseUrl is required");
  }
  return {
    environment,
    serviceKey,
    baseUrl,
    healthcheckUrl,
    status,
    metadata
  };
}

function normalizeNotifyTargetRequests(raw) {
  if (!raw) {
    return [];
  }
  if (Array.isArray(raw)) {
    return raw.map((entry) => normalizeNotifyTargetEntry(entry));
  }
  if (typeof raw !== "object") {
    throw new Error("notifyTargets must be an array or object");
  }
  const out = [];
  for (const [environment, target] of Object.entries(raw)) {
    out.push(
      normalizeNotifyTargetEntry({
        environment,
        ...normalizePlainObject(target)
      })
    );
  }
  return out;
}

function normalizeNotifyTargetEntry(raw) {
  const entry = normalizePlainObject(raw);
  const environment = normalizeInternalEnvironment(
    entry.environment ?? entry.env ?? ""
  );
  const notifyUrl = String(entry.notify_url ?? entry.notifyUrl ?? "").trim();
  const notifyHttpKey = String(
    entry.notify_http_key ?? entry.notifyHttpKey ?? ""
  ).trim();
  const sharedSecret = String(
    entry.shared_secret ?? entry.sharedSecret ?? ""
  ).trim();
  const status = normalizeOnOffStatus(entry.status ?? "active");
  const metadata = normalizePlainObject(entry.metadata);
  if (!notifyUrl || !notifyHttpKey || !sharedSecret) {
    throw new Error("notify target requires notifyUrl, notifyHttpKey, and sharedSecret");
  }
  return {
    environment,
    notifyUrl,
    notifyHttpKey,
    sharedSecret,
    status,
    metadata
  };
}

function normalizeIapProviderRequests(raw) {
  if (!raw) {
    return [];
  }
  if (Array.isArray(raw)) {
    return raw.map((entry) => normalizeIapProviderEntry(entry));
  }
  if (typeof raw !== "object") {
    throw new Error("iapProviderConfigs must be an array or object");
  }
  const out = [];
  for (const [environment, providers] of Object.entries(raw)) {
    const providerMap = normalizePlainObject(providers);
    for (const [providerKey, providerConfig] of Object.entries(providerMap)) {
      out.push(
        normalizeIapProviderEntry({
          environment,
          provider_key: providerKey,
          ...normalizePlainObject(providerConfig)
        })
      );
    }
  }
  return out;
}

function normalizeIapProviderEntry(raw) {
  const entry = normalizePlainObject(raw);
  const environment = normalizeInternalEnvironment(
    entry.environment ?? entry.env ?? ""
  );
  const providerKey = normalizeProviderKey(
    entry.provider_key ?? entry.providerKey ?? ""
  );
  const clientId = String(entry.client_id ?? entry.clientId ?? "").trim();
  const clientSecret = String(
    entry.client_secret ?? entry.clientSecret ?? ""
  ).trim();
  const baseUrl = String(entry.base_url ?? entry.baseUrl ?? "").trim();
  const status = normalizeOnOffStatus(entry.status ?? "active");
  const metadata = normalizePlainObject(entry.metadata);
  if (status === "active" && (!clientId || !clientSecret)) {
    throw new Error("active iap provider requires clientId and clientSecret");
  }
  return {
    environment,
    providerKey,
    clientId,
    clientSecret,
    baseUrl,
    status,
    metadata
  };
}

function normalizeInternalEnvironments(raw) {
  const list = Array.isArray(raw) ? raw : ["staging", "prod"];
  const out = [];
  for (const value of list) {
    const env = normalizeInternalEnvironment(value);
    if (!out.includes(env)) {
      out.push(env);
    }
  }
  if (!out.length) {
    throw new Error("environments must include at least one environment");
  }
  return out;
}

function normalizeInternalEnvironment(value) {
  const env = String(value || "").trim().toLowerCase();
  if (env === "staging" || env === "prod") {
    return env;
  }
  throw new Error("environment must be staging or prod");
}

function normalizeServiceKey(value) {
  const key = String(value || "").trim().toLowerCase();
  if (!key) {
    throw new Error("serviceKey is required");
  }
  return key;
}

function normalizeProviderKey(value) {
  const key = String(value || "").trim().toLowerCase();
  if (!key) {
    throw new Error("providerKey is required");
  }
  return key;
}

function normalizeOnOffStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  if (status === "active" || status === "disabled") {
    return status;
  }
  throw new Error("status must be active or disabled");
}

function normalizeInternalTitleStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  if (status === "active" || status === "offboarded" || status === "suspended") {
    return status;
  }
  throw new Error("status must be active, offboarded, or suspended");
}

function normalizeInternalVersionStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  if (status === "draft" || status === "active" || status === "archived") {
    return status;
  }
  throw new Error("status must be draft, active, or archived");
}

function normalizeFeatureFlagKey(value) {
  const key = String(value || "").trim();
  if (!key) {
    throw new Error("launchGateFlagKey must not be empty");
  }
  return key;
}

function normalizeOptionalIsoDate(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("invalid datetime value");
  }
  return date.toISOString();
}

function parseBooleanWithDefault(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value;
  }
  const text = String(value || "").trim().toLowerCase();
  if (text === "true") {
    return true;
  }
  if (text === "false") {
    return false;
  }
  throw new Error("boolean value expected");
}

function normalizeInternalSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_");
}

function normalizePlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return { ...value };
}

function deepEqualValues(left, right) {
  return stableStringify(left) === stableStringify(right);
}

function stableStringify(value) {
  if (value === null || value === undefined) {
    return "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function matchesPath(rawUrl, expectedPath) {
  const url = new URL(String(rawUrl || ""), "http://control-plane.local");
  return url.pathname === expectedPath;
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

function parseIapProviderPath(url) {
  const pathOnly = url.split("?")[0];
  const parts = pathOnly.split("/").filter(Boolean);
  if (parts.length < 8) {
    throw new HttpError(400, "invalid_request", "invalid iap provider path");
  }
  return {
    gameId: decodeURIComponent(parts[3]),
    environment: decodeURIComponent(parts[5]),
    providerKey: decodeURIComponent(parts[7])
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
    "must include",
    "invalid ",
    "boolean value expected",
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
    .hidden { display: none; }
    .tabs { margin-top: 12px; display: flex; gap: 8px; align-items: center; }
    .tabs button { margin-top: 0; }
    .tab.active { border-color: var(--accent); }
    .title-list {
      margin-top: 10px;
      display: grid;
      grid-template-columns: 1fr;
      gap: 8px;
      max-height: 320px;
      overflow: auto;
    }
    .title-item {
      border: 1px solid #32425f;
      border-radius: 8px;
      padding: 8px;
      background: #0b1527;
      font-size: 12px;
    }
    .title-item-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 4px;
    }
    .open-config {
      color: var(--accent);
      text-decoration: none;
      font-size: 12px;
      font-weight: 600;
    }
    .open-config:hover { text-decoration: underline; }
    .tiny { font-size: 11px; color: var(--muted); }
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

    <div id="appShell" class="hidden">
      <div class="tabs">
        <button id="tabTitles" class="tab active">Titles</button>
        <button id="tabConfigure" class="tab">Configure Title</button>
        <span id="actorPill" class="pill"></span>
      </div>

      <div id="titlesTabPanel">
        <div class="row">
          <div class="panel">
            <h2>Registered Titles</h2>
            <p>Search all tenant titles and jump to configuration.</p>
            <label for="titleSearch">Search</label>
            <input id="titleSearch" placeholder="game_id, title name, tenant slug" />
            <button id="refreshTitleList">Refresh Titles</button>
            <div id="titleListStatus" class="status"></div>
            <div id="titlesList" class="title-list"></div>
          </div>
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
        </div>
      </div>

      <div id="configureTabPanel" class="hidden">
        <div class="panel">
          <h2>Configure Selected Title</h2>
          <label>Game ID</label>
          <input id="selectedGameDisplay" readonly placeholder="Select a title from Titles tab" />
          <label>Environment</label>
          <select id="selectedEnvironment">
            <option value="staging">staging</option>
            <option value="prod">prod</option>
          </select>
          <div class="tabs">
            <button id="svcTabIdentity" class="tab active">Identity</button>
            <button id="svcTabSave" class="tab">Save</button>
            <button id="svcTabFlags" class="tab">Flags</button>
            <button id="svcTabTelemetry" class="tab">Telemetry</button>
            <button id="svcTabIap" class="tab">IAP</button>
          </div>
        </div>

        <div id="svcPanelIdentity">
          <div class="row">
            <div class="panel">
              <h2>Identity Status</h2>
              <button id="identityEditToggle">Enable Editing</button>
              <label>Game ID</label>
              <input id="statusGameId" placeholder="color_crunch" readonly />
              <label>Status</label>
              <select id="statusValue">
                <option value="active">active</option>
                <option value="suspended">suspended</option>
                <option value="offboarded">offboarded</option>
              </select>
              <button id="setTitleStatus">Apply Status</button>
              <div id="titleStatusState" class="status"></div>
            </div>

            <div class="panel">
              <h2>Notify Target</h2>
              <label>Game ID</label>
              <input id="notifyGameId" placeholder="color_crunch" readonly />
              <label>Environment</label>
              <select id="notifyEnvironment" disabled>
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
          </div>
          <div class="panel">
            <h2>Read Model</h2>
            <button id="refreshTitles">Refresh Titles</button>
            <button id="refreshEvents">Recent Events</button>
            <div id="listStatus" class="status"></div>
            <div id="listOutput" class="mono"></div>
          </div>
        </div>

        <div id="svcPanelServiceEndpoint" class="hidden">
          <div class="panel">
            <h2 id="serviceEndpointHeading">Service Endpoint</h2>
            <p id="serviceEndpointHint" class="tiny"></p>
            <button id="serviceEditToggle">Enable Editing</button>
            <label>Game ID</label>
            <input id="serviceGameId" placeholder="color_crunch" readonly />
            <label>Environment</label>
            <select id="serviceEnvironment" disabled>
              <option value="staging">staging</option>
              <option value="prod">prod</option>
            </select>
            <label>Service Key</label>
            <input id="serviceKey" placeholder="save_service" readonly />
            <label>Base URL</label>
            <input id="serviceBaseUrl" placeholder="https://service.onrender.com" />
            <label>Healthcheck URL (optional)</label>
            <input id="serviceHealthUrl" placeholder="https://service.onrender.com/healthz" />
            <label>Status</label>
            <select id="serviceStatusValue">
              <option value="active">active</option>
              <option value="disabled">disabled</option>
            </select>
            <button id="upsertServiceEndpoint">Upsert Service Endpoint</button>
            <div id="serviceStatus" class="status"></div>
          </div>
        </div>

        <div id="svcPanelIap" class="hidden">
          <div class="panel">
            <h2>IAP Provider Config</h2>
            <button id="iapEditToggle">Enable Editing</button>
            <label>Game ID</label>
            <input id="iapProviderGameId" placeholder="color_crunch" readonly />
            <label>Environment</label>
            <select id="iapProviderEnvironment" disabled>
              <option value="staging">staging</option>
              <option value="prod">prod</option>
            </select>
            <label>Provider Key</label>
            <input id="iapProviderKey" value="paypal_web" />
            <label>Client ID</label>
            <input id="iapProviderClientId" placeholder="PayPal client id" />
            <label>Client Secret</label>
            <input id="iapProviderClientSecret" placeholder="PayPal client secret" />
            <label>Base URL (optional)</label>
            <input id="iapProviderBaseUrl" placeholder="https://api-m.paypal.com" />
            <label>Status</label>
            <select id="iapProviderStatusValue">
              <option value="active">active</option>
              <option value="disabled">disabled</option>
            </select>
            <button id="upsertIapProvider">Upsert IAP Provider</button>
            <div id="iapProviderStatus" class="status"></div>
          </div>
        </div>

        <div class="panel">
          <h2>API Notes</h2>
          <p><code>GET /v1/admin/titles</code>, <code>POST /v1/admin/titles</code>, <code>PATCH /v1/admin/titles/:gameId/status</code></p>
          <p><code>PUT /v1/admin/titles/:gameId/environments/:environment/notify-target</code></p>
          <p><code>PUT /v1/admin/titles/:gameId/environments/:environment/services/:serviceKey</code></p>
          <p><code>PUT /v1/admin/titles/:gameId/environments/:environment/iap-providers/:providerKey</code></p>
          <p><code>GET /v1/internal/runtime/identity-config?game_id=...&environment=...</code> (internal key only)</p>
        </div>
      </div>
    </div>
  </main>
  <script>
    (function () {
      var GOOGLE_OAUTH_CLIENT_ID = "${safeGoogleClientId}";
      var SIMPLE_AUTH_ENABLED = ${safeSimpleAuthEnabled};
      var $ = function (id) { return document.getElementById(id); };
      var state = {
        isAuthed: false,
        actor: null,
        titleRows: [],
        selectedGameId: "",
        configureServiceTab: "identity",
        selectedEnvironment: "staging",
        selectedConfig: null,
        editModes: {
          identity: false,
          service: false,
          iap: false
        }
      };

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
        if (!el) {
          return;
        }
        el.className = "status " + (kind || "");
        el.textContent = text || "";
      }

      function pretty(elId, payload) {
        var el = $(elId);
        if (!el) {
          return;
        }
        el.textContent = JSON.stringify(payload, null, 2);
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

      function setAuthed(isAuthed) {
        state.isAuthed = isAuthed === true;
        $("appShell").classList.toggle("hidden", !state.isAuthed);
      }

      function setTab(tabName) {
        var isTitles = tabName === "titles";
        $("tabTitles").classList.toggle("active", isTitles);
        $("tabConfigure").classList.toggle("active", !isTitles);
        $("titlesTabPanel").classList.toggle("hidden", !isTitles);
        $("configureTabPanel").classList.toggle("hidden", isTitles);
      }

      function setConfigureServiceTab(tabName) {
        var normalized = String(tabName || "identity").trim().toLowerCase();
        var valid = ["identity", "save", "flags", "telemetry", "iap"];
        if (!valid.includes(normalized)) {
          normalized = "identity";
        }
        state.configureServiceTab = normalized;
        $("svcTabIdentity").classList.toggle("active", normalized === "identity");
        $("svcTabSave").classList.toggle("active", normalized === "save");
        $("svcTabFlags").classList.toggle("active", normalized === "flags");
        $("svcTabTelemetry").classList.toggle("active", normalized === "telemetry");
        $("svcTabIap").classList.toggle("active", normalized === "iap");

        $("svcPanelIdentity").classList.toggle("hidden", normalized !== "identity");
        $("svcPanelServiceEndpoint").classList.toggle(
          "hidden",
          !["save", "flags", "telemetry"].includes(normalized)
        );
        $("svcPanelIap").classList.toggle("hidden", normalized !== "iap");

        if (normalized === "save") {
          $("serviceEndpointHeading").textContent = "Save Service Endpoint";
          $("serviceEndpointHint").textContent = "Configure endpoint for save-service runtime.";
          $("serviceKey").value = "save_service";
        } else if (normalized === "flags") {
          $("serviceEndpointHeading").textContent = "Flags Service Endpoint";
          $("serviceEndpointHint").textContent = "Configure endpoint for feature-flags service.";
          $("serviceKey").value = "feature_flags";
        } else if (normalized === "telemetry") {
          $("serviceEndpointHeading").textContent = "Telemetry Service Endpoint";
          $("serviceEndpointHint").textContent = "Configure endpoint for telemetry-ingest service.";
          $("serviceKey").value = "telemetry_ingest";
        } else if (normalized === "iap") {
          $("serviceEndpointHint").textContent = "";
        } else {
          $("serviceEndpointHint").textContent = "";
        }
      }

      function setPanelEditMode(panelName, editable) {
        var isEditable = editable === true;
        if (panelName === "identity") {
          state.editModes.identity = isEditable;
          ["statusValue", "notifyUrl", "notifyHttpKey", "notifySharedSecret"].forEach(function (id) {
            $(id).disabled = !isEditable;
          });
          $("setTitleStatus").disabled = !isEditable;
          $("upsertNotify").disabled = !isEditable;
          $("identityEditToggle").textContent = isEditable ? "Lock Fields" : "Enable Editing";
          return;
        }
        if (panelName === "service") {
          state.editModes.service = isEditable;
          ["serviceBaseUrl", "serviceHealthUrl", "serviceStatusValue"].forEach(function (id) {
            $(id).disabled = !isEditable;
          });
          $("upsertServiceEndpoint").disabled = !isEditable;
          $("serviceEditToggle").textContent = isEditable ? "Lock Fields" : "Enable Editing";
          return;
        }
        if (panelName === "iap") {
          state.editModes.iap = isEditable;
          [
            "iapProviderKey",
            "iapProviderClientId",
            "iapProviderClientSecret",
            "iapProviderBaseUrl",
            "iapProviderStatusValue"
          ].forEach(function (id) {
            $(id).disabled = !isEditable;
          });
          $("upsertIapProvider").disabled = !isEditable;
          $("iapEditToggle").textContent = isEditable ? "Lock Fields" : "Enable Editing";
        }
      }

      function normalizeTitleRows(rows) {
        return Array.isArray(rows) ? rows : [];
      }

      function buildTitleSummaries(rows) {
        var byGameId = {};
        rows.forEach(function (row) {
          var gameId = String(row.gameId || row.game_id || "").trim();
          if (!gameId) {
            return;
          }
          if (!byGameId[gameId]) {
            byGameId[gameId] = {
              gameId: gameId,
              titleName: String(row.titleName || row.title_name || gameId),
              titleStatus: String(row.titleStatus || row.title_status || "unknown"),
              tenantSlug: String(row.tenantSlug || row.tenant_slug || ""),
              tenantName: String(row.tenantName || row.tenant_name || ""),
              environments: []
            };
          }
          var env = String(row.environment || "").trim();
          if (env && !byGameId[gameId].environments.includes(env)) {
            byGameId[gameId].environments.push(env);
          }
        });
        return Object.values(byGameId).sort(function (a, b) {
          return a.gameId.localeCompare(b.gameId);
        });
      }

      function escapeClientText(value) {
        return String(value || "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;");
      }

      function setSelectedEnvironment(environment) {
        var env = String(environment || "").trim().toLowerCase();
        if (!env) {
          env = "staging";
        }
        state.selectedEnvironment = env;
        $("selectedEnvironment").value = env;
        $("notifyEnvironment").value = env;
        $("iapProviderEnvironment").value = env;
        $("serviceEnvironment").value = env;
      }

      function setSelectedGame(gameId) {
        state.selectedGameId = String(gameId || "").trim();
        $("selectedGameDisplay").value = state.selectedGameId;
        if (!state.selectedGameId) {
          return;
        }
        $("statusGameId").value = state.selectedGameId;
        $("notifyGameId").value = state.selectedGameId;
        $("iapProviderGameId").value = state.selectedGameId;
        $("serviceGameId").value = state.selectedGameId;

        var rows = state.titleRows.filter(function (row) {
          return String(row.gameId || row.game_id || "") === state.selectedGameId;
        });
        var envs = [];
        rows.forEach(function (row) {
          var env = String(row.environment || "").trim();
          if (env && !envs.includes(env)) {
            envs.push(env);
          }
        });
        if (envs.length === 0) {
          envs = ["staging", "prod"];
        }
        var selectedEnv = envs.includes("prod") ? "prod" : envs[0];
        var envSelect = $("selectedEnvironment");
        envSelect.innerHTML = "";
        envs.forEach(function (env) {
          var option = document.createElement("option");
          option.value = env;
          option.textContent = env;
          envSelect.appendChild(option);
        });
        setSelectedEnvironment(selectedEnv);
      }

      async function loadSelectedTitleConfig() {
        if (!state.selectedGameId) {
          return;
        }
        var env = String($("selectedEnvironment").value || state.selectedEnvironment || "").trim();
        if (!env) {
          return;
        }
        try {
          var path = "/v1/admin/titles/" + encodeURIComponent(state.selectedGameId) +
            "/environments/" + encodeURIComponent(env) + "/config";
          var data = await api("GET", path);
          var config = data && data.config ? data.config : {};
          state.selectedConfig = config;

          if (config.titleStatus) {
            $("statusValue").value = String(config.titleStatus);
          }

          var notify = config.notifyTarget || null;
          $("notifyUrl").value = notify ? String(notify.notifyUrl || "") : "";
          $("notifyHttpKey").value = "";
          $("notifySharedSecret").value = "";
          if (notify && (notify.hasNotifyHttpKey || notify.hasSharedSecret)) {
            setStatus(
              "notifyStatus",
              "Stored notify credentials exist. Enter new values to rotate them.",
              "warn"
            );
          } else {
            setStatus("notifyStatus", "", "");
          }

          var serviceKey = String($("serviceKey").value || "").trim().toLowerCase();
          var service = (config.serviceEndpoints && config.serviceEndpoints[serviceKey]) || null;
          $("serviceBaseUrl").value = service ? String(service.baseUrl || "") : "";
          $("serviceHealthUrl").value = service ? String(service.healthcheckUrl || "") : "";
          $("serviceStatusValue").value = service ? String(service.status || "active") : "active";

          var providerKey = String($("iapProviderKey").value || "").trim().toLowerCase();
          var provider =
            (config.iapProviderConfigs && config.iapProviderConfigs[providerKey]) || null;
          $("iapProviderBaseUrl").value = provider ? String(provider.baseUrl || "") : "";
          $("iapProviderStatusValue").value = provider ? String(provider.status || "active") : "active";
          $("iapProviderClientId").value = "";
          $("iapProviderClientSecret").value = "";
          if (provider && (provider.hasClientId || provider.hasClientSecret)) {
            setStatus(
              "iapProviderStatus",
              "Stored provider credentials exist. Enter new values to rotate them.",
              "warn"
            );
          } else {
            setStatus("iapProviderStatus", "", "");
          }
        } catch (error) {
          setStatus(
            "listStatus",
            "Failed to load current config: " + String(error.message || error),
            "err"
          );
        }
      }

      function renderTitleList() {
        var container = $("titlesList");
        container.innerHTML = "";
        var search = String($("titleSearch").value || "").trim().toLowerCase();
        var summaries = buildTitleSummaries(state.titleRows).filter(function (title) {
          if (!search) {
            return true;
          }
          var haystack = [
            title.gameId,
            title.titleName,
            title.tenantSlug,
            title.tenantName,
            title.environments.join(" ")
          ].join(" ").toLowerCase();
          return haystack.includes(search);
        });
        if (summaries.length === 0) {
          container.innerHTML = "<div class=\\"title-item\\">No titles found.</div>";
          return;
        }
        summaries.forEach(function (title) {
          var el = document.createElement("div");
          el.className = "title-item";
          el.innerHTML =
            "<div class=\\"title-item-head\\">" +
              "<strong>" + escapeClientText(title.titleName) + " (" + escapeClientText(title.gameId) + ")</strong>" +
              "<a href=\\"#title/" + encodeURIComponent(title.gameId) + "/identity\\" data-game-id=\\"" + encodeURIComponent(title.gameId) + "\\" class=\\"open-config\\">Configure</a>" +
            "</div>" +
            "<div class=\\"tiny\\">Tenant: " + escapeClientText(title.tenantName) + " (" + escapeClientText(title.tenantSlug) + ")</div>" +
            "<div class=\\"tiny\\">Title status: " + escapeClientText(title.titleStatus) + "</div>" +
            "<div class=\\"tiny\\">Environments: " + escapeClientText(title.environments.join(", ")) + "</div>";
          container.appendChild(el);
        });
        container.querySelectorAll(".open-config").forEach(function (button) {
          button.addEventListener("click", function (event) {
            event.preventDefault();
            var gameId = decodeURIComponent(String(button.getAttribute("data-game-id") || ""));
            setSelectedGame(gameId);
            window.location.hash = "#title/" + encodeURIComponent(gameId) + "/identity";
          });
        });
      }

      async function loadAdminIdentityAndData() {
        setStatus("authStatus", "Loading admin identity...", "warn");
        var me = await api("GET", "/v1/admin/me");
        state.actor = me.admin_user || null;
        pretty("authOutput", me);
        setStatus("authStatus", "Authenticated.", "ok");
        setAuthed(true);
        $("actorPill").textContent = state.actor
          ? state.actor.email + " - " + state.actor.role
          : "authenticated";
        var titles = await api("GET", "/v1/admin/titles");
        state.titleRows = normalizeTitleRows(titles.titles);
        renderTitleList();
        if (state.selectedGameId) {
          setSelectedGame(state.selectedGameId);
          await loadSelectedTitleConfig();
        }
        setStatus("titleListStatus", "Loaded " + buildTitleSummaries(state.titleRows).length + " titles.", "ok");
      }

      function applyRouteFromHash() {
        if (!state.isAuthed) {
          setTab("titles");
          return;
        }
        var hash = String(window.location.hash || "").trim();
        if (hash.indexOf("#title/") === 0) {
          var routeBits = hash.slice(7).split("/");
          var gameId = decodeURIComponent(routeBits[0] || "");
          var serviceTab = decodeURIComponent(routeBits[1] || "identity");
          if (gameId) {
            setSelectedGame(gameId);
            setConfigureServiceTab(serviceTab);
            loadSelectedTitleConfig();
            setTab("configure");
            return;
          }
        }
        setConfigureServiceTab("identity");
        setTab("titles");
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
        state.actor = null;
        state.titleRows = [];
        state.selectedGameId = "";
        $("actorPill").textContent = "";
        $("titlesList").innerHTML = "";
        setAuthed(false);
        setStatus("authStatus", "Session cleared.", "warn");
      });

      $("loadMe").addEventListener("click", async function () {
        try {
          await loadAdminIdentityAndData();
          applyRouteFromHash();
        } catch (error) {
          setAuthed(false);
          setStatus("authStatus", String(error.message || error), "err");
        }
      });

      $("tabTitles").addEventListener("click", function () {
        window.location.hash = "#titles";
      });

      $("tabConfigure").addEventListener("click", function () {
        if (!state.selectedGameId) {
          setStatus("titleListStatus", "Choose a title first from the Titles tab.", "warn");
          return;
        }
        window.location.hash =
          "#title/" + encodeURIComponent(state.selectedGameId) + "/" + encodeURIComponent(state.configureServiceTab || "identity");
      });

      $("titleSearch").addEventListener("input", function () {
        renderTitleList();
      });

      $("selectedEnvironment").addEventListener("change", function () {
        setSelectedEnvironment($("selectedEnvironment").value);
        loadSelectedTitleConfig();
      });

      $("svcTabIdentity").addEventListener("click", function () {
        if (!state.selectedGameId) {
          setStatus("titleListStatus", "Choose a title first from the Titles tab.", "warn");
          return;
        }
        window.location.hash = "#title/" + encodeURIComponent(state.selectedGameId) + "/identity";
      });

      $("svcTabSave").addEventListener("click", function () {
        if (!state.selectedGameId) {
          setStatus("titleListStatus", "Choose a title first from the Titles tab.", "warn");
          return;
        }
        window.location.hash = "#title/" + encodeURIComponent(state.selectedGameId) + "/save";
      });

      $("svcTabFlags").addEventListener("click", function () {
        if (!state.selectedGameId) {
          setStatus("titleListStatus", "Choose a title first from the Titles tab.", "warn");
          return;
        }
        window.location.hash = "#title/" + encodeURIComponent(state.selectedGameId) + "/flags";
      });

      $("svcTabTelemetry").addEventListener("click", function () {
        if (!state.selectedGameId) {
          setStatus("titleListStatus", "Choose a title first from the Titles tab.", "warn");
          return;
        }
        window.location.hash = "#title/" + encodeURIComponent(state.selectedGameId) + "/telemetry";
      });

      $("svcTabIap").addEventListener("click", function () {
        if (!state.selectedGameId) {
          setStatus("titleListStatus", "Choose a title first from the Titles tab.", "warn");
          return;
        }
        window.location.hash = "#title/" + encodeURIComponent(state.selectedGameId) + "/iap";
      });

      $("identityEditToggle").addEventListener("click", function () {
        setPanelEditMode("identity", !state.editModes.identity);
      });

      $("serviceEditToggle").addEventListener("click", function () {
        setPanelEditMode("service", !state.editModes.service);
      });

      $("iapEditToggle").addEventListener("click", function () {
        setPanelEditMode("iap", !state.editModes.iap);
      });

      $("iapProviderKey").addEventListener("change", function () {
        loadSelectedTitleConfig();
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
          state.selectedGameId = String(body.game_id || "").trim();
          await loadAdminIdentityAndData();
        } catch (error) {
          setStatus("onboardStatus", String(error.message || error), "err");
        }
      });

      $("refreshTitleList").addEventListener("click", async function () {
        try {
          setStatus("titleListStatus", "Refreshing titles...", "warn");
          var data = await api("GET", "/v1/admin/titles");
          state.titleRows = normalizeTitleRows(data.titles);
          renderTitleList();
          if (state.selectedGameId) {
            setSelectedGame(state.selectedGameId);
            await loadSelectedTitleConfig();
          }
          setStatus("titleListStatus", "Titles refreshed.", "ok");
        } catch (error) {
          setStatus("titleListStatus", String(error.message || error), "err");
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
          await loadSelectedTitleConfig();
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
          await loadSelectedTitleConfig();
        } catch (error) {
          setStatus("notifyStatus", String(error.message || error), "err");
        }
      });

      $("upsertServiceEndpoint").addEventListener("click", async function () {
        try {
          var gameId = String($("serviceGameId").value || "").trim();
          var env = String($("serviceEnvironment").value || "").trim();
          var serviceKey = String($("serviceKey").value || "").trim().toLowerCase();
          if (!gameId || !env || !serviceKey) {
            throw new Error("Game ID, environment, and service key are required");
          }
          setStatus("serviceStatus", "Upserting service endpoint...", "warn");
          var path = "/v1/admin/titles/" + encodeURIComponent(gameId) +
            "/environments/" + encodeURIComponent(env) +
            "/services/" + encodeURIComponent(serviceKey);
          var body = {
            base_url: $("serviceBaseUrl").value,
            healthcheck_url: $("serviceHealthUrl").value,
            status: $("serviceStatusValue").value
          };
          var data = await api("PUT", path, body);
          setStatus("serviceStatus", "Service endpoint upserted.", "ok");
          pretty("listOutput", data);
          await loadSelectedTitleConfig();
        } catch (error) {
          setStatus("serviceStatus", String(error.message || error), "err");
        }
      });

      $("upsertIapProvider").addEventListener("click", async function () {
        try {
          var gameId = String($("iapProviderGameId").value || "").trim();
          var env = String($("iapProviderEnvironment").value || "").trim();
          var providerKey = String($("iapProviderKey").value || "").trim().toLowerCase();
          if (!gameId || !env || !providerKey) {
            throw new Error("Game ID, environment, and provider key are required");
          }
          setStatus("iapProviderStatus", "Upserting IAP provider config...", "warn");
          var path = "/v1/admin/titles/" + encodeURIComponent(gameId) +
            "/environments/" + encodeURIComponent(env) +
            "/iap-providers/" + encodeURIComponent(providerKey);
          var body = {
            client_id: $("iapProviderClientId").value,
            client_secret: $("iapProviderClientSecret").value,
            base_url: $("iapProviderBaseUrl").value,
            status: $("iapProviderStatusValue").value
          };
          var data = await api("PUT", path, body);
          setStatus("iapProviderStatus", "IAP provider config upserted.", "ok");
          pretty("listOutput", data);
          await loadSelectedTitleConfig();
        } catch (error) {
          setStatus("iapProviderStatus", String(error.message || error), "err");
        }
      });

      $("refreshTitles").addEventListener("click", async function () {
        try {
          setStatus("listStatus", "Loading titles...", "warn");
          var data = await api("GET", "/v1/admin/titles");
          state.titleRows = normalizeTitleRows(data.titles);
          renderTitleList();
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
        setStatus("authStatus", "Google sign-in succeeded. Authenticating...", "ok");
        loadAdminIdentityAndData()
          .then(function () {
            applyRouteFromHash();
          })
          .catch(function (error) {
            setAuthed(false);
            setStatus("authStatus", String(error.message || error), "err");
          });
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

      window.addEventListener("hashchange", function () {
        applyRouteFromHash();
      });

      setAuthed(false);
      setConfigureServiceTab("identity");
      setPanelEditMode("identity", false);
      setPanelEditMode("service", false);
      setPanelEditMode("iap", false);
      initGoogleSignIn();
      if (savedToken || savedSimpleKey) {
        loadAdminIdentityAndData()
          .then(function () {
            applyRouteFromHash();
          })
          .catch(function () {
            setAuthed(false);
          });
      }
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
