-- 02_tables.sql
-- 业务表结构（20 张表）。
--
-- 由 drizzle-kit 依据 server/database/schema.ts 生成（drizzle/0000_previous_solo.sql），
-- 再针对本地 PostgreSQL 做三处必要修正（见下），故不要手改业务列定义：
--   1) 外键引用：drizzle 对 pgTable 的外键默认写死 "public".<table>，
--      但本地把表建在 workspace schema，统一改为 "workspace_aadkwdme7deas".<table>。
--   2) owner 唯一索引：owner 是复合类型 user_profile（无 btree 操作符类），
--      不能直接在复合列上建 btree；与线上一致，改用表达式 ((owner).user_id)。
--   3) owner DEFAULT：drizzle 反推时把平台默认值截断成不完整的 CASE（缺 ELSE/END），
--      本地补全为 ELSE ROW(current_setting('app.user_id',true))::user_profile END。
--
-- 执行前请先执行 01_init.sql（建 schema 和复合类型）。本文件自带 SET search_path。
SET search_path = workspace_aadkwdme7deas;
CREATE TABLE "agent_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid,
	"action" varchar(50) NOT NULL,
	"detail" jsonb,
	"owner" "user_profile" DEFAULT CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL ELSE ROW(current_setting('app.user_id'::text, true))::user_profile END NOT NULL,
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile" DEFAULT CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL ELSE ROW(current_setting('app.user_id'::text, true))::user_profile END
);

CREATE TABLE "agent_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"role" varchar(30) NOT NULL,
	"evidence_type" varchar(30) NOT NULL,
	"title" varchar(200) NOT NULL,
	"content" text NOT NULL,
	"source_url" text,
	"source_name" varchar(100),
	"fetched_at" timestamptz (3) NOT NULL,
	"relevance_score" numeric,
	"owner" "user_profile" DEFAULT CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL ELSE ROW(current_setting('app.user_id'::text, true))::user_profile END NOT NULL,
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile" DEFAULT CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL ELSE ROW(current_setting('app.user_id'::text, true))::user_profile END
);

CREATE TABLE "agent_ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"ticker" varchar(20) NOT NULL,
	"rating" varchar(10) NOT NULL,
	"confidence" varchar(10) NOT NULL,
	"target_price" numeric,
	"action" text NOT NULL,
	"aggregation_logic" text,
	"key_uncertainty" text,
	"bull_summary" text,
	"bear_summary" text,
	"catalysts" text,
	"risks" text,
	"owner" "user_profile" DEFAULT CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL ELSE ROW(current_setting('app.user_id'::text, true))::user_profile END NOT NULL,
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile" DEFAULT CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL ELSE ROW(current_setting('app.user_id'::text, true))::user_profile END,
	"_updated_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile" DEFAULT CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL ELSE ROW(current_setting('app.user_id'::text, true))::user_profile END
);

CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticker" varchar(20) NOT NULL,
	"ticker_name" varchar(100),
	"market" varchar(10),
	"trigger_type" varchar(20) NOT NULL,
	"run_mode" varchar(20) DEFAULT 'full' NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"model_fast" varchar(50),
	"model_slow" varchar(50),
	"tokens_used" integer DEFAULT 0,
	"cost_estimate" numeric DEFAULT '0',
	"started_at" timestamptz (3),
	"completed_at" timestamptz (3),
	"error_message" text,
	"human_decision" varchar(20),
	"human_note" text,
	"owner" "user_profile" DEFAULT CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL ELSE ROW(current_setting('app.user_id'::text, true))::user_profile END NOT NULL,
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile" DEFAULT CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL ELSE ROW(current_setting('app.user_id'::text, true))::user_profile END,
	"_updated_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile" DEFAULT CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL ELSE ROW(current_setting('app.user_id'::text, true))::user_profile END
);

CREATE TABLE "alpha_picks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticker" varchar(20) NOT NULL,
	"company" varchar(255),
	"sector" varchar(100),
	"date_picked" date,
	"return_pct" numeric,
	"rating" varchar(30),
	"weight_pct" numeric,
	"owner" "user_profile" DEFAULT CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL ELSE ROW(current_setting('app.user_id'::text, true))::user_profile END NOT NULL,
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile" DEFAULT CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL ELSE ROW(current_setting('app.user_id'::text, true))::user_profile END,
	"_updated_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile" DEFAULT CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL ELSE ROW(current_setting('app.user_id'::text, true))::user_profile END
);

