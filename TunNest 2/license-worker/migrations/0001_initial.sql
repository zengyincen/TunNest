PRAGMA foreign_keys = ON;

CREATE TABLE licenses (
  id TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL UNIQUE,
  customer_id TEXT NOT NULL,
  plan TEXT NOT NULL CHECK(plan IN ('monthly','halfyear','yearly','lifetime')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended','revoked')),
  starts_at TEXT NOT NULL,
  expires_at TEXT,
  device_limit INTEGER NOT NULL DEFAULT 3,
  support_priority INTEGER NOT NULL DEFAULT 1,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE activations (
  id TEXT PRIMARY KEY,
  license_id TEXT NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  device_hash TEXT NOT NULL,
  extension_version TEXT,
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(license_id, device_hash)
);

CREATE INDEX idx_licenses_hash ON licenses(key_hash);
CREATE INDEX idx_activations_license ON activations(license_id);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  license_id TEXT,
  detail_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
