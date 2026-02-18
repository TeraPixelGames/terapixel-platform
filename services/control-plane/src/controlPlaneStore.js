import { createSecretCrypto } from "../../../packages/shared-utils/index.js";

export class PostgresControlPlaneStore {
  constructor(options = {}) {
    this._pool = options.pool;
    if (!this._pool || typeof this._pool.query !== "function") {
      throw new Error("PostgresControlPlaneStore requires pool.query");
    }
    this._crypto = createSecretCrypto({
      encryptionKey: String(options.encryptionKey || "")
    });
  }

  async close() {
    if (typeof this._pool.end === "function") {
      await this._pool.end();
    }
  }

  async upsertAdminUserFromGoogle(input = {}) {
    const googleSub = String(input.googleSub || "").trim();
    const email = normalizeEmail(input.email);
    const displayName = String(input.displayName || "").trim();
    const bootstrapEmails = new Set(
      (input.bootstrapEmails || []).map((it) => normalizeEmail(it)).filter(Boolean)
    );
    if (!googleSub || !email) {
      throw new Error("googleSub and email are required");
    }
    const existing = await this._pool.query(
      `
      SELECT admin_user_id, google_sub, email, display_name, role, status
      FROM cp_admin_users
      WHERE google_sub = $1 OR email = $2
      LIMIT 1
    `,
      [googleSub, email]
    );
    const row = existing.rows[0];
    if (row) {
      if (row.status !== "active") {
        return null;
      }
      await this._pool.query(
        `
        UPDATE cp_admin_users
        SET google_sub = $2,
            email = $3,
            display_name = $4,
            last_login_at = NOW(),
            updated_at = NOW()
        WHERE admin_user_id = $1
      `,
        [row.admin_user_id, googleSub, email, displayName]
      );
      return {
        adminUserId: row.admin_user_id,
        googleSub,
        email,
        displayName,
        role: row.role
      };
    }

    if (!bootstrapEmails.has(email)) {
      return null;
    }
    const inserted = await this._pool.query(
      `
      INSERT INTO cp_admin_users (google_sub, email, display_name, role, status, last_login_at)
      VALUES ($1, $2, $3, 'platform_owner', 'active', NOW())
      RETURNING admin_user_id, role
    `,
      [googleSub, email, displayName]
    );
    return {
      adminUserId: inserted.rows[0].admin_user_id,
      googleSub,
      email,
      displayName,
      role: inserted.rows[0].role
    };
  }

  async listTitles() {
    const result = await this._pool.query(`
      SELECT
        t.title_id,
        t.game_id,
        t.display_name AS title_name,
        t.status AS title_status,
        t.metadata AS title_metadata,
        t.created_at AS title_created_at,
        t.updated_at AS title_updated_at,
        tn.tenant_id,
        tn.tenant_slug,
        tn.display_name AS tenant_name,
        te.title_environment_id,
        te.environment,
        te.status AS environment_status,
        te.metadata AS environment_metadata,
        ml.notify_url,
        ml.status AS notify_status
      FROM cp_titles t
      JOIN cp_tenants tn ON tn.tenant_id = t.tenant_id
      LEFT JOIN cp_title_environments te ON te.title_id = t.title_id
      LEFT JOIN cp_magic_link_notify_targets ml ON ml.title_environment_id = te.title_environment_id
      ORDER BY tn.tenant_slug ASC, t.game_id ASC, te.environment ASC
    `);
    const out = [];
    for (const row of result.rows) {
      out.push({
        titleId: row.title_id,
        gameId: row.game_id,
        titleName: row.title_name,
        titleStatus: row.title_status,
        titleMetadata: row.title_metadata || {},
        tenantId: row.tenant_id,
        tenantSlug: row.tenant_slug,
        tenantName: row.tenant_name,
        titleCreatedAt: asIso(row.title_created_at),
        titleUpdatedAt: asIso(row.title_updated_at),
        environmentId: row.title_environment_id || "",
        environment: row.environment || "",
        environmentStatus: row.environment_status || "",
        environmentMetadata: row.environment_metadata || {},
        notifyUrl: row.notify_url || "",
        notifyStatus: row.notify_status || ""
      });
    }
    return out;
  }

