CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS cp_tenants (
  tenant_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_slug TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status IN ('active', 'suspended', 'decommissioned'))
);

CREATE TABLE IF NOT EXISTS cp_titles (
  title_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES cp_tenants(tenant_id) ON DELETE CASCADE,
  game_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  offboarded_at TIMESTAMPTZ,
  CHECK (status IN ('active', 'offboarded', 'suspended'))
);

CREATE INDEX IF NOT EXISTS idx_cp_titles_tenant ON cp_titles (tenant_id);
CREATE INDEX IF NOT EXISTS idx_cp_titles_status ON cp_titles (status);

CREATE TABLE IF NOT EXISTS cp_title_environments (
  title_environment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title_id UUID NOT NULL REFERENCES cp_titles(title_id) ON DELETE CASCADE,
  environment TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (title_id, environment),
  CHECK (environment IN ('staging', 'prod')),
  CHECK (status IN ('active', 'disabled'))
);

CREATE TABLE IF NOT EXISTS cp_service_endpoints (
  service_endpoint_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title_environment_id UUID NOT NULL REFERENCES cp_title_environments(title_environment_id) ON DELETE CASCADE,
  service_key TEXT NOT NULL,
  base_url TEXT NOT NULL,
  healthcheck_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (title_environment_id, service_key),
  CHECK (status IN ('active', 'disabled'))
);

CREATE TABLE IF NOT EXISTS cp_magic_link_notify_targets (
  magic_link_notify_target_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title_environment_id UUID NOT NULL UNIQUE REFERENCES cp_title_environments(title_environment_id) ON DELETE CASCADE,
  notify_url TEXT NOT NULL,
  notify_http_key_secret TEXT NOT NULL,
  shared_secret_secret TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status IN ('active', 'disabled'))
);

CREATE TABLE IF NOT EXISTS cp_feature_flag_versions (
  feature_flag_version_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title_environment_id UUID NOT NULL REFERENCES cp_title_environments(title_environment_id) ON DELETE CASCADE,
  version_number INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  flags JSONB NOT NULL DEFAULT '{}'::jsonb,
  effective_from TIMESTAMPTZ,
  effective_to TIMESTAMPTZ,
  created_by_admin_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (title_environment_id, version_number),
  CHECK (status IN ('draft', 'active', 'archived'))
);

CREATE INDEX IF NOT EXISTS idx_cp_flag_versions_active ON cp_feature_flag_versions (title_environment_id, status, effective_from);

CREATE TABLE IF NOT EXISTS cp_iap_catalog_versions (
  iap_catalog_version_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title_environment_id UUID NOT NULL REFERENCES cp_title_environments(title_environment_id) ON DELETE CASCADE,
  version_number INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  catalog JSONB NOT NULL DEFAULT '{}'::jsonb,
  effective_from TIMESTAMPTZ,
  effective_to TIMESTAMPTZ,
  created_by_admin_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (title_environment_id, version_number),
  CHECK (status IN ('draft', 'active', 'archived'))
);

CREATE INDEX IF NOT EXISTS idx_cp_iap_catalog_versions_active ON cp_iap_catalog_versions (title_environment_id, status, effective_from);

CREATE TABLE IF NOT EXISTS cp_iap_schedules (
  iap_schedule_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title_environment_id UUID NOT NULL REFERENCES cp_title_environments(title_environment_id) ON DELETE CASCADE,
  schedule_name TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'active',
  created_by_admin_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status IN ('active', 'disabled'))
);

CREATE INDEX IF NOT EXISTS idx_cp_iap_schedules_range ON cp_iap_schedules (title_environment_id, status, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS cp_admin_users (
  admin_user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'viewer',
  status TEXT NOT NULL DEFAULT 'active',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ,
  CHECK (role IN ('platform_owner', 'platform_admin', 'viewer')),
  CHECK (status IN ('active', 'disabled'))
);

CREATE TABLE IF NOT EXISTS cp_admin_user_tenants (
  admin_user_id UUID NOT NULL REFERENCES cp_admin_users(admin_user_id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES cp_tenants(tenant_id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'tenant_admin',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (admin_user_id, tenant_id),
  CHECK (role IN ('tenant_admin', 'tenant_viewer'))
);

CREATE TABLE IF NOT EXISTS cp_audit_log (
  audit_id BIGSERIAL PRIMARY KEY,
  request_id TEXT NOT NULL DEFAULT '',
  actor_admin_user_id UUID REFERENCES cp_admin_users(admin_user_id) ON DELETE SET NULL,
  actor_email TEXT NOT NULL DEFAULT '',
  action_key TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  tenant_id UUID REFERENCES cp_tenants(tenant_id) ON DELETE SET NULL,
  title_id UUID REFERENCES cp_titles(title_id) ON DELETE SET NULL,
  environment TEXT NOT NULL DEFAULT '',
  old_value JSONB,
  new_value JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_ip TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cp_audit_actor ON cp_audit_log (actor_admin_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cp_audit_title_env ON cp_audit_log (title_id, environment, created_at DESC);

CREATE TABLE IF NOT EXISTS cp_service_events (
  service_event_id BIGSERIAL PRIMARY KEY,
  request_id TEXT NOT NULL DEFAULT '',
  service_key TEXT NOT NULL,
  game_id TEXT NOT NULL DEFAULT '',
  environment TEXT NOT NULL DEFAULT '',
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  event_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (severity IN ('debug', 'info', 'warn', 'error'))
);

CREATE INDEX IF NOT EXISTS idx_cp_service_events_lookup ON cp_service_events (service_key, game_id, environment, created_at DESC);
