ALTER TABLE llm_budget_settings ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true;