  async getTitleEnvironmentConfig(input = {}) {
    const envRow = await this._findEnvironment(input.gameId, input.environment);
    const [statusResult, notifyResult, servicesResult, iapProvidersResult] =
      await Promise.all([
        this._pool.query(
          `
          SELECT t.status AS title_status, te.status AS environment_status
          FROM cp_titles t
          JOIN cp_title_environments te ON te.title_id = t.title_id
          WHERE te.title_environment_id = $1
          LIMIT 1
        `,
          [envRow.titleEnvironmentId]
        ),
        this._pool.query(
          `
          SELECT notify_url, status, metadata, notify_http_key_secret, shared_secret_secret
          FROM cp_magic_link_notify_targets
          WHERE title_environment_id = $1
          LIMIT 1
        `,
          [envRow.titleEnvironmentId]
        ),
        this._pool.query(
          `
          SELECT service_key, base_url, healthcheck_url, status, metadata
          FROM cp_service_endpoints
          WHERE title_environment_id = $1
          ORDER BY service_key ASC
        `,
          [envRow.titleEnvironmentId]
        ),
        this._pool.query(
          `
          SELECT provider_key, base_url, status, metadata, client_id_secret, client_secret_secret
          FROM cp_iap_provider_configs
          WHERE title_environment_id = $1
          ORDER BY provider_key ASC
        `,
          [envRow.titleEnvironmentId]
        )
      ]);

    const notifyRow = notifyResult.rows[0];
    const notifyTarget = notifyRow
      ? {
          notifyUrl: String(notifyRow.notify_url || "").trim(),
          status: String(notifyRow.status || "").trim(),
          metadata: normalizeObject(notifyRow.metadata),
          hasNotifyHttpKey: !!String(notifyRow.notify_http_key_secret || "").trim(),
          hasSharedSecret: !!String(notifyRow.shared_secret_secret || "").trim()
        }
      : null;

    const serviceEndpoints = {};
    for (const row of servicesResult.rows) {
      const serviceKey = normalizeServiceKey(row.service_key);
      serviceEndpoints[serviceKey] = {
        baseUrl: String(row.base_url || "").trim(),
        healthcheckUrl: String(row.healthcheck_url || "").trim(),
        status: String(row.status || "").trim(),
        metadata: normalizeObject(row.metadata)
      };
    }

    const iapProviderConfigs = {};
    for (const row of iapProvidersResult.rows) {
      const providerKey = normalizeProviderKey(row.provider_key);
      iapProviderConfigs[providerKey] = {
        baseUrl: String(row.base_url || "").trim(),
        status: String(row.status || "").trim(),
        metadata: normalizeObject(row.metadata),
        hasClientId: !!String(row.client_id_secret || "").trim(),
        hasClientSecret: !!String(row.client_secret_secret || "").trim()
      };
    }

    return {
      gameId: envRow.gameId,
      environment: envRow.environment,
      titleStatus: String(statusResult.rows[0]?.title_status || "").trim(),
      environmentStatus: String(statusResult.rows[0]?.environment_status || "").trim(),
      notifyTarget,
      serviceEndpoints,
      iapProviderConfigs
    };
  }

