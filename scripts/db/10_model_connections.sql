CREATE TABLE IF NOT EXISTS model_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name varchar(60) NOT NULL,
  base_url text NOT NULL,
  fast_model varchar(120) NOT NULL,
  slow_model varchar(120) NOT NULL,
  api_key_enc text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS model_connections_owner_idx ON model_connections(owner);
