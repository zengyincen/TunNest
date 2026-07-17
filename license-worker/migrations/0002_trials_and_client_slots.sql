ALTER TABLE activations ADD COLUMN client_type TEXT NOT NULL DEFAULT 'extension';
ALTER TABLE activations ADD COLUMN device_label TEXT;

CREATE INDEX idx_activations_client_type ON activations(license_id, client_type);

CREATE TABLE trials (
  id TEXT PRIMARY KEY,
  subject_hash TEXT NOT NULL UNIQUE,
  device_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','blocked')),
  extension_version TEXT,
  started_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_trials_subject_hash ON trials(subject_hash);