  async onboardTitle(input = {}) {
    const tenantSlug = normalizeSlug(input.tenantSlug);
    const tenantName = String(input.tenantName || "").trim();
    const gameId = normalizeSlug(input.gameId);
    const titleName = String(input.titleName || "").trim();
    const environments = normalizeEnvironments(input.environments);
    if (!tenantSlug || !tenantName || !gameId || !titleName) {
      throw new Error("tenantSlug, tenantName, gameId, and titleName are required");
    }

    const client = await this._pool.connect();
    try {
      await client.query("BEGIN");
      const tenant = await client.query(
        `
        INSERT INTO cp_tenants (tenant_slug, display_name, status)
        VALUES ($1, $2, 'active')
        ON CONFLICT (tenant_slug)
        DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = NOW()
        RETURNING tenant_id, tenant_slug, display_name
      `,
        [tenantSlug, tenantName]
      );
      const tenantId = tenant.rows[0].tenant_id;

      const title = await client.query(
        `
        INSERT INTO cp_titles (tenant_id, game_id, display_name, status)
        VALUES ($1, $2, $3, 'active')
        ON CONFLICT (game_id)
        DO UPDATE SET tenant_id = EXCLUDED.tenant_id,
                      display_name = EXCLUDED.display_name,
                      status = 'active',
                      offboarded_at = NULL,
                      updated_at = NOW()
        RETURNING title_id, game_id, display_name, status
      `,
        [tenantId, gameId, titleName]
      );
      const titleId = title.rows[0].title_id;

      for (const env of environments) {
        await client.query(
          `
          INSERT INTO cp_title_environments (title_id, environment, status)
          VALUES ($1, $2, 'active')
          ON CONFLICT (title_id, environment)
          DO UPDATE SET status = 'active', updated_at = NOW()
        `,
          [titleId, env]
        );
      }
      await client.query("COMMIT");
      return {
        tenantId,
        tenantSlug,
        tenantName,
        titleId,
        gameId,
        titleName,
        environments
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async setTitleStatus(input = {}) {
    const gameId = normalizeSlug(input.gameId);
    const status = normalizeTitleStatus(input.status);
    if (!gameId || !status) {
      throw new Error("gameId and status are required");
    }
    const result = await this._pool.query(
      `
      UPDATE cp_titles
      SET status = $2,
          offboarded_at = CASE WHEN $2 = 'offboarded' THEN NOW() ELSE NULL END,
          updated_at = NOW()
      WHERE game_id = $1
      RETURNING title_id, game_id, display_name, status, offboarded_at
    `,
      [gameId, status]
    );
    if (!result.rows.length) {
      throw new Error("title not found");
    }
    return {
      titleId: result.rows[0].title_id,
      gameId: result.rows[0].game_id,
      titleName: result.rows[0].display_name,
      status: result.rows[0].status,
      offboardedAt: asIso(result.rows[0].offboarded_at)
    };
  }

  async upsertServiceEndpoint(input = {}) {
    const envRow = await this._findEnvironment(input.gameId, input.environment);
    const serviceKey = normalizeServiceKey(input.serviceKey);
    const baseUrl = String(input.baseUrl || "").trim();
    const healthcheckUrl = String(input.healthcheckUrl || "").trim();
    const status = normalizeOnOffStatus(input.status || "active");
    const metadata = normalizeObject(input.metadata);
    if (!serviceKey || !baseUrl) {
      throw new Error("serviceKey and baseUrl are required");
    }
    const result = await this._pool.query(
      `
      INSERT INTO cp_service_endpoints (
        title_environment_id,
        service_key,
        base_url,
        healthcheck_url,
        status,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
      ON CONFLICT (title_environment_id, service_key)
      DO UPDATE SET base_url = EXCLUDED.base_url,
                    healthcheck_url = EXCLUDED.healthcheck_url,
                    status = EXCLUDED.status,
                    metadata = EXCLUDED.metadata,
                    updated_at = NOW()
      RETURNING service_endpoint_id
    `,
      [
        envRow.titleEnvironmentId,
        serviceKey,
        baseUrl,
        healthcheckUrl,
        status,
        JSON.stringify(metadata)
      ]
    );
    return {
      serviceEndpointId: result.rows[0].service_endpoint_id,
      gameId: envRow.gameId,
      environment: envRow.environment,
      serviceKey,
      baseUrl,
      healthcheckUrl,
      status,
      metadata
    };
  }

  async upsertMagicLinkNotifyTarget(input = {}) {
    const envRow = await this._findEnvironment(input.gameId, input.environment);
    const notifyUrl = String(input.notifyUrl || "").trim();
    const notifyHttpKey = String(input.notifyHttpKey || "").trim();
    const sharedSecret = String(input.sharedSecret || "").trim();
    const status = normalizeOnOffStatus(input.status || "active");
    const metadata = normalizeObject(input.metadata);
    if (!notifyUrl) {
      throw new Error("notifyUrl is required");
    }
    if (!notifyHttpKey || !sharedSecret) {
      throw new Error("notifyHttpKey and sharedSecret are required");
    }
    const encryptedHttpKey = this._crypto.encrypt(notifyHttpKey);
    const encryptedSharedSecret = this._crypto.encrypt(sharedSecret);
    const result = await this._pool.query(
      `
      INSERT INTO cp_magic_link_notify_targets (
        title_environment_id,
        notify_url,
        notify_http_key_secret,
        shared_secret_secret,
        status,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
      ON CONFLICT (title_environment_id)
      DO UPDATE SET notify_url = EXCLUDED.notify_url,
                    notify_http_key_secret = EXCLUDED.notify_http_key_secret,
                    shared_secret_secret = EXCLUDED.shared_secret_secret,
                    status = EXCLUDED.status,
                    metadata = EXCLUDED.metadata,
                    updated_at = NOW()
      RETURNING magic_link_notify_target_id
    `,
      [
        envRow.titleEnvironmentId,
        notifyUrl,
        encryptedHttpKey,
        encryptedSharedSecret,
        status,
        JSON.stringify(metadata)
      ]
    );
    return {
      magicLinkNotifyTargetId: result.rows[0].magic_link_notify_target_id,
      gameId: envRow.gameId,
      environment: envRow.environment,
      notifyUrl,
      status,
      metadata
    };
  }

  async publishFeatureFlagsVersion(input = {}) {
    const envRow = await this._findEnvironment(input.gameId, input.environment);
    const flags = normalizeObject(input.flags);
    const status = normalizeVersionStatus(input.status || "active");
    const effectiveFrom = toNullableIso(input.effectiveFrom);
    const effectiveTo = toNullableIso(input.effectiveTo);
    const nextVersion = await this._nextVersionNumber(
      "cp_feature_flag_versions",
      envRow.titleEnvironmentId
    );
    const result = await this._pool.query(
      `
      INSERT INTO cp_feature_flag_versions (
        title_environment_id,
        version_number,
        status,
        flags,
        effective_from,
        effective_to,
        created_by_admin_user_id
      )
      VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)
      RETURNING feature_flag_version_id
    `,
      [
        envRow.titleEnvironmentId,
        nextVersion,
        status,
        JSON.stringify(flags),
        effectiveFrom,
        effectiveTo,
        toNullableUuid(input.createdByAdminUserId)
      ]
    );
    return {
      featureFlagVersionId: result.rows[0].feature_flag_version_id,
      gameId: envRow.gameId,
      environment: envRow.environment,
      versionNumber: nextVersion,
      status,
      flags,
      effectiveFrom,
      effectiveTo
    };
  }

  async publishIapCatalogVersion(input = {}) {
    const envRow = await this._findEnvironment(input.gameId, input.environment);
    const catalog = normalizeObject(input.catalog);
    const status = normalizeVersionStatus(input.status || "active");
    const effectiveFrom = toNullableIso(input.effectiveFrom);
    const effectiveTo = toNullableIso(input.effectiveTo);
    const nextVersion = await this._nextVersionNumber(
      "cp_iap_catalog_versions",
      envRow.titleEnvironmentId
    );
    const result = await this._pool.query(
      `
      INSERT INTO cp_iap_catalog_versions (
        title_environment_id,
        version_number,
        status,
        catalog,
        effective_from,
        effective_to,
        created_by_admin_user_id
      )
      VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)
      RETURNING iap_catalog_version_id
    `,
      [
        envRow.titleEnvironmentId,
        nextVersion,
        status,
        JSON.stringify(catalog),
        effectiveFrom,
        effectiveTo,
        toNullableUuid(input.createdByAdminUserId)
      ]
    );
    return {
      iapCatalogVersionId: result.rows[0].iap_catalog_version_id,
      gameId: envRow.gameId,
      environment: envRow.environment,
      versionNumber: nextVersion,
      status,
      catalog,
      effectiveFrom,
      effectiveTo
    };
  }

  async upsertIapSchedule(input = {}) {
    const envRow = await this._findEnvironment(input.gameId, input.environment);
    const scheduleName = String(input.scheduleName || "").trim();
    const startsAt = toRequiredIso(input.startsAt, "startsAt is required");
    const endsAt = toNullableIso(input.endsAt);
    const payload = normalizeObject(input.payload);
    const status = normalizeOnOffStatus(input.status || "active");
    if (!scheduleName) {
      throw new Error("scheduleName is required");
    }
    const result = await this._pool.query(
      `
      INSERT INTO cp_iap_schedules (
        title_environment_id,
        schedule_name,
        starts_at,
        ends_at,
        payload,
        status,
        created_by_admin_user_id
      )
      VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
      RETURNING iap_schedule_id
    `,
      [
        envRow.titleEnvironmentId,
        scheduleName,
        startsAt,
        endsAt,
        JSON.stringify(payload),
        status,
        toNullableUuid(input.createdByAdminUserId)
      ]
    );
    return {
      iapScheduleId: result.rows[0].iap_schedule_id,
      gameId: envRow.gameId,
      environment: envRow.environment,
      scheduleName,
      startsAt,
      endsAt,
      payload,
      status
    };
  }

  async upsertIapProviderConfig(input = {}) {
    const envRow = await this._findEnvironment(input.gameId, input.environment);
    const providerKey = normalizeProviderKey(input.providerKey);
    const status = normalizeOnOffStatus(input.status || "active");
    const metadata = normalizeObject(input.metadata);
    if (!providerKey) {
      throw new Error("providerKey is required");
    }

    const existing = await this._pool.query(
      `
      SELECT client_id_secret, client_secret_secret, base_url
      FROM cp_iap_provider_configs
      WHERE title_environment_id = $1 AND provider_key = $2
      LIMIT 1
    `,
      [envRow.titleEnvironmentId, providerKey]
    );
    const row = existing.rows[0] || {};
    const existingClientId = row.client_id_secret
      ? this._crypto.decrypt(String(row.client_id_secret || ""))
      : "";
    const existingClientSecret = row.client_secret_secret
      ? this._crypto.decrypt(String(row.client_secret_secret || ""))
      : "";
    const existingBaseUrl = String(row.base_url || "").trim();

    const suppliedClientId = String(input.clientId || "").trim();
    const suppliedClientSecret = String(input.clientSecret || "").trim();
    const suppliedBaseUrl = String(input.baseUrl || "").trim();

    const resolvedClientId = suppliedClientId || existingClientId;
    const resolvedClientSecret = suppliedClientSecret || existingClientSecret;
    const resolvedBaseUrl = suppliedBaseUrl || existingBaseUrl;

    if (status === "active" && (!resolvedClientId || !resolvedClientSecret)) {
      throw new Error("clientId and clientSecret are required for active iap provider");
    }

    const encryptedClientId = resolvedClientId
      ? this._crypto.encrypt(resolvedClientId)
      : "";
    const encryptedClientSecret = resolvedClientSecret
      ? this._crypto.encrypt(resolvedClientSecret)
      : "";

    const result = await this._pool.query(
      `
      INSERT INTO cp_iap_provider_configs (
        title_environment_id,
        provider_key,
        client_id_secret,
        client_secret_secret,
        base_url,
        status,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
      ON CONFLICT (title_environment_id, provider_key)
      DO UPDATE SET client_id_secret = EXCLUDED.client_id_secret,
                    client_secret_secret = EXCLUDED.client_secret_secret,
                    base_url = EXCLUDED.base_url,
                    status = EXCLUDED.status,
                    metadata = EXCLUDED.metadata,
                    updated_at = NOW()
      RETURNING iap_provider_config_id
    `,
      [
        envRow.titleEnvironmentId,
        providerKey,
        encryptedClientId,
        encryptedClientSecret,
        resolvedBaseUrl,
        status,
        JSON.stringify(metadata)
      ]
    );
    return {
      iapProviderConfigId: result.rows[0].iap_provider_config_id,
      gameId: envRow.gameId,
      environment: envRow.environment,
      providerKey,
      baseUrl: resolvedBaseUrl,
      status,
      metadata,
      hasClientId: !!resolvedClientId,
      hasClientSecret: !!resolvedClientSecret
    };
  }

  async getRuntimeIdentityConfig(input = {}) {
    const env = normalizeEnvironment(input.environment || "prod");
    const gameId = normalizeSlug(input.gameId);
    if (!gameId) {
      throw new Error("gameId is required");
    }
    const rows = await this._pool.query(
      `
      SELECT
        t.game_id,
        te.environment,
        te.metadata AS environment_metadata,
        tn.tenant_slug,
        ml.notify_url,
        ml.notify_http_key_secret,
        ml.shared_secret_secret,
        ml.status AS notify_status
      FROM cp_titles t
      JOIN cp_title_environments te ON te.title_id = t.title_id
      JOIN cp_tenants tn ON tn.tenant_id = t.tenant_id
      LEFT JOIN cp_magic_link_notify_targets ml ON ml.title_environment_id = te.title_environment_id
      WHERE t.game_id = $1
        AND te.environment = $2
        AND t.status = 'active'
        AND te.status = 'active'
      LIMIT 1
    `,
      [gameId, env]
    );
    const row = rows.rows[0];
    if (!row) {
      return null;
    }
    const environmentMetadata = normalizeObject(row.environment_metadata);
    const notifyActive = row.notify_url && row.notify_status === "active";
    const notifyTarget = notifyActive
      ? {
          notifyUrl: String(row.notify_url || ""),
          notifyHttpKey: this._crypto.decrypt(String(row.notify_http_key_secret || "")),
          sharedSecret: this._crypto.decrypt(String(row.shared_secret_secret || ""))
        }
      : null;

    const flags = await this._getActiveFeatureFlags(gameId, env);
    const iapCatalog = await this._getActiveIapCatalog(gameId, env);
    const iapSchedules = await this._getActiveIapSchedules(gameId, env);
    const iapProviderConfigs = await this._getActiveIapProviderConfigs(gameId, env);
    const serviceEndpoints = await this._getActiveServiceEndpoints(gameId, env);
    return {
      gameId,
      environment: env,
      tenantSlug: row.tenant_slug,
      environmentMetadata,
      notifyTarget,
      serviceEndpoints,
      featureFlags: flags,
      iapCatalog,
      iapSchedules,
      iapProviderConfigs
    };
  }

  async recordServiceEvent(input = {}) {
    const result = await this._pool.query(
      `
      INSERT INTO cp_service_events (
        request_id,
        service_key,
        game_id,
        environment,
        event_type,
        severity,
        event_payload
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
      RETURNING service_event_id, created_at
    `,
      [
        String(input.requestId || "").trim(),
        normalizeServiceKey(input.serviceKey),
        normalizeSlug(input.gameId || ""),
        normalizeEnvironment(input.environment || "prod"),
        String(input.eventType || "").trim(),
        normalizeSeverity(input.severity || "info"),
        JSON.stringify(normalizeObject(input.eventPayload))
      ]
    );
    return {
      serviceEventId: result.rows[0].service_event_id,
      createdAt: asIso(result.rows[0].created_at)
    };
  }

  async listServiceEvents(filters = {}) {
    const limit = clampInt(filters.limit, 100, 1, 500);
    const values = [];
    const where = [];
    if (filters.serviceKey) {
      values.push(normalizeServiceKey(filters.serviceKey));
      where.push(`service_key = $${values.length}`);
    }
    if (filters.gameId) {
      values.push(normalizeSlug(filters.gameId));
      where.push(`game_id = $${values.length}`);
    }
    if (filters.environment) {
      values.push(normalizeEnvironment(filters.environment));
      where.push(`environment = $${values.length}`);
    }
    const sql = `
      SELECT service_event_id, request_id, service_key, game_id, environment, event_type, severity, event_payload, created_at
      FROM cp_service_events
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY service_event_id DESC
      LIMIT ${limit}
    `;
    const result = await this._pool.query(sql, values);
    return result.rows.map((row) => ({
      serviceEventId: row.service_event_id,
      requestId: row.request_id,
      serviceKey: row.service_key,
      gameId: row.game_id,
      environment: row.environment,
      eventType: row.event_type,
      severity: row.severity,
      eventPayload: row.event_payload || {},
      createdAt: asIso(row.created_at)
    }));
  }

  async writeAudit(input = {}) {
    await this._pool.query(
      `
      INSERT INTO cp_audit_log (
        request_id,
        actor_admin_user_id,
        actor_email,
        action_key,
        resource_type,
        resource_id,
        tenant_id,
        title_id,
        environment,
        old_value,
        new_value,
        metadata,
        source_ip,
        user_agent
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13,$14)
    `,
      [
        String(input.requestId || "").trim(),
        toNullableUuid(input.actorAdminUserId),
        normalizeEmail(input.actorEmail || ""),
        String(input.actionKey || "").trim(),
        String(input.resourceType || "").trim(),
        String(input.resourceId || "").trim(),
        toNullableUuid(input.tenantId),
        toNullableUuid(input.titleId),
        String(input.environment || "").trim(),
        JSON.stringify(input.oldValue || null),
        JSON.stringify(input.newValue || null),
        JSON.stringify(normalizeObject(input.metadata)),
        String(input.sourceIp || "").trim(),
        String(input.userAgent || "").trim()
      ]
    );
  }

  async _findEnvironment(gameId, environment) {
    const result = await this._pool.query(
      `
      SELECT
        t.title_id,
        t.game_id,
        t.tenant_id,
        te.title_environment_id,
        te.environment
      FROM cp_titles t
      JOIN cp_title_environments te ON te.title_id = t.title_id
      WHERE t.game_id = $1 AND te.environment = $2
      LIMIT 1
    `,
      [normalizeSlug(gameId), normalizeEnvironment(environment)]
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error("title environment not found");
    }
    return {
      titleId: row.title_id,
      titleEnvironmentId: row.title_environment_id,
      tenantId: row.tenant_id,
      gameId: row.game_id,
      environment: row.environment
    };
  }

  async _nextVersionNumber(tableName, titleEnvironmentId) {
    const result = await this._pool.query(
      `SELECT COALESCE(MAX(version_number), 0) AS current FROM ${tableName} WHERE title_environment_id = $1`,
      [titleEnvironmentId]
    );
    return Number(result.rows[0]?.current || 0) + 1;
  }

  async _getActiveFeatureFlags(gameId, environment) {
    const row = await this._pool.query(
      `
      SELECT ff.flags
      FROM cp_feature_flag_versions ff
      JOIN cp_title_environments te ON te.title_environment_id = ff.title_environment_id
      JOIN cp_titles t ON t.title_id = te.title_id
      WHERE t.game_id = $1
        AND te.environment = $2
        AND ff.status = 'active'
        AND (ff.effective_from IS NULL OR ff.effective_from <= NOW())
        AND (ff.effective_to IS NULL OR ff.effective_to > NOW())
      ORDER BY ff.version_number DESC
      LIMIT 1
    `,
      [normalizeSlug(gameId), normalizeEnvironment(environment)]
    );
    return row.rows[0]?.flags || {};
  }

  async _getActiveIapCatalog(gameId, environment) {
    const row = await this._pool.query(
      `
      SELECT ic.catalog
      FROM cp_iap_catalog_versions ic
      JOIN cp_title_environments te ON te.title_environment_id = ic.title_environment_id
      JOIN cp_titles t ON t.title_id = te.title_id
      WHERE t.game_id = $1
        AND te.environment = $2
        AND ic.status = 'active'
        AND (ic.effective_from IS NULL OR ic.effective_from <= NOW())
        AND (ic.effective_to IS NULL OR ic.effective_to > NOW())
      ORDER BY ic.version_number DESC
      LIMIT 1
    `,
      [normalizeSlug(gameId), normalizeEnvironment(environment)]
    );
    return row.rows[0]?.catalog || {};
  }

  async _getActiveIapSchedules(gameId, environment) {
    const rows = await this._pool.query(
      `
      SELECT s.schedule_name, s.starts_at, s.ends_at, s.payload, s.status
      FROM cp_iap_schedules s
      JOIN cp_title_environments te ON te.title_environment_id = s.title_environment_id
      JOIN cp_titles t ON t.title_id = te.title_id
      WHERE t.game_id = $1
        AND te.environment = $2
        AND s.status = 'active'
        AND s.starts_at <= NOW()
        AND (s.ends_at IS NULL OR s.ends_at > NOW())
      ORDER BY s.starts_at DESC
      LIMIT 50
    `,
      [normalizeSlug(gameId), normalizeEnvironment(environment)]
    );
    return rows.rows.map((row) => ({
      scheduleName: row.schedule_name,
      startsAt: asIso(row.starts_at),
      endsAt: asIso(row.ends_at),
      status: row.status,
      payload: row.payload || {}
    }));
  }

  async _getActiveIapProviderConfigs(gameId, environment) {
    const rows = await this._pool.query(
      `
      SELECT p.provider_key, p.client_id_secret, p.client_secret_secret, p.base_url
      FROM cp_iap_provider_configs p
      JOIN cp_title_environments te ON te.title_environment_id = p.title_environment_id
      JOIN cp_titles t ON t.title_id = te.title_id
      WHERE t.game_id = $1
        AND te.environment = $2
        AND p.status = 'active'
      ORDER BY p.provider_key ASC
    `,
      [normalizeSlug(gameId), normalizeEnvironment(environment)]
    );
    const out = {};
    for (const row of rows.rows) {
      const providerKey = String(row.provider_key || "").trim().toLowerCase();
      if (!providerKey) {
        continue;
      }
      out[providerKey] = {
        clientId: this._crypto.decrypt(String(row.client_id_secret || "")),
        clientSecret: this._crypto.decrypt(String(row.client_secret_secret || "")),
        baseUrl: String(row.base_url || "").trim()
      };
    }
    return out;
  }

  async _getActiveServiceEndpoints(gameId, environment) {
    const rows = await this._pool.query(
      `
      SELECT se.service_key, se.base_url, se.healthcheck_url, se.metadata
      FROM cp_service_endpoints se
      JOIN cp_title_environments te ON te.title_environment_id = se.title_environment_id
      JOIN cp_titles t ON t.title_id = te.title_id
      WHERE t.game_id = $1
        AND te.environment = $2
        AND se.status = 'active'
      ORDER BY se.service_key ASC
    `,
      [normalizeSlug(gameId), normalizeEnvironment(environment)]
    );
    const out = {};
    for (const row of rows.rows) {
      const serviceKey = String(row.service_key || "").trim().toLowerCase();
      if (!serviceKey) {
        continue;
      }
      out[serviceKey] = {
        baseUrl: String(row.base_url || "").trim(),
        healthcheckUrl: String(row.healthcheck_url || "").trim(),
        metadata: normalizeObject(row.metadata)
      };
    }
    return out;
  }
}

function normalizeSlug(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_");
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeEnvironment(value) {
  const env = String(value || "").trim().toLowerCase();
  if (env === "staging" || env === "prod") {
    return env;
  }
  throw new Error("environment must be staging or prod");
}

function normalizeEnvironments(values) {
  const input = Array.isArray(values) ? values : ["staging", "prod"];
  const out = [];
  for (const value of input) {
    const env = normalizeEnvironment(value);
    if (!out.includes(env)) {
      out.push(env);
    }
  }
  return out;
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

function normalizeTitleStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  if (status === "active" || status === "offboarded" || status === "suspended") {
    return status;
  }
  throw new Error("status must be active, offboarded, or suspended");
}

function normalizeVersionStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  if (status === "draft" || status === "active" || status === "archived") {
    return status;
  }
  throw new Error("status must be draft, active, or archived");
}

function normalizeSeverity(value) {
  const severity = String(value || "").trim().toLowerCase();
  if (["debug", "info", "warn", "error"].includes(severity)) {
    return severity;
  }
  throw new Error("severity must be debug, info, warn, or error");
}

function normalizeObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return { ...value };
}

function toNullableIso(value) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("invalid datetime value");
  }
  return date.toISOString();
}

function toRequiredIso(value, message) {
  const out = toNullableIso(value);
  if (!out) {
    throw new Error(message);
  }
  return out;
}

function toNullableUuid(value) {
  const text = String(value || "").trim();
  return text || null;
}

function asIso(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toISOString();
}

function clampInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}
