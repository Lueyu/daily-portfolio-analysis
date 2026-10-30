CREATE TABLE IF NOT EXISTS research_tool_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id varchar(160) NOT NULL,
  provider varchar(40) NOT NULL DEFAULT 'deepseek_search',
  status varchar(24) NOT NULL DEFAULT 'reserved',
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  settled_at timestamptz,
  CONSTRAINT research_tool_usage_status CHECK (status IN ('reserved', 'succeeded', 'failed', 'cancelled'))
);
CREATE INDEX IF NOT EXISTS research_tool_usage_owner_date ON research_tool_usage(owner, created_at);
CREATE INDEX IF NOT EXISTS research_tool_usage_owner_task ON research_tool_usage(owner, task_id);