CREATE TABLE "analysis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_date" date NOT NULL,
	"ticker" varchar(20) NOT NULL,
	"rating" varchar(500),
	"action" varchar(500),
	"analysis" text,
	"target_price" numeric,
	"catalysts" text,
	"risks" text,
	"owner" "user_profile" DEFAULT CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL ELSE ROW(current_setting('app.user_id'::text, true))::user_profile END NOT NULL,
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile" DEFAULT CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL ELSE ROW(current_setting('app.user_id'::text, true))::user_profile END,
	"_updated_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile" DEFAULT CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL ELSE ROW(current_setting('app.user_id'::text, true))::user_profile END
);

CREATE TABLE "bull_bear_arguments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"side" varchar(10) NOT NULL,
	"round" integer DEFAULT 1 NOT NULL,
	"argument" text NOT NULL,
	"evidence_ids" jsonb,
	"countered_by" uuid,
	"owner" "user_profile" DEFAULT CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL ELSE ROW(current_setting('app.user_id'::text, true))::user_profile END NOT NULL,
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile" DEFAULT CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL ELSE ROW(current_setting('app.user_id'::text, true))::user_profile END
);

CREATE TABLE "cash_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"currency" varchar(10) NOT NULL,
	"balance" numeric DEFAULT '0' NOT NULL,
	"owner" "user_profile" DEFAULT CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL ELSE ROW(current_setting('app.user_id'::text, true))::user_profile END NOT NULL,
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile" DEFAULT CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL ELSE ROW(current_setting('app.user_id'::text, true))::user_profile END,
	"_updated_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile" DEFAULT CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL ELSE ROW(current_setting('app.user_id'::text, true))::user_profile END
);

CREATE TABLE "closed" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticker" varchar(20) NOT NULL,
	"company" varchar(255),
	"open_date" date,
	"close_date" date,
	"buy_price" numeric,
	"sell_price" numeric,
	"shares" numeric,
	"realized_pl" numeric,
	"return_pct" numeric,
	"notes" text,
	"owner" "user_profile" DEFAULT CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL ELSE ROW(current_setting('app.user_id'::text, true))::user_profile END NOT NULL,
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile" DEFAULT CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL ELSE ROW(current_setting('app.user_id'::text, true))::user_profile END,
	"_updated_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile" DEFAULT CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL ELSE ROW(current_setting('app.user_id'::text, true))::user_profile END
);

CREATE TABLE "debate_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"round" integer NOT NULL,
	"speaker" varchar(30) NOT NULL,
	"content" text NOT NULL,
	"tokens_used" integer DEFAULT 0,
	"owner" "user_profile" DEFAULT CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL ELSE ROW(current_setting('app.user_id'::text, true))::user_profile END NOT NULL,
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile" DEFAULT CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL ELSE ROW(current_setting('app.user_id'::text, true))::user_profile END
);

CREATE TABLE "deep_report" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"ticker" varchar(20) NOT NULL,
	"rating" varchar(20),
	"confidence" varchar(10),
	"target_bear" numeric,
	"target_base" numeric,
	"target_bull" numeric,
	"prob_bear" numeric,
	"prob_base" numeric,
	"prob_bull" numeric,
	"core_thesis" text,
	"view_change" text,
	"prev_rating" varchar(20),
	"company_overview" text,
	"business_model" text,
	"moat" text,
	"revenue_structure" jsonb,
	"financial_annual" jsonb,
	"financial_quarterly" jsonb,
	"profitability" jsonb,
	"balance_sheet" jsonb,
	"cash_flow" jsonb,
	"financial_quality" text,
	"segment_analysis" jsonb,
	"valuation_relative" jsonb,
	"valuation_sotp" jsonb,
	"valuation_methodology" text,
	"industry_overview" text,
	"market_size" text,
	"competitive_position" text,
	"industry_trends" text,
	"bull_points" jsonb,
	"bear_points" jsonb,
	"critic_points" jsonb,
	"revised_assumptions" text,
	"catalysts_timeline" jsonb,
	"risk_items" jsonb,
	"risk_gate_snapshot" jsonb,
	"pm_action" text,
	"pm_price_range" text,
	"pm_position_size" text,
	"pm_stop_loss" text,
	"pm_execution_plan" text,
	"tracking_metrics" jsonb,
	"view_change_triggers" text,
	"owner" "user_profile" DEFAULT CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL ELSE ROW(current_setting('app.user_id'::text, true))::user_profile END NOT NULL,
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile" DEFAULT CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL ELSE ROW(current_setting('app.user_id'::text, true))::user_profile END,
	"_updated_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile" DEFAULT CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL ELSE ROW(current_setting('app.user_id'::text, true))::user_profile END,
	CONSTRAINT "deep_report_run_id_unique" UNIQUE("run_id")
);

