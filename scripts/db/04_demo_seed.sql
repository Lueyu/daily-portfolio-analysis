-- 04_demo_seed.sql
-- Fictional demo dataset (docker compose up 的默认数据)。
--
-- 所有公司、价格、评级、研报内容均为虚构演示数据，不构成任何投资建议。
-- demo 账号 id 为 'demo-user'，与 docker-compose.yml 中 LOCAL_DEMO_USER_ID 保持一致，
-- 由本地开发鉴权中间件 (server/common/middleware/local-dev-auth.middleware.ts)
-- 注入网关用户头，使 @NeedLogin() 与 owner 行级隔离按真实链路工作。
--
-- 前置：01_init.sql (schema/类型) → 02_tables.sql (表) → 03_roles.sql (角色)。

SET search_path = workspace_aadkwdme7deas;

-- 演示账户固定 owner 值
-- ROW('demo-user')::user_profile

-- ============================================================
-- 1. 汇率（全局表，无 owner）
-- ============================================================
INSERT INTO fx_rates (rate_date, base, quote, rate) VALUES
  ('2026-10-29', 'USD', 'HKD', 7.7830),
  ('2026-10-29', 'USD', 'CNY', 7.1030),
  ('2026-10-29', 'HKD', 'USD', 0.1285),
  ('2026-10-29', 'CNY', 'USD', 0.1408),
  ('2026-10-28', 'USD', 'HKD', 7.7812),
  ('2026-10-28', 'USD', 'CNY', 7.0995),
  ('2026-10-28', 'HKD', 'USD', 0.1285),
  ('2026-10-28', 'CNY', 'USD', 0.1409),
  ('2026-10-27', 'USD', 'HKD', 7.7801),
  ('2026-10-27', 'USD', 'CNY', 7.0962),
  ('2026-10-27', 'HKD', 'USD', 0.1285),
  ('2026-10-27', 'CNY', 'USD', 0.1409);

-- ============================================================
-- 2. 分组
-- ============================================================
INSERT INTO groups (id, name, color, sort, owner) VALUES
  ('00000000-0000-4000-8000-000000000001', 'Alpha Picks', '#3b82f6', 1, ROW('demo-user')::user_profile),
  ('00000000-0000-4000-8000-000000000002', 'Self-managed', '#10b981', 2, ROW('demo-user')::user_profile);

-- ============================================================
-- 3. 持仓（6 只：US/HK/CN 多币种）
-- ============================================================
INSERT INTO holdings (ticker, company, sector, buy_date, buy_price, shares, current_price, rating, action, analysis, target_price, group_id, owner, market, currency, symbol_native, display_symbol) VALUES
  ('NVDA', '英伟达 (NVIDIA Corporation)', 'Semiconductors', '2026-06-15', 172.50, 40, 312.40, 'Buy', '持有',
   'AI 算力周期核心资产。数据中心收入连续四个季度翻倍增长，Blackwell 平台供不应求；CUDA 软件生态构成深护城河。主要风险为对华出口政策与超大客户资本开支周期性。10-28 深度研报上调至 Buy，目标价 380。',
   380.00, '00000000-0000-4000-8000-000000000001', ROW('demo-user')::user_profile, 'US', 'USD', 'NVDA', 'NVDA'),
  ('MSFT', '微软 (Microsoft Corporation)', 'Software - Infrastructure', '2026-03-10', 415.20, 18, 502.80, 'Buy', '持有',
   'Azure + Copilot 双引擎。企业 AI 渗透率仍处早期，资本开支高但现金流覆盖充裕。估值处于 5 年 60% 分位，回调即加仓。',
   560.00, '00000000-0000-4000-8000-000000000002', ROW('demo-user')::user_profile, 'US', 'USD', 'MSFT', 'MSFT'),
  ('AAPL', '苹果 (Apple Inc.)', 'Consumer Electronics', '2026-08-22', 245.00, 30, 262.50, 'Hold', '持有',
   '换机周期叠加 Apple Intelligence 渗透，服务收入占比持续提升。当前估值已计入较多乐观预期，持有不加仓。',
   285.00, '00000000-0000-4000-8000-000000000002', ROW('demo-user')::user_profile, 'US', 'USD', 'AAPL', 'AAPL'),
  ('0700', '腾讯控股 (Tencent Holdings)', 'Internet Services', '2026-05-06', 486.00, 100, 652.00, 'Buy', '持有',
   '游戏常青 + 视频号广告放量 + AI 提效。微信生态货币化空间仍大，回购持续。10-26 深度研报维持 Buy，目标价 720。',
   720.00, '00000000-0000-4000-8000-000000000001', ROW('demo-user')::user_profile, 'HK', 'HKD', '0700.HK', '腾讯控股'),
  ('600519', '贵州茅台 (Kweichow Moutai)', 'Consumer Staples', '2026-04-18', 1520.00, 20, 1488.00, 'Hold', '观望',
   '白酒行业库存周期仍在出清，批价企稳但弹性有限。股息率约 3.2% 提供底部支撑，等待动销数据右侧信号。',
   1650.00, '00000000-0000-4000-8000-000000000002', ROW('demo-user')::user_profile, 'CN', 'CNY', '600519.SS', '贵州茅台'),
  ('TSM', '台积电 (Taiwan Semiconductor)', 'Semiconductors', '2026-09-02', 288.00, 25, 331.50, 'Buy', '持有',
   '先进制程独家供应 + CoWoS 产能持续扩张。AI 芯片代工需求的确定性最高的环节。与 NVDA 敞口同向，注意行业集中度。',
   395.00, '00000000-0000-4000-8000-000000000001', ROW('demo-user')::user_profile, 'US', 'USD', 'TSM', 'TSM');

-- ============================================================
-- 4. 交易记录（含一笔完整回合 INTC 与 NVDA 部分止盈）
-- ============================================================
INSERT INTO transactions (tx_date, ticker, tx_type, shares, price, fees, notes, owner, currency) VALUES
  ('2026-03-01', 'USD',  'Deposit',     50000, 1, 0, '入金', ROW('demo-user')::user_profile, 'USD'),
  ('2026-03-10', 'MSFT', 'Buy',           18, 415.20, 0.99, NULL, ROW('demo-user')::user_profile, 'USD'),
  ('2026-04-15', 'CNY',  'Deposit',     48400, 1, 0, '入金', ROW('demo-user')::user_profile, 'CNY'),
  ('2026-04-18', '600519', 'Buy',         20, 1520.00, 5.10, NULL, ROW('demo-user')::user_profile, 'CNY'),
  ('2026-05-05', 'HKD',  'Deposit',     90600, 1, 0, '入金', ROW('demo-user')::user_profile, 'HKD'),
  ('2026-05-06', '0700', 'Buy',          100, 486.00, 90.60, NULL, ROW('demo-user')::user_profile, 'HKD'),
  ('2026-06-15', 'NVDA', 'Buy',           50, 172.50, 0.99, '首次建仓', ROW('demo-user')::user_profile, 'USD'),
  ('2026-07-01', 'INTC', 'Buy',           50, 32.00, 0.49, '左侧试仓', ROW('demo-user')::user_profile, 'USD'),
  ('2026-08-22', 'AAPL', 'Buy',           30, 245.00, 0.99, NULL, ROW('demo-user')::user_profile, 'USD'),
  ('2026-09-02', 'TSM',  'Buy',           25, 288.00, 0.99, NULL, ROW('demo-user')::user_profile, 'USD'),
  ('2026-09-12', 'INTC', 'Sell',          50, 38.50, 0.49, '代工订单传闻兑现，止盈离场', ROW('demo-user')::user_profile, 'USD'),
  ('2026-10-08', 'NVDA', 'Sell',          10, 290.00, 0.49, '部分止盈锁定收益', ROW('demo-user')::user_profile, 'USD'),
  ('2026-10-20', 'USD',  'Withdrawal',  9076.40, 1, 0, '出金', ROW('demo-user')::user_profile, 'USD');

-- ============================================================
-- 5. 已平仓（已实现盈亏展示）
-- ============================================================
INSERT INTO closed (ticker, company, open_date, close_date, buy_price, sell_price, shares, realized_pl, return_pct, notes, owner) VALUES
  ('INTC', '英特尔 (Intel Corporation)', '2026-07-01', '2026-09-12', 32.00, 38.50, 50, 325.00, 20.31,
   '左侧试仓 50 股，代工订单传闻兑现后止盈', ROW('demo-user')::user_profile);

-- ============================================================
-- 6. 现金子账户（多币种）
-- ============================================================
INSERT INTO cash_accounts (currency, balance, owner) VALUES
  ('USD', 8500.00, ROW('demo-user')::user_profile),
  ('HKD', 42000.00, ROW('demo-user')::user_profile),
  ('CNY', 18000.00, ROW('demo-user')::user_profile);

-- ============================================================
-- 7. 关注列表（4 只，覆盖买入/观望/回避信号）
-- ============================================================
INSERT INTO watchlist (ticker, company, sector, date_added, entry_price, current_price, rating, signal, target_buy, analysis, owner, market, currency) VALUES
  ('AMZN', '亚马逊 (Amazon.com)', 'Internet Retail', '2026-09-10', 305.00, 328.40, 'Buy', '观望', 305.00,
   'AWS 增速回升 + 零售利润率扩张。当前价格高于目标买点 7%，等回调至 305 一带分批建仓。', ROW('demo-user')::user_profile, 'US', 'USD'),
  ('GOOGL', '谷歌 (Alphabet)', 'Internet Services', '2026-08-15', 225.00, 224.80, 'Buy', '买入', 225.00,
   '已进入目标买点区域。搜索 + Gemini 双轮驱动，云业务盈利能力持续改善，可启动首次建仓。', ROW('demo-user')::user_profile, 'US', 'USD'),
  ('1810', '小米集团 (Xiaomi Corporation)', 'Consumer Electronics', '2026-09-28', 48.50, 52.30, 'Buy', '观望', 48.50,
   '手机高端化 + 澎程增程 SUV 放量 + 互联网服务毛利压舱。汽车减亏节奏是核心变量，等 48.5 以下的安全边际。', ROW('demo-user')::user_profile, 'HK', 'HKD'),
  ('3690', '美团 (Meituan)', 'Internet Services', '2026-10-12', 95.00, 118.60, 'Hold', '回避', 95.00,
   '即时零售竞争格局恶化，补贴大战压制利润率。价格远高于目标买点，短期回避。', ROW('demo-user')::user_profile, 'HK', 'HKD');

-- ============================================================
-- 8. 每日分析卡片（2026-10-29，覆盖全部持仓与关注）
-- ============================================================
INSERT INTO analysis (analysis_date, ticker, rating, action, analysis, target_price, catalysts, risks, owner) VALUES
  ('2026-10-29', 'NVDA', 'Buy', '持有', 'Blackwell Ultra 出货爬坡快于预期，超大规模云厂商 2027 资本开支指引继续上修。估值处于 5 年 65% 分位但盈利增速仍高，PEG 约 1.1。', 380.00,
   '11-19 Q3 财报；Rubin 平台 2026H2 流片；GTC 2027.3', '对华出口管制升级；超大客户自研芯片分流；单季度供应链波动', ROW('demo-user')::user_profile),
  ('2026-10-29', 'MSFT', 'Buy', '持有', 'Azure AI 服务收入连续三季环比加速，Copilot 席位数超市场预期。资本开支峰值已过，FCF 拐点临近。', 560.00,
   '10-30 Q1 财报；Agent 产品商业化节奏', 'AI 资本开支回报周期拉长；反垄断审查', ROW('demo-user')::user_profile),
  ('2026-10-29', 'AAPL', 'Hold', '持有', 'iPhone 18 首周末销量符合预期，Apple Intelligence 对换机的拉动偏温和。服务业务合规风险计价不充分。', 285.00,
   '12 月节假日销售旺季；Spring 发布会', '欧盟 DMA 制裁；中国市场份额下滑', ROW('demo-user')::user_profile),
  ('2026-10-29', '0700', 'Buy', '持有', '视频号广告加载率仍有提升空间，新游戏储备充足。回购注销持续，股东回报明确。', 720.00,
   '11-13 Q3 财报；新游戏版号发放', '游戏行业监管反复；宏观消费疲软', ROW('demo-user')::user_profile),
  ('2026-10-29', '600519', 'Hold', '观望', '批价企稳但渠道库存去化慢于预期，Q3 报表确认收入降速。股息与估值提供下行保护，缺乏向上弹性。', 1650.00,
   '春节备货季动销；分红率提升预期', '商务需求恢复缓慢；年轻消费群体渗透下降', ROW('demo-user')::user_profile),
  ('2026-10-29', 'TSM', 'Buy', '持有', '10 月营收再创新高，CoWoS-L 产能 2027 年翻倍规划落地。AI 代工需求确定性全行业最高。', 395.00,
   '12 月法说会；2nm 量产良率进展', '台海地缘风险；与 NVDA 敞口同向共振', ROW('demo-user')::user_profile),
  ('2026-10-29', 'AMZN', 'Buy', '观望', '等回调：当前 328 vs 目标买点 305。', 305.00,
   'AWS re:Invent 12 月', '零售价格战；资本开支超预期', ROW('demo-user')::user_profile),
  ('2026-10-29', 'GOOGL', 'Buy', '买入', '已到买点：224.8 vs 目标 225，分三批建仓（首笔 1/3）。', 225.00,
   'Gemini 3 发布会', '搜索份额被 AI 助手分流；广告主预算收缩', ROW('demo-user')::user_profile),
  ('2026-10-29', '1810', 'Buy', '观望', '等回调：52.3 vs 目标 48.5，汽车减亏验证前不加价。', 48.50,
   '澎程 N90 交付数据', '汽车价格战；手机 SoC 自研投入拖累利润', ROW('demo-user')::user_profile),
  ('2026-10-29', '3690', 'Hold', '回避', '回避：即时零售补贴战仍在加剧，利润率底部未确认。', 95.00,
   '无', '竞争格局恶化；骑手成本上升', ROW('demo-user')::user_profile);

