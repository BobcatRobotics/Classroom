CREATE TABLE launcher_auth_codes (
  code_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);

CREATE INDEX idx_launcher_auth_codes_expiry
  ON launcher_auth_codes(expires_at);

CREATE TABLE launcher_runtime_grants (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX idx_launcher_runtime_grants_expiry
  ON launcher_runtime_grants(expires_at);