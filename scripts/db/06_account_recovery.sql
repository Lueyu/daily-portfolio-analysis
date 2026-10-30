ALTER TABLE users ADD COLUMN IF NOT EXISTS recovery_code_hash text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version integer NOT NULL DEFAULT 0;