-- ============================================================
-- 9. 投资日志（五段式，最近 3 个交易日）
-- ============================================================
INSERT INTO journal (journal_date, market_summary, portfolio_summary, actions, plan, lessons, owner) VALUES
  ('2026-10-29',
   '美股三大指数分化，纳指涨 0.8% 创新高，半导体领涨；港股缩量整理；A 股白酒板块反弹 1.2%。美元兑人民币 7.10 附近震荡。',
   '组合净值 66,7xx 美元，单日 +0.6%。半导体合计敞口 31% 触发行业集中度软约束（30%），已在风控面板标记。INTC 回合止盈贡献本月已实现收益 325 美元。',
   '无交易。按计划持有，未触发任何调仓信号。',
   '① GOOGL 已进入目标买点，明日启动首笔 1/3 建仓；② NVDA 持仓等待 11-19 财报，不加仓不减仓；③ 关注 AMZN 是否回踩 305。',
   '行业集中度约束首次被触发：单独看 NVDA/TSM 各自都在限额内，合并看就超了——组合层面的风控必须看敞口加总，这正是硬门检查的价值。',
   ROW('demo-user')::user_profile),
  ('2026-10-28',
   '纳指微跌 0.3%，英伟达逆势涨 2.1%（Blackwell Ultra 出货超预期报道）；10 年期美债利率 4.1%。',
   '组合单日 -0.1%，跑赢基准。NVDA 深度研报（第 2 版）完成：评级由 Hold 上调至 Buy，目标价 340 → 380。',
   '确认 NVDA 研报评级并同步至持仓；无实际交易。',
   '① 复盘研报上调理由：出口管制风险定价是否充分；② 检查 Moutai 批价数据。',
   '研报 v1 (Hold) 到 v2 (Buy) 的变化主要来自证据刷新而非观点漂移——多空辩论中 bear 方的估值论点被 PEG 数据反驳，说明流程在起作用。',
   ROW('demo-user')::user_profile),
  ('2026-10-27',
   '港股科技指数涨 1.5%，腾讯三季报前瞻乐观；A 股缩量下跌。',
   '组合单日 +0.4%。0700 深度研报完成：维持 Buy，目标价 720。',
   '无交易。',
   '① 更新 watchlist：3690 提价回避；② 准备 GOOGL 建仓清单（5 项必过检查）。',
   '关注列表的信号分层（买入/观望/回避）有效避免了追高美团——纪律优先于直觉。',
   ROW('demo-user')::user_profile);

-- ============================================================
-- 10. 净值快照（2026-09-22 → 2026-10-29 工作日，公式生成）
-- ============================================================
WITH days AS (
  SELECT row_number() OVER (ORDER BY d) AS rn, d::date AS snapshot_date
  FROM generate_series('2026-09-22'::date, '2026-10-29'::date, interval '1 day') d
  WHERE EXTRACT(ISODOW FROM d) < 6
),
vals AS (
  SELECT rn, snapshot_date,
    round((63900 + 95 * rn + 560 * sin(rn / 3.1) + 120 * sin(rn / 1.7))::numeric, 2) AS account_value
  FROM days
)
INSERT INTO snapshots (snapshot_date, account_value, total_mv, cost, cash, total_pl, daily_pl, daily_pct, net_deposit, cumulative_net_deposit, owner)
SELECT
  v.snapshot_date,
  v.account_value,
  round(v.account_value - 16433.00, 2),
  39452.00,
  16433.00,
  round(v.account_value - 16433.00 - 39452.00, 2),
  COALESCE(round(v.account_value - LAG(v.account_value) OVER (ORDER BY v.rn), 2), 0),
  COALESCE(round((v.account_value - LAG(v.account_value) OVER (ORDER BY v.rn)) / NULLIF(LAG(v.account_value) OVER (ORDER BY v.rn), 0) * 100, 2), 0),
  0, 0,
  ROW('demo-user')::user_profile
FROM vals v;

-- ============================================================
-- 11. 风控规则（与应用默认播种一致，见 multi-agent.service.ts）
-- ============================================================
INSERT INTO strategy_rules (rule_key, rule_name, rule_type, threshold, unit, enabled, description, owner, category, severity, sort) VALUES
  ('single_company_exposure', '单一公司合并敞口上限', 'hard', 25, '%', true, '单一公司所有相关标的（正股+转债+关联ETF等）合计仓位不超过25%', ROW('demo-user')::user_profile, 'position_concentration', 'hard_block', 10),
  ('single_stock_limit', '单只股票权重上限', 'soft', 10, '%', true, '单只股票建议仓位不超过10%，超过需特别理由', ROW('demo-user')::user_profile, 'position_concentration', 'warning', 20),
  ('sector_exposure', '单一行业敞口上限', 'soft', 30, '%', true, '单一行业/板块合计仓位建议不超过30%', ROW('demo-user')::user_profile, 'position_concentration', 'warning', 25),
  ('small_cap_weight', '小盘股合计上限', 'hard', 5, '%', true, '市值小于50亿的小盘股总仓位不超过5%', ROW('demo-user')::user_profile, 'position_concentration', 'hard_block', 30),
  ('loss_maker_weight', '亏损股合计上限', 'hard', 10, '%', true, '最近一期净利润为负的标的合计仓位不超过10%', ROW('demo-user')::user_profile, 'position_concentration', 'warning', 40),
  ('leverage_etf', '杠杆ETF敞口上限', 'hard', 3, '%', true, '2x/3x 杠杆/反向 ETF 合计仓位不超过3%', ROW('demo-user')::user_profile, 'position_concentration', 'hard_block', 50),
  ('cash_ratio', '现金比例下限', 'soft', 7.5, '%', true, '现金占总资产比例建议保持5-10%，极端行情保留加仓能力', ROW('demo-user')::user_profile, 'cash_management', 'warning', 60),
  ('drawdown_check', '个股回撤强制重检', 'hard', 20, '%', true, '单只股票较成本价下跌超过阈值，必须强制重检基本面', ROW('demo-user')::user_profile, 'stop_loss_take_profit', 'hard_block', 70),
  ('stop_loss_pct', '个股止损线', 'soft', 25, '%', true, '单只股票较成本价下跌超过该比例触发止损评估', ROW('demo-user')::user_profile, 'stop_loss_take_profit', 'warning', 80),
  ('take_profit_pct', '个股止盈线', 'soft', 50, '%', true, '单只股票浮盈超过该比例触发止盈评估/分批减仓', ROW('demo-user')::user_profile, 'stop_loss_take_profit', 'warning', 90),
  ('new_buy_checklist', '建仓前必过清单', 'hard', 1, '项', true, '新建仓必须完成：基本面评分、行业地位、估值分位、催化剂、风险点 5 项检查', ROW('demo-user')::user_profile, 'buy_conditions', 'hard_block', 100),
  ('position_building_days', '建仓节奏', 'soft', 3, '次', true, '单只股票建仓建议分至少3次买入，时间跨度不少于2周', ROW('demo-user')::user_profile, 'buy_conditions', 'warning', 110);

