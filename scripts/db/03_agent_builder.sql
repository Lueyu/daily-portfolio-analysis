-- Additive migration. Applied on fresh PostgreSQL volumes by initdb and on
-- existing volumes by the database provider before Nest starts serving APIs.
CREATE TABLE IF NOT EXISTS builder_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner text NOT NULL,
  config jsonb NOT NULL,
  status varchar(12) NOT NULL DEFAULT 'draft',
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_builder_profiles_owner ON builder_profiles (owner);
CREATE UNIQUE INDEX IF NOT EXISTS idx_builder_profiles_active
  ON builder_profiles (owner) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS builder_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner text NOT NULL,
  profile_id uuid NOT NULL REFERENCES builder_profiles(id),
  profile_version integer NOT NULL,
  signal_date date NOT NULL,
  ticker varchar(20) NOT NULL,
  market varchar(10) NOT NULL,
  currency varchar(10) NOT NULL,
  side varchar(10) NOT NULL,
  quantity numeric NOT NULL,
  reference_price numeric NOT NULL,
  reason text NOT NULL,
  status varchar(12) NOT NULL DEFAULT 'pending',
  paper_order_id uuid,
  executed_at timestamptz(3),
  executed_quantity numeric,
  executed_price numeric,
  executed_fees numeric,
  notes text,
  expires_at timestamptz(3) NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_builder_proposal_daily
  ON builder_proposals (profile_id, signal_date, ticker, side);
CREATE INDEX IF NOT EXISTS idx_builder_proposals_owner_created
  ON builder_proposals (owner, created_at);

-- Older installs seeded three rules that cannot be evaluated with the present
-- data model. Pause only untouched built-in copies, exactly once. Users may
-- later choose to enable them again after providing verifiable inputs.
CREATE TABLE IF NOT EXISTS squabble_migrations (
  name text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
WITH first_apply AS (
  INSERT INTO squabble_migrations (name)
  VALUES ('2026-10-30-pause-unverifiable-default-rules')
  ON CONFLICT DO NOTHING
  RETURNING name
)
UPDATE strategy_rules SET enabled = false
WHERE EXISTS (SELECT 1 FROM first_apply)
  AND enabled = true
  AND (
    (rule_key = 'small_cap_weight' AND description = '市值小于50亿的小盘股总仓位不超过5%')
    OR (rule_key = 'loss_maker_weight' AND description = '最近一期净利润为负的标的合计仓位不超过10%')
    OR (rule_key = 'new_buy_checklist' AND description = '新建仓必须完成：基本面评分、行业地位、估值分位、催化剂、风险点 5 项检查')
  );
