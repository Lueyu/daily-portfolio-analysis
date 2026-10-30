CREATE TABLE IF NOT EXISTS user_api_settings (
  owner text PRIMARY KEY,
  llm_base_url text,
  llm_fast_model varchar(120),
  llm_slow_model varchar(120),
  llm_api_key_enc text,
  finnhub_api_key_enc text,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