CREATE TABLE "fx_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rate_date" date NOT NULL,
	"base" varchar(10) NOT NULL,
	"quote" varchar(10) NOT NULL,
	"rate" numeric NOT NULL,
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"color" varchar(20),
	"sort" integer DEFAULT 0,
	"owner" "user_profile" DEFAULT CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL ELSE ROW(current_setting('app.user_id'::text, true))::user_profile END NOT NULL,
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile" DEFAULT CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL ELSE ROW(current_setting('app.user_id'::text, true))::user_profile END,
	"_updated_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile" DEFAULT CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL ELSE ROW(current_setting('app.user_id'::text, true))::user_profile END
);

CREATE TABLE "holdings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticker" varchar(20) NOT NULL,
	"company" varchar(255),
	"sector" varchar(255),
	"buy_date" date,
	"buy_price" numeric,
	"shares" numeric DEFAULT '0' NOT NULL,
	"current_price" numeric,
	"rating" varchar(500),
	"action" varchar(500),
	"analysis" text,
	"target_price" numeric,
	"group_id" uuid,
	"owner" "user_profile" DEFAULT CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL ELSE ROW(current_setting('app.user_id'::text, true))::user_profile END NOT NULL,
	"market" varchar(10) DEFAULT 'US',
	"currency" varchar(10) DEFAULT 'USD',
	"symbol_native" varchar(40),
	"display_symbol" varchar(40),
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile" DEFAULT CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL ELSE ROW(current_setting('app.user_id'::text, true))::user_profile END,
	"_updated_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile" DEFAULT CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL ELSE ROW(current_setting('app.user_id'::text, true))::user_profile END
);

CREATE TABLE "journal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"journal_date" date NOT NULL,
	"market_summary" text,
	"portfolio_summary" text,
	"actions" text,
	"plan" text,
	"lessons" text,
	"owner" "user_profile" DEFAULT CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL ELSE ROW(current_setting('app.user_id'::text, true))::user_profile END NOT NULL,
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile" DEFAULT CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL ELSE ROW(current_setting('app.user_id'::text, true))::user_profile END,
	"_updated_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile" DEFAULT CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL ELSE ROW(current_setting('app.user_id'::text, true))::user_profile END
);

CREATE TABLE "risk_gate_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"rule_name" varchar(50) NOT NULL,
	"rule_type" varchar(20) NOT NULL,
	"passed" boolean NOT NULL,
	"current_value" numeric,
	"threshold_value" numeric,
	"detail" text,
	"suggested_action" text,
	"owner" "user_profile" DEFAULT CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL ELSE ROW(current_setting('app.user_id'::text, true))::user_profile END NOT NULL,
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile" DEFAULT CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL ELSE ROW(current_setting('app.user_id'::text, true))::user_profile END
);

CREATE TABLE "snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_date" date NOT NULL,
	"account_value" numeric,
	"total_mv" numeric,
	"cost" numeric,
	"cash" numeric,
	"total_pl" numeric,
	"daily_pl" numeric,
	"daily_pct" numeric,
	"owner" "user_profile" DEFAULT CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL ELSE ROW(current_setting('app.user_id'::text, true))::user_profile END NOT NULL,
	"net_deposit" numeric DEFAULT '0',
	"cumulative_net_deposit" numeric DEFAULT '0',
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile" DEFAULT CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL ELSE ROW(current_setting('app.user_id'::text, true))::user_profile END,
	"_updated_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile" DEFAULT CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL ELSE ROW(current_setting('app.user_id'::text, true))::user_profile END
);

CREATE TABLE "strategy_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_key" varchar(50) NOT NULL,
	"rule_name" varchar(100) NOT NULL,
	"rule_type" varchar(20) NOT NULL,
	"threshold" numeric,
	"unit" varchar(20),
	"enabled" boolean DEFAULT true NOT NULL,
	"description" text,
	"owner" "user_profile" DEFAULT CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL ELSE ROW(current_setting('app.user_id'::text, true))::user_profile END NOT NULL,
	"category" varchar(50),
	"severity" varchar(20) DEFAULT 'warning',
	"sort" integer DEFAULT 0,
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile" DEFAULT CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL ELSE ROW(current_setting('app.user_id'::text, true))::user_profile END,
	"_updated_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile" DEFAULT CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL ELSE ROW(current_setting('app.user_id'::text, true))::user_profile END
);

CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tx_date" date NOT NULL,
	"ticker" varchar(20) NOT NULL,
	"tx_type" varchar(10) NOT NULL,
	"shares" numeric NOT NULL,
	"price" numeric NOT NULL,
	"fees" numeric DEFAULT '0',
	"notes" text,
	"owner" "user_profile" DEFAULT CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL ELSE ROW(current_setting('app.user_id'::text, true))::user_profile END NOT NULL,
	"currency" varchar(10) DEFAULT 'USD',
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile" DEFAULT CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL ELSE ROW(current_setting('app.user_id'::text, true))::user_profile END,
	"_updated_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile" DEFAULT CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL ELSE ROW(current_setting('app.user_id'::text, true))::user_profile END
);

CREATE TABLE "watchlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticker" varchar(20) NOT NULL,
	"company" varchar(255),
	"sector" varchar(100),
	"date_added" date,
	"entry_price" numeric,
	"current_price" numeric,
	"rating" varchar(30),
	"signal" varchar(20),
	"target_buy" numeric,
	"analysis" text,
	"owner" "user_profile" DEFAULT CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL ELSE ROW(current_setting('app.user_id'::text, true))::user_profile END NOT NULL,
	"market" varchar(10) DEFAULT 'US',
	"currency" varchar(10) DEFAULT 'USD',
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile" DEFAULT CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL ELSE ROW(current_setting('app.user_id'::text, true))::user_profile END,
	"_updated_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile" DEFAULT CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL ELSE ROW(current_setting('app.user_id'::text, true))::user_profile END
);

ALTER TABLE "agent_audit_log" ADD CONSTRAINT "agent_audit_log_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "workspace_aadkwdme7deas"."agent_runs"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "agent_evidence" ADD CONSTRAINT "agent_evidence_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "workspace_aadkwdme7deas"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "agent_ratings" ADD CONSTRAINT "agent_ratings_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "workspace_aadkwdme7deas"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "bull_bear_arguments" ADD CONSTRAINT "bull_bear_arguments_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "workspace_aadkwdme7deas"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "debate_records" ADD CONSTRAINT "debate_records_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "workspace_aadkwdme7deas"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "deep_report" ADD CONSTRAINT "deep_report_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "workspace_aadkwdme7deas"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "workspace_aadkwdme7deas"."groups"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "risk_gate_results" ADD CONSTRAINT "risk_gate_results_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "workspace_aadkwdme7deas"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "idx_agent_evidence_run" ON "agent_evidence" USING btree ("run_id");
CREATE INDEX "idx_alpha_picks_date" ON "alpha_picks" USING btree ("date_picked");
CREATE INDEX "idx_analysis_date" ON "analysis" USING btree ("analysis_date");
CREATE UNIQUE INDEX "idx_analysis_owner_date_ticker" ON "analysis" USING btree ((("owner").user_id),"analysis_date","ticker");
CREATE INDEX "idx_bull_bear_run" ON "bull_bear_arguments" USING btree ("run_id");
CREATE INDEX "idx_bull_bear_run_side" ON "bull_bear_arguments" USING btree ("run_id","side");
CREATE INDEX "idx_closed_close_date" ON "closed" USING btree ("close_date");
CREATE INDEX "idx_closed_ticker" ON "closed" USING btree ("ticker");
CREATE INDEX "idx_debate_run" ON "debate_records" USING btree ("run_id");
CREATE UNIQUE INDEX "idx_deep_report_run" ON "deep_report" USING btree ("run_id");
CREATE UNIQUE INDEX "idx_fx_rates_date_base_quote" ON "fx_rates" USING btree ("rate_date","base","quote");
CREATE INDEX "idx_holdings_group" ON "holdings" USING btree ("group_id");
CREATE UNIQUE INDEX "idx_journal_owner_date" ON "journal" USING btree ((("owner").user_id),"journal_date");
CREATE INDEX "idx_risk_gate_run" ON "risk_gate_results" USING btree ("run_id");
CREATE UNIQUE INDEX "idx_snapshots_owner_date" ON "snapshots" USING btree ((("owner").user_id),"snapshot_date");
CREATE INDEX "idx_transactions_date" ON "transactions" USING btree ("tx_date");
CREATE INDEX "idx_transactions_ticker" ON "transactions" USING btree ("ticker");