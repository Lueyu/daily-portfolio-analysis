CREATE TABLE IF NOT EXISTS builder_scan_leases (
  owner text PRIMARY KEY,
  token uuid NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS builder_review_checks (
  owner text NOT NULL,
  profile_id uuid NOT NULL REFERENCES builder_profiles(id),
  ticker text NOT NULL,
  profile_version integer NOT NULL,
  input_hash text NOT NULL,
  reviewed_at timestamptz NOT NULL,
  decision text NOT NULL,
  reason text NOT NULL,
  PRIMARY KEY (owner, profile_id, ticker)
);
