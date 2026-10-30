ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS language varchar(10) NOT NULL DEFAULT 'zh-CN';
ALTER TABLE deep_report ADD COLUMN IF NOT EXISTS analysis_trace jsonb;
ALTER TABLE agent_ratings ALTER COLUMN rating TYPE varchar(20);
