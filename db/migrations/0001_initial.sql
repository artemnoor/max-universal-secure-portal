BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  checksum TEXT
);

CREATE TABLE IF NOT EXISTS portal_users (
  user_id BIGINT PRIMARY KEY,
  chat_id BIGINT,
  first_name TEXT,
  last_name TEXT,
  username TEXT,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  phone_ciphertext TEXT,
  phone_nonce TEXT,
  phone_auth_tag TEXT,
  phone_key_version INTEGER,
  location_ciphertext TEXT,
  location_nonce TEXT,
  location_auth_tag TEXT,
  location_key_version INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((phone_ciphertext IS NULL AND phone_nonce IS NULL AND phone_auth_tag IS NULL AND phone_key_version IS NULL)
    OR (phone_ciphertext IS NOT NULL AND phone_nonce IS NOT NULL AND phone_auth_tag IS NOT NULL AND phone_key_version IS NOT NULL)),
  CHECK ((location_ciphertext IS NULL AND location_nonce IS NULL AND location_auth_tag IS NULL AND location_key_version IS NULL)
    OR (location_ciphertext IS NOT NULL AND location_nonce IS NOT NULL AND location_auth_tag IS NOT NULL AND location_key_version IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS portal_users_chat_id_idx ON portal_users (chat_id);
CREATE INDEX IF NOT EXISTS portal_users_updated_at_idx ON portal_users (updated_at);

CREATE TABLE IF NOT EXISTS conversation_states (
  user_id BIGINT PRIMARY KEY REFERENCES portal_users(user_id) ON DELETE CASCADE,
  state JSONB NOT NULL DEFAULT '{}'::jsonb,
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  expires_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (jsonb_typeof(state) = 'object')
);

CREATE INDEX IF NOT EXISTS conversation_states_expires_at_idx ON conversation_states (expires_at)
  WHERE expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS saved_items (
  user_id BIGINT NOT NULL REFERENCES portal_users(user_id) ON DELETE CASCADE,
  item_kind TEXT NOT NULL CHECK (item_kind ~ '^[a-z][a-z0-9_-]{0,31}$'),
  item_id TEXT NOT NULL,
  bucket TEXT NOT NULL DEFAULT 'default' CHECK (bucket IN ('primary', 'alternative', 'default')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, item_kind, item_id)
);

CREATE INDEX IF NOT EXISTS saved_items_user_kind_idx ON saved_items (user_id, item_kind, created_at DESC);

CREATE TABLE IF NOT EXISTS update_inbox (
  event_key TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES portal_users(user_id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('received', 'processing', 'processed', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  error_code TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS update_inbox_status_idx ON update_inbox (status, last_seen_at);

CREATE TABLE IF NOT EXISTS audit_events (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES portal_users(user_id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_events_user_created_idx ON audit_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_action_created_idx ON audit_events (action, created_at DESC);

CREATE TABLE IF NOT EXISTS outbox_jobs (
  id BIGSERIAL PRIMARY KEY,
  event_key TEXT UNIQUE,
  topic TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS outbox_jobs_ready_idx ON outbox_jobs (status, available_at);

CREATE TABLE IF NOT EXISTS import_markers (
  source_checksum TEXT PRIMARY KEY,
  item_count INTEGER NOT NULL CHECK (item_count >= 0),
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO schema_migrations (version)
VALUES ('0001_initial')
ON CONFLICT (version) DO NOTHING;

COMMIT;
