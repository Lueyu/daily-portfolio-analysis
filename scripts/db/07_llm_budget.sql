CREATE TABLE IF NOT EXISTS llm_budget_settings (
  owner uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  daily_token_limit integer NOT NULL DEFAULT 60000,
  monthly_token_limit integer NOT NULL DEFAULT 600000,
  per_task_token_limit integer NOT NULL DEFAULT 24000,
  max_input_tokens integer NOT NULL DEFAULT 6000,
  max_output_tokens integer NOT NULL DEFAULT 1000,
  max_calls_per_task integer NOT NULL DEFAULT 8,
  daily_call_limit integer NOT NULL DEFAULT 30,
  input_usd_per_million numeric,
  output_usd_per_million numeric,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT llm_budget_positive_limits CHECK (
    max_input_tokens > 0 AND max_output_tokens > 0
    AND max_calls_per_task > 0 AND max_calls_per_task <= daily_call_limit
    AND max_input_tokens + max_output_tokens <= per_task_token_limit
    AND per_task_token_limit <= daily_token_limit AND daily_token_limit <= monthly_token_limit
    AND monthly_token_limit <= 1000000000 AND max_input_tokens <= 1000000
    AND max_output_tokens <= 1000000 AND max_calls_per_task <= 10000 AND daily_call_limit <= 100000
  ),
  CONSTRAINT llm_budget_nonnegative_rates CHECK (
    (input_usd_per_million IS NULL OR input_usd_per_million BETWEEN 0 AND 100000)
    AND (output_usd_per_million IS NULL OR output_usd_per_million BETWEEN 0 AND 100000)
  )
);

CREATE TABLE IF NOT EXISTS llm_budget_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id varchar(160) NOT NULL,
  purpose varchar(160) NOT NULL,
  model varchar(120) NOT NULL,
  input_tokens integer NOT NULL,
  output_tokens integer NOT NULL,
  max_output_tokens integer NOT NULL,
  reserved_tokens integer NOT NULL,
  charged_tokens integer NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'reserved',
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  settled_at timestamptz,
  CONSTRAINT llm_budget_usage_status CHECK (status IN ('reserved', 'completed', 'estimated', 'failed_unknown')),
  CONSTRAINT llm_budget_usage_nonnegative CHECK (
    input_tokens >= 0 AND output_tokens >= 0 AND max_output_tokens > 0
    AND reserved_tokens > 0 AND charged_tokens >= 0
  )
);

CREATE INDEX IF NOT EXISTS llm_budget_usage_owner_date ON llm_budget_usage(owner, created_at);
CREATE INDEX IF NOT EXISTS llm_budget_usage_owner_task ON llm_budget_usage(owner, task_id);
