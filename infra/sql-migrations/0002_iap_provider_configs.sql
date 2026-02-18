CREATE TABLE IF NOT EXISTS cp_iap_provider_configs (
  iap_provider_config_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title_environment_id UUID NOT NULL REFERENCES cp_title_environments(title_environment_id) ON DELETE CASCADE,
  provider_key TEXT NOT NULL,
  client_id_secret TEXT NOT NULL DEFAULT '',
  client_secret_secret TEXT NOT NULL DEFAULT '',
  base_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (title_environment_id, provider_key),
  CHECK (status IN ('active', 'disabled'))
);

CREATE INDEX IF NOT EXISTS idx_cp_iap_provider_configs_lookup
  ON cp_iap_provider_configs (title_environment_id, provider_key, status);