-- ============================================================
-- 12. 多智能体运行记录（NVDA 两版 + 0700 一版，全部虚构）
-- ============================================================

-- ---- 运行记录 ----
INSERT INTO agent_runs (id, ticker, ticker_name, market, trigger_type, run_mode, status, model_fast, model_slow, tokens_used, cost_estimate, started_at, completed_at, human_decision, human_note, owner) VALUES
  ('10000000-0000-4000-8000-000000000001', 'NVDA', '英伟达 (NVIDIA Corporation)', 'US', 'manual', 'full', 'completed', 'doubao-lite-4k', 'doubao-pro-32k', 41230, 0.71, '2026-10-14 09:30:00+08', '2026-10-14 09:45:00+08', 'approved', NULL, ROW('demo-user')::user_profile),
  ('10000000-0000-4000-8000-000000000002', 'NVDA', '英伟达 (NVIDIA Corporation)', 'US', 'manual', 'full', 'completed', 'doubao-lite-4k', 'doubao-pro-32k', 48620, 0.86, '2026-10-28 09:30:00+08', '2026-10-28 09:47:00+08', 'approved', '同意上调，理由充分', ROW('demo-user')::user_profile),
  ('10000000-0000-4000-8000-000000000003', '0700', '腾讯控股 (Tencent Holdings)', 'HK', 'cron', 'full', 'completed', 'doubao-lite-4k', 'doubao-pro-32k', 45980, 0.79, '2026-10-26 18:00:00+08', '2026-10-26 18:19:00+08', 'approved', NULL, ROW('demo-user')::user_profile);

-- ---- 证据（NVDA v2 运行）----
INSERT INTO agent_evidence (id, run_id, role, evidence_type, title, content, source_url, source_name, fetched_at, relevance_score, owner) VALUES
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'fundamental', 'financial', 'FY2026 Q2 财报', '数据中心收入同比 +56%，毛利率 73.5%，经营现金流 265 亿美元。指引 Q3 收入约 520 亿美元。', NULL, '公司财报', '2026-10-28 09:31:00+08', 0.95, ROW('demo-user')::user_profile),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'news', 'news', 'Blackwell Ultra 出货爬坡快于预期', '供应链调研显示 NVL72 机柜交付排期已至 2027 年中，云厂商追加订单。', NULL, '供应链说明会纪要', '2026-10-28 09:32:00+08', 0.88, ROW('demo-user')::user_profile),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', 'technical', 'price', '价格与技术形态', '收盘 312.40，60 日涨幅 +24%，处于上升通道；成交量温和放大。', NULL, '行情数据', '2026-10-28 09:31:30+08', 0.72, ROW('demo-user')::user_profile),
  ('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000002', 'fundamental', 'indicator', '估值指标', 'PE(TTM) 48 倍 vs 5 年中位数 42 倍；PE(前瞻) 32 倍；PEG 约 1.1。', NULL, '估值数据库', '2026-10-28 09:31:40+08', 0.85, ROW('demo-user')::user_profile),
  ('20000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000002', 'macro', 'other', '宏观与利率环境', '美联储 2027 年降息路径预期升温，10 年期美债利率 4.1%，成长股估值压力有限。', NULL, '宏观周报', '2026-10-28 09:33:00+08', 0.55, ROW('demo-user')::user_profile),
  ('20000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000002', 'fundamental', 'rating', '卖方一致预期', '34/38 位分析师评级 Buy 及以上，平均目标价 350 美元。', NULL, '分析师一致预期', '2026-10-28 09:34:00+08', 0.68, ROW('demo-user')::user_profile);

-- ---- 多空辩论论点（NVDA v2）----
INSERT INTO bull_bear_arguments (id, run_id, side, round, argument, evidence_ids, owner) VALUES
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'bull', 1, '需求侧：四大云厂商 2027 年 AI 资本开支指引合计同比 +35% 以上，Blackwell NVL72 排产至 2027 年中，训练与推理需求双轮驱动，收入能见度是历史最高水平。', '["20000000-0000-4000-8000-000000000002","20000000-0000-4000-8000-000000000006"]', ROW('demo-user')::user_profile),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'bear', 1, '客户集中与循环交易：前四大客户占数据中心收入约 60%，且 OpenAI/Anthropic 等以股权绑定方式采购算力，收入质量与周期反转时的脆弱性被低估。', '["20000000-0000-4000-8000-000000000001"]', ROW('demo-user')::user_profile),
  ('30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', 'bull', 2, '生态壁垒：CUDA 开发者突破 1000 万，NIM 企业级订阅收入开始放量，推理侧软件粘性高于训练侧，切换成本随时间加深而非衰减。', '["20000000-0000-4000-8000-000000000006"]', ROW('demo-user')::user_profile),
  ('30000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000002', 'bear', 2, '估值分位：PE(TTM) 处 5 年 65% 分位，若 2027 年收入增速自 +55% 回落至 +25%，存在估值与盈利双杀风险；当前价格对执行零容错。', '["20000000-0000-4000-8000-000000000004"]', ROW('demo-user')::user_profile);

-- ---- 辩论记录（NVDA v2）----
INSERT INTO debate_records (id, run_id, round, speaker, content, tokens_used, owner) VALUES
  ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 1, 'moderator', '议题设定：Blackwell 周期的持续性 vs 出口管制与客户集中度风险。要求所有论点引用证据编号。', 320, ROW('demo-user')::user_profile),
  ('40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 1, 'bull', '核心论点：需求能见度历史最高（证据 2、6）。2027 资本开支指引上修 + NVL72 排产排至年中，收入确定性极强；CUDA 生态使份额在推理时代继续巩固。', 1450, ROW('demo-user')::user_profile),
  ('40000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', 1, 'bear', '核心论点：客户集中 60% + 循环交易结构（证据 1），周期反转时收入弹性同样巨大；叠加 65% 估值分位（证据 4），安全边际不足。', 1380, ROW('demo-user')::user_profile),
  ('40000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000002', 2, 'critic', '推翻与修正：① Bull 的"增速长期 50%+"未考虑基数效应——若 2027 资本开支增速降至 +15%，收入增速将回落至 25-30%，该论点被修正；② Bear 的"估值分位"忽略收入结构变化（软件订阅占比提升抬升合理中枢），论点部分驳回，分位数本身仍有效。', 2200, ROW('demo-user')::user_profile),
  ('40000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000002', 2, 'moderator', '收敛结论：基准情景 2027 收入增速下修至 +28%；估值中枢因软件收入上修 5%。多空得分 bull 3:2，进入风控门检查。', 290, ROW('demo-user')::user_profile);

-- ---- 最终评级 ----
INSERT INTO agent_ratings (id, run_id, ticker, rating, confidence, target_price, action, aggregation_logic, key_uncertainty, bull_summary, bear_summary, catalysts, risks, owner) VALUES
  ('50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'NVDA', 'Hold', 'medium', 340.00, '持有', '辩论得分 bull 2:2 平衡；估值分位处于高位但盈利质量未见恶化，等待 Q3 财报验证', 'Blackwell 出货节奏与出口政策', '需求能见度高，CUDA 生态壁垒深', '客户集中度高，估值分位 65%', 'Q3 财报；GTC 2027', '出口管制；资本开支周期见顶', ROW('demo-user')::user_profile),
  ('50000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'NVDA', 'Buy', 'high', 380.00, '持有', '辩论得分 bull 3:2；批评者修正后基准情景增速 +28% 但确定性上移；风控硬门全部通过，行业敞口软约束触发提示', '对华出口政策与超大客户资本开支的可持续性', 'Blackwell 出货超预期 + 2027 资本开支上修 + 生态粘性加深', '客户集中 60% 与循环交易；估值分位 65%', '11-19 Q3 财报；Rubin 平台 2026H2 流片；GTC 2027.3', '出口管制升级；资本开支见顶；自研芯片分流', ROW('demo-user')::user_profile),
  ('50000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000003', '0700', 'Buy', 'high', 720.00, '持有', '辩论得分 bull 3:1；游戏与广告双引擎稳定，AI 提效尚未完全计价；风控全部通过', '视频号广告加载率提升节奏与新游戏流水', '视频号广告 + AI 提效 + 回购注销', '宏观消费疲软与游戏监管反复', '11-13 Q3 财报；新游戏版号', '监管政策；消费复苏不及预期', ROW('demo-user')::user_profile);

-- ---- 风控门结果（NVDA v2 触发一条软约束）----
INSERT INTO risk_gate_results (id, run_id, rule_name, rule_type, passed, current_value, threshold_value, detail, suggested_action, owner) VALUES
  ('60000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '单一公司合并敞口上限', 'hard', true, 18.7, 25, 'NVDA 市值 12,496 / 组合 66,714 美元', NULL, ROW('demo-user')::user_profile),
  ('60000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', '单一行业敞口上限', 'soft', false, 31.0, 30, '半导体（NVDA+TSM）合计敞口 31.0% 超过 30% 上限', 'TSM 与 NVDA 同向性强，建议止盈再平衡其中之一或暂停加仓', ROW('demo-user')::user_profile),
  ('60000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', '现金比例下限', 'soft', true, 24.6, 7.5, '现金 16,433 / 总资产 66,714 美元', NULL, ROW('demo-user')::user_profile),
  ('60000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000002', '个股回撤强制重检', 'hard', true, 0, 20, '现价高于成本 81%，无回撤', NULL, ROW('demo-user')::user_profile),
  ('60000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000002', '个股止盈线', 'soft', false, 81.0, 50, '浮盈 81% 超过止盈线，已于 10-08 部分止盈（卖出 10 股）', '可继续分批止盈，每次约 1/8 仓位', ROW('demo-user')::user_profile),
  ('60000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000003', '单一公司合并敞口上限', 'hard', true, 12.6, 25, '0700 市值 65,200 HKD ≈ 8,389 / 组合 66,714 美元', NULL, ROW('demo-user')::user_profile),
  ('60000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000003', '单一行业敞口上限', 'soft', true, 19.8, 30, '互联网（0700）+（watchlist 未计入持仓）', NULL, ROW('demo-user')::user_profile),
  ('60000000-0000-4000-8000-000000000008', '10000000-0000-4000-8000-000000000003', '现金比例下限', 'soft', true, 24.6, 7.5, '现金 16,433 / 总资产 66,714 美元', NULL, ROW('demo-user')::user_profile),
  ('60000000-0000-4000-8000-000000000009', '10000000-0000-4000-8000-000000000003', '个股回撤强制重检', 'hard', true, 0, 20, '现价高于成本 34%，无回撤', NULL, ROW('demo-user')::user_profile);

-- ============================================================
-- 13. 深度研报（14 节，全部虚构）
-- ============================================================

-- ---- NVDA v2（2026-10-28，完整版：Hold 上调至 Buy）----
INSERT INTO deep_report (id, run_id, ticker, rating, confidence, target_bear, target_base, target_bull, prob_bear, prob_base, prob_bull, core_thesis, view_change, prev_rating, company_overview, business_model, moat, revenue_structure, financial_annual, financial_quarterly, profitability, balance_sheet, cash_flow, financial_quality, segment_analysis, valuation_relative, valuation_sotp, valuation_methodology, industry_overview, market_size, competitive_position, industry_trends, bull_points, bear_points, critic_points, revised_assumptions, catalysts_timeline, risk_items, risk_gate_snapshot, pm_action, pm_price_range, pm_position_size, pm_stop_loss, pm_execution_plan, tracking_metrics, view_change_triggers, owner) VALUES
(
  '70000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000002',
  'NVDA', 'Buy', 'high', 255, 380, 460, 0.20, 0.55, 0.25,
  '英伟达是本轮全球 AI 资本开支周期的核心受益者：数据中心 GPU 与网络全栈份额领先，CUDA 软件生态构成十五年沉淀的切换成本。FY2026 上半年数据中心收入同比 +56%，Blackwell Ultra 出货爬坡快于预期，云厂商 2027 年资本开支指引继续上修。当前 PE(TTM) 约 48 倍、处 5 年 65% 分位，但盈利增速仍高于估值扩张（PEG 约 1.1）。三情景目标价 255/380/460（概率 20/55/25），期望值显著高于现价 312.40。风险集中在对华出口政策与超大客户集中度，已部分计价。评级 Buy，基准目标 380。',
  '较 v1（2026-10-14，Hold，目标 340）上调至 Buy：①Blackwell Ultra 出货超预期，Q3 收入指引上修；②批评者对"估值分位过高"的质疑被收入结构变化（软件订阅占比提升）部分驳回；③出口管制边际影响已在 H1 量化（约 4% 收入）。目标价 340 → 380，置信度 medium → high。',
  'Hold',
  '全球 GPU 与 AI 计算平台龙头，1993 年成立，1999 年发明 GPU。四大业务板块：数据中心（GPU/网络/软件订阅）、游戏、专业可视化、汽车。FY2026E 数据中心收入占比约 88%。创始人黄仁勋长期掌舵，研发投入约占收入 20%。',
  '卖铲人模式：硬件（GPU/网络）+ 软件（CUDA/企业订阅 NIM）+ 系统级交付（NVL72 整机柜）。数据中心客户为云厂商与主权 AI，年度平台节奏（Hopper → Blackwell → Rubin）驱动持续升级。软件生态（1000 万+ 开发者）构成主要护城河。',
  '1) CUDA 生态：十五年积累的开发者与库绑定，迁移成本极高；2) 全栈整合：GPU + 网络（NVLink/InfiniBand）+ 整机（DGX/HGX）协同优化；3) 世代节奏：每年一代平台，竞争对手始终追赶上一代；4) 供应生态：与台积电 CoWoS 先进封装产能深度绑定。',
  '[{"segment":"数据中心","revenue":"115200","sharePct":"88.0","yoyPct":"+58"},{"segment":"游戏","revenue":"9800","sharePct":"7.5","yoyPct":"+12"},{"segment":"专业可视化","revenue":"3400","sharePct":"2.6","yoyPct":"+21"},{"segment":"汽车与自动驾驶","revenue":"2600","sharePct":"2.0","yoyPct":"+45"}]',
  '[{"period":"FY2024A","revenue":"60922","netProfit":"29760","revenueYoy":"+126","profitYoy":"+581"},{"period":"FY2025A","revenue":"130497","netProfit":"72880","revenueYoy":"+114","profitYoy":"+145"},{"period":"FY2026E","revenue":"195000","netProfit":"105000","revenueYoy":"+49","profitYoy":"+44"}]',
  '[{"period":"FY2026Q1","revenue":"44100","netProfit":"18780","revenueYoy":"+69","profitYoy":"+56"},{"period":"FY2026Q2","revenue":"46700","netProfit":"21700","revenueYoy":"+56","profitYoy":"+62"},{"period":"FY2026Q3E","revenue":"约52000","netProfit":"约24500","revenueYoy":"+55","profitYoy":"+55"}]',
  '[{"metric":"毛利率","value":"73.5 (Q2)","ttm":"约74","industry":"半导体行业约50-60"},{"metric":"净利率","value":"46.5 (Q2)","ttm":"约48","industry":"—"},{"metric":"ROE","value":"约105 (TTM)","ttm":"—","industry":"—"},{"metric":"经营现金流/净利润","value":"约1.1","ttm":"—","industry":">1 为优"}]',
  '[{"item":"现金及等价物","value":"60600","note":"净现金约 350 亿美元"},{"item":"存货","value":"19800","note":"Blackwell 备货，与订单能见度匹配"},{"item":"总资产","value":"124000","note":"—"},{"item":"总负债","value":"34700","note":"含少量可转债"},{"item":"股东权益","value":"89300","note":"—"}]',
  '[{"item":"经营现金流 (TTM)","value":"92000","note":"—"},{"item":"资本开支","value":"-5200","note":"轻资产模式"},{"item":"自由现金流","value":"86800","note":"—"},{"item":"回购+分红","value":"-34000","note":"持续回馈股东"}]',
  '盈利质量极佳：经营现金流/净利润约 1.1，净现金约 350 亿美元，无有息负债压力。存货上升主要系 Blackwell 备货，与订单能见度匹配。唯一减分项是客户集中度（前四大云厂商约占数据中心收入 60%）。',
  '[{"name":"数据中心","revenue":"115200","grossMargin":"约78","growthPct":"+58","outlook":"2027 资本开支指引继续上修，Rubin 平台接力"},{"name":"游戏","revenue":"9800","grossMargin":"约62","growthPct":"+12","outlook":"RTX 50 系列周期中段，稳健"},{"name":"专业可视化","revenue":"3400","grossMargin":"约60","growthPct":"+21","outlook":"工业数字孪生缓慢放量"},{"name":"汽车","revenue":"2600","grossMargin":"约55","growthPct":"+45","outlook":"智驾训练需求驱动，基数小"}]',
  '[{"metric":"PE (TTM)","current":"48","percentile5y":"65%","industryAvg":"约30","note":"盈利增速显著高于行业"},{"metric":"PE (前瞻)","current":"32","percentile5y":"45%","industryAvg":"约25","note":"—"},{"metric":"PEG","current":"1.1","percentile5y":"—","industryAvg":"—","note":"成长股合理区间"}]',
  '[{"segment":"数据中心","valuation":"340","method":"PE/DCF 混合","multiple":"32"},{"segment":"游戏","valuation":"22","method":"PE 22x","multiple":"22"},{"segment":"专业可视化+汽车","valuation":"13","method":"PS 6x","multiple":"6"},{"segment":"净现金","valuation":"5","method":"账面","multiple":null}]',
  'SOTP 分部估值 + 情景概率加权：数据中心占目标价 89%，其余分部 PE/PS，净现金按账面。三情景 255/380/460 概率 20/55/25，期望约 374；基准目标 380 对应前瞻 PE 约 39 倍。',
  'AI 算力行业处于资本开支超级周期：2026 年全球超大规模云厂商资本开支预计超 6000 亿美元（同比 +40% 以上），推理需求接棒训练成为主要增量。竞争上 AMD MI 系列在推理侧起量、云厂商自研 ASIC 分流部分负载，但高端训练与生态绑定仍由 NVIDIA 主导。',
  '2026 年数据中心加速计算市场约 4000 亿美元，2030 年预期超 1 万亿美元（CAGR 约 25%）；推理占比由 2024 年的 40% 提升至 2026 年的 60% 以上。',
  '训练芯片份额约 90%，推理芯片份额约 75%（自研 ASIC 分流前）。相对 AMD：软件生态与 NVLink 系统级优势；相对云厂商自研：通用性与部署速度优势。最大长期威胁是推理侧商品化。',
  '①推理需求指数级增长，token 成本下降但总量上升更快；②主权 AI（各国自建算力）成为新增长极；③液冷与机柜级交付（NVL72）成为标配；④Rubin 平台 2027 年量产。',
  '[{"id":"u-bull-1","title":"Blackwell Ultra 出货超预期","detail":"Q2 出货爬坡快于指引，NVL72 机柜交付排期至 2027 年中，云厂商追加订单"},{"id":"u-bull-2","title":"2027 资本开支指引上修","detail":"四大云厂商 2027 年 AI 资本开支指引合计同比 +35% 以上，训练与推理双轮驱动"},{"id":"u-bull-3","title":"CUDA 生态护城河加深","detail":"开发者突破 1000 万，NIM 企业级订阅收入开始放量"}]',
  '[{"id":"u-bear-1","title":"出口管制尾部风险","detail":"对华特供芯片政策仍有收紧可能，H1 已量化影响约 4% 收入，极端情形 8-10%"},{"id":"u-bear-2","title":"客户集中与循环交易","detail":"前四大客户占数据中心收入约 60%，部分客户以融资/股权绑定方式采购，收入质量存疑"},{"id":"u-bear-3","title":"估值分位偏高","detail":"PE(TTM) 处 5 年 65% 分位，若增速换挡（+55% → +25%）存在双杀风险"}]',
  '[{"id":"u-critic-1","originalClaim":"数据中心收入增速将长期维持 50%+","critique":"基数效应下增速必然衰减；若 2027 资本开支增速降至 +15%，收入增速将回落至 25-30% 区间","resolved":true,"revision":"基准情景 2027 收入增速下修至 +28%，牛市情景 +35%"},{"id":"u-critic-2","originalClaim":"估值分位偏高（65%）构成主要风险","critique":"分位数忽略盈利结构变化：软件订阅与重复性收入占比提升抬升合理估值中枢，纯历史分位比较会低估合理估值","resolved":false,"revision":null}]',
  '①基准情景 2027 数据中心收入增速由 +35% 下修至 +28%（批评者基数效应论点成立）；②估值中枢因软件收入占比提升上修 5%；③出口管制影响按基准 4% / 熊市 10% 量化计入。',
  '[{"id":"u-cat-1","date":"2026-11-19","title":"FY2026 Q3 财报","type":"earnings","impact":"positive","detail":"市场预期收入约 520 亿美元，指引 Q4 560 亿+"},{"id":"u-cat-2","date":"2027-03","title":"GTC 2027","type":"product","impact":"positive","detail":"Rubin 平台细节与量产时间表"},{"id":"u-cat-3","date":"2026-12","title":"对华出口政策年度审查","type":"policy","impact":"negative","detail":"特供芯片规格限制存在收紧风险"},{"id":"u-cat-4","date":"2027-01","title":"云厂商 Q4 财报资本开支指引","type":"industry","impact":"positive","detail":"2027 全年资本开支定调"}]',
  '[{"id":"u-risk-1","risk":"出口管制升级","probability":"medium","impact":"high","mitigation":"熊市情景已按 10% 收入影响计价；关注 12 月政策审查"},{"id":"u-risk-2","risk":"AI 资本开支周期见顶","probability":"low","impact":"high","mitigation":"跟踪云厂商资本开支/折旧比与推理 token 增速；连续两季下滑触发减仓"},{"id":"u-risk-3","risk":"客户自研芯片分流","probability":"medium","impact":"medium","mitigation":"监控推理份额变化；CUDA 生态绑定提供缓冲"},{"id":"u-risk-4","risk":"高估值下盈利不及预期","probability":"medium","impact":"medium","mitigation":"止损纪律：较成本 -15% 或前瞻 PE 回落至 25x 以下重检"}]',
  '[{"ruleName":"单一公司合并敞口上限","ruleType":"hard","passed":true,"currentValue":18.7,"thresholdValue":25,"detail":"NVDA 市值 12,496 / 组合 66,714","suggestedAction":null},{"ruleName":"单一行业敞口上限","ruleType":"soft","passed":false,"currentValue":31,"thresholdValue":30,"detail":"半导体（NVDA+TSM）合计敞口 31.0% 超过 30%","suggestedAction":"TSM 与 NVDA 同向性强，建议止盈再平衡或暂停加仓"},{"ruleName":"现金比例下限","ruleType":"soft","passed":true,"currentValue":24.6,"thresholdValue":7.5,"detail":"现金 16,433 / 总资产 66,714","suggestedAction":null},{"ruleName":"个股回撤强制重检","ruleType":"hard","passed":true,"currentValue":0,"thresholdValue":20,"detail":"现价高于成本 81%，无回撤","suggestedAction":null},{"ruleName":"个股止盈线","ruleType":"soft","passed":false,"currentValue":81,"thresholdValue":50,"detail":"浮盈 81% 超过止盈线，已于 10-08 部分止盈","suggestedAction":"可继续分批止盈，每次约 1/8 仓位"}]',
  '持有为主，回调分批加仓。已实现部分止盈（10 股 @ 290），剩余 40 股持有至基本面变化或到达目标价。',
  '加仓区间 280-300；减仓区间 400 以上',
  '当前 18.7% 仓位，上限 20%（受行业敞口约束：与 TSM 合计不超 30%）',
  '硬止损 265（约 -15%）；前瞻 PE < 25x 或资本开支指引连续两季下滑触发重检',
  '①11-19 财报前不加仓；②财报后若指引超预期且回调至 300 以下，加仓 1/3 目标量；③半导体敞口优先通过 TSM 止盈而非 NVDA 减仓来平衡。',
  '[{"metric":"数据中心收入增速","threshold":"<25%","direction":"below","frequency":"季度"},{"metric":"四大云厂商资本开支增速","threshold":"+15%","direction":"above","frequency":"季度"},{"metric":"推理 token 用量增速","threshold":"+40%","direction":"above","frequency":"月度"}]',
  '①对华出口政策实质收紧（熊市情景概率上调至 35%+）；②云厂商资本开支指引转负；③数据中心收入增速跌破 25%；④前瞻 PE 突破 45x 且盈利不上修。',
  ROW('demo-user')::user_profile
);

-- ---- NVDA v1（2026-10-14，上一版本：Hold）----
INSERT INTO deep_report (id, run_id, ticker, rating, confidence, target_bear, target_base, target_bull, prob_bear, prob_base, prob_bull, core_thesis, view_change, prev_rating, company_overview, business_model, moat, revenue_structure, financial_annual, financial_quarterly, profitability, financial_quality, valuation_relative, valuation_methodology, industry_overview, bull_points, bear_points, critic_points, risk_items, risk_gate_snapshot, pm_action, pm_position_size, pm_stop_loss, owner) VALUES
(
  '70000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'NVDA', 'Hold', 'medium', 245, 340, 420, 0.25, 0.50, 0.25,
  'AI 算力需求强劲但 Blackwell 出货节奏尚待验证，估值处 5 年 65% 分位、计入较多乐观预期。多空论点得分接近（2:2），等待 Q3 财报与出货数据验证后再上调。评级 Hold，目标 340。',
  NULL, NULL,
  '全球 GPU 与 AI 计算平台龙头，数据中心占比约 88%。',
  '卖铲人模式：硬件 + CUDA 软件 + 系统级交付，年度平台节奏驱动升级。',
  'CUDA 生态、全栈整合、世代节奏、CoWoS 产能绑定。',
  '[{"segment":"数据中心","revenue":"115200","sharePct":"88.0","yoyPct":"+58"},{"segment":"游戏","revenue":"9800","sharePct":"7.5","yoyPct":"+12"},{"segment":"其他","revenue":"6000","sharePct":"4.5","yoyPct":"+30"}]',
  '[{"period":"FY2025A","revenue":"130497","netProfit":"72880","revenueYoy":"+114","profitYoy":"+145"},{"period":"FY2026E","revenue":"195000","netProfit":"105000","revenueYoy":"+49","profitYoy":"+44"}]',
  '[{"period":"FY2026Q1","revenue":"44100","netProfit":"18780","revenueYoy":"+69","profitYoy":"+56"},{"period":"FY2026Q2","revenue":"46700","netProfit":"21700","revenueYoy":"+56","profitYoy":"+62"}]',
  '[{"metric":"毛利率","value":"73.5 (Q2)","ttm":"约74","industry":"半导体约50-60"},{"metric":"净利率","value":"46.5 (Q2)","ttm":"约48","industry":"—"}]',
  '经营现金流/净利润约 1.1，净现金约 350 亿美元；客户集中度是主要减分项。',
  '[{"metric":"PE (TTM)","current":"52","percentile5y":"72%","industryAvg":"约30","note":"当时估值更高"},{"metric":"PE (前瞻)","current":"35","percentile5y":"50%","industryAvg":"约25","note":"—"}]',
  '情景概率加权：245/340/420 概率 25/50/25，期望约 316，与现价接近，缺乏安全边际，故 Hold。',
  'AI 资本开支超级周期持续，但市场分歧开始出现。',
  '[{"id":"u-bull-1","title":"需求能见度高","detail":"云厂商资本开支持续上修"},{"id":"u-bull-2","title":"生态壁垒","detail":"CUDA 开发者粘性极强"}]',
  '[{"id":"u-bear-1","title":"估值分位","detail":"PE 处 5 年 72% 分位，安全边际不足"},{"id":"u-bear-2","title":"出货节奏风险","detail":"Blackwell 爬坡若不及预期将触发下修"}]',
  '[{"id":"u-critic-1","originalClaim":"出货爬坡无忧","critique":"NVL72 散热与交付问题在早期批次仍有反复","resolved":false,"revision":null}]',
  '[{"id":"u-risk-1","risk":"出口管制","probability":"medium","impact":"high","mitigation":"熊市情景已计价"},{"id":"u-risk-2","risk":"估值回撤","probability":"medium","impact":"medium","mitigation":"分批建仓摊低成本"}]',
  '[{"ruleName":"单一公司合并敞口上限","ruleType":"hard","passed":true,"currentValue":18.7,"thresholdValue":25,"detail":"—","suggestedAction":null},{"ruleName":"单一行业敞口上限","ruleType":"soft","passed":false,"currentValue":31,"thresholdValue":30,"detail":"半导体合计 31.0%","suggestedAction":"关注行业集中度"}]',
  '持有等待验证，财报前不加仓。',
  '18.7%，与行业敞口联动管理',
  '硬止损 265',
  ROW('demo-user')::user_profile
);

-- ---- 0700 腾讯（2026-10-26）----
INSERT INTO deep_report (id, run_id, ticker, rating, confidence, target_bear, target_base, target_bull, prob_bear, prob_base, prob_bull, core_thesis, view_change, prev_rating, company_overview, business_model, moat, revenue_structure, financial_annual, financial_quarterly, profitability, financial_quality, valuation_relative, valuation_methodology, industry_overview, bull_points, bear_points, critic_points, risk_items, risk_gate_snapshot, pm_action, pm_position_size, pm_stop_loss, owner) VALUES
(
  '70000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000003',
  '0700', 'Buy', 'high', 560, 720, 880, 0.20, 0.55, 0.25,
  '游戏常青 + 视频号广告放量 + AI 提效的三重引擎。微信生态（13.9 亿 MAU）货币化空间仍大，视频号广告加载率仅为朋友圈的一半，提升路径清晰；游戏储备充足且长青基本盘稳固。回购注销持续，股东回报明确。三情景目标价 560/720/880 港元（概率 20/55/25），现价 652 对应基准空间约 10% + 股息回购约 2%。评级 Buy，目标 720。',
  '维持 Buy 不变。目标价由 690 上调至 720：视频号广告收入连续三季超预期 + 游戏流水回暖 + AI 对内部研发提效开始量化体现。',
  'Buy',
  '中国最大互联网综合平台：社交（微信/QQ）、游戏（全球最大游戏公司之一）、数字内容、金融科技与企业服务。1998 年成立，2004 年港股上市。',
  '社交流量为根基：游戏与广告变现高毛利流量，金融科技与企业服务提供第二曲线。视频号补齐短视频生态闭环。',
  '1) 微信生态网络效应：13.9 亿 MAU + 小程序/视频号/企业微信矩阵；2) 游戏工业化能力与 IP 储备；3) 社交关系链迁移成本极高。',
  '[{"segment":"增值服务(游戏+社交)","revenue":"161500","sharePct":"47.0","yoyPct":"+9"},{"segment":"营销服务(广告)","revenue":"124000","sharePct":"36.1","yoyPct":"+19"},{"segment":"金融科技与企业服务","revenue":"58500","sharePct":"16.9","yoyPct":"+6"}]',
  '[{"period":"2024A","revenue":"660300","netProfit":"194100","revenueYoy":"+8","profitYoy":"+68"},{"period":"2025A","revenue":"344000","netProfit":"122000","revenueYoy":"-48","profitYoy":"-37"},{"period":"2026E","revenue":"362000","netProfit":"131000","revenueYoy":"+5","profitYoy":"+7"}]',
  '[{"period":"2026Q1","revenue":"86100","netProfit":"30200","revenueYoy":"+7","profitYoy":"+11"},{"period":"2026Q2","revenue":"91500","netProfit":"33800","revenueYoy":"+10","profitYoy":"+14"},{"period":"2026Q3E","revenue":"约96000","netProfit":"约36000","revenueYoy":"+11","profitYoy":"+12"}]',
  '[{"metric":"毛利率","value":"54.2 (Q2)","ttm":"约53","industry":"互联网平台约40-60"},{"metric":"净利率","value":"37.0 (Q2)","ttm":"约35","industry":"—"},{"metric":"ROE","value":"约19 (TTM)","ttm":"—","industry":"—"}]',
  '经营现金流/净利润约 1.2，净现金约 1800 亿人民币；回购注销持续（每年约千亿港币）。',
  '[{"metric":"PE (TTM)","current":"22","percentile5y":"38%","industryAvg":"约25","note":"低于自身历史中枢"},{"metric":"PE (前瞻)","current":"19","percentile5y":"30%","industryAvg":"约22","note":"—"}]',
  '分部估值：游戏 18x + 广告 20x + 金融科技与企业服务 12x，加净现金；情景概率加权 560/720/880（20/55/25），期望约 722。',
  '中国互联网平台监管常态化，AI 应用落地加速；游戏出海与视频号是行业主要增量。',
  '[{"id":"t-bull-1","title":"视频号广告放量","detail":"加载率约为朋友圈一半，提升空间明确，连续三季超预期"},{"id":"t-bull-2","title":"AI 提效","detail":"混元大模型对广告推荐与游戏研发提效开始量化体现"},{"id":"t-bull-3","title":"股东回报","detail":"每年约千亿港币回购注销 + 约 2% 股息"}]',
  '[{"id":"t-bear-1","title":"宏观消费疲软","detail":"广告与支付增速与宏观强相关，复苏斜率存在不确定性"},{"id":"t-bear-2","title":"游戏监管反复","detail":"版号与未成年人政策仍是长期尾部风险"}]',
  '[{"id":"t-critic-1","originalClaim":"AI 提效可直接增厚利润","critique":"当前证据仅为内部试点数据，规模化证据不足，论点降级为观察项","resolved":true,"revision":"AI 提效从核心论点降级为跟踪指标"}]',
  '[{"id":"t-risk-1","risk":"宏观消费不及预期","probability":"medium","impact":"medium","mitigation":"游戏出海对冲国内周期"},{"id":"t-risk-2","risk":"监管政策反复","probability":"low","impact":"high","mitigation":"合规体系成熟，仓位上限 25% 内分散"}]',
  '[{"ruleName":"单一公司合并敞口上限","ruleType":"hard","passed":true,"currentValue":12.6,"thresholdValue":25,"detail":"0700 市值 65,200 HKD ≈ 8,389 美元","suggestedAction":null},{"ruleName":"现金比例下限","ruleType":"soft","passed":true,"currentValue":24.6,"thresholdValue":7.5,"detail":"—","suggestedAction":null}]',
  '持有，11-13 财报前不加仓；回调至 600 以下分批加仓。',
  '12.6%，距上限充足',
  '硬止损 555（约 -15%）',
  ROW('demo-user')::user_profile
);
