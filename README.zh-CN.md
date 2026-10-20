[English](README.md) | 简体中文

# Daily Portfolio Analysis（每日持仓分析）

Daily Portfolio Analysis 是一个全栈股票持仓管理终端。每个交易日收盘后，系统对全部持仓进行逐一体检，扫描关注列表中的交易机会，并记录当日净值快照与投资日志。针对单只股票，可运行多智能体深度分析，输出包含多空辩论与风控检查的深度研究报告。

系统采用前后端分离架构，所有业务数据存储于后端 PostgreSQL，并按账号行级隔离；在电脑或手机上登录同一账号即可访问同一份数据，历史评级、交易记录与深度报告均长期保留。

系统由两部分组成。一个是全栈交易终端（NestJS + React + PostgreSQL），负责账户、交易、评级与报告的权威落库；另一个是位于 `agent/` 的独立 Python 智能体服务，承担行情查询、研究与分析等推理任务。后端是唯一的业务编排者和数据出口，通过受保护的 HTTP 接口把推理任务委托给智能体；智能体与模型厂商解耦，可切换火山方舟、DeepSeek 或任意 OpenAI 兼容接口，并且不直接访问业务数据库。

## 功能特性

- **仪表盘**：账户总值、市值、成本、累计与当日盈亏，支持按自定义分组汇总（如「Alpha Picks 定投」与「自主持仓」分开统计）。
- **持仓管理**：每只股票的评级、操作建议与目标价；桌面端表格视图，手机端卡片视图。
- **关注列表**：记录目标买入价与交易信号，每日扫描买卖机会。
- **每日分析**：每只持仓与关注股对应一张分析卡片，包含评级、操作、目标价、催化剂与风险。
- **多智能体深度报告**：包含 14 个板块的研究报告（核心论点、财务、SOTP 分部估值、多空辩论、Critic 批判、风控闸、PM 决策等）；每次运行均保留一个新版本并附带生成时间。
- **独立 Python Agent 服务**：位于 `agent/`，模型层与厂商解耦（火山方舟 / DeepSeek / 任意 OpenAI 兼容接口），内置工具调用、规划、检查点与多智能体编排，运行过程可回放；它只通过后端 HTTP API 取数，不直连业务数据库。
- **本地 Coding Agent 控制台**（`/dev`）：第二个 Agent 角色，在受控内环（复现 → 诊断 → 打补丁 → 门控验证，失败自动回滚）中修复 Webapp。Nest 开发模块以命令白名单、不走 shell 的方式拉起本机 Python Agent，只以磁盘上的任务工件为唯一权威；浏览器驱动整个流程，每一次改动都必须显式批准或拒绝。全栈 E2E 用确定性假 agent 跑在隔离端口上，既不触碰正在运行的开发栈，也不调用大模型。
- **已实现盈亏**：交易记录页以 Robinhood 风格汇总 Realized P&L，按股票与币种统计，替代原已平仓列表。
- **策略规则**：风控规则（单一公司敞口上限、杠杆 ETF 上限、现金缓冲、止损线）可在页面上配置，并在分析时作为硬性闸门。
- **投资日志与快照**：自动生成五段式投资日志，净值曲线基于每日快照。
- **多币种**：USD / HKD / CNY 分账核算，并按汇率折算汇总。
- 支持深色模式、移动端安全区适配，并可「添加到主屏幕」作为 PWA 使用。

## 项目架构

### 总体架构

前端为 React SPA，后端为 NestJS，数据库为 PostgreSQL。行情数据由浏览器直接向 Finnhub 请求，API Token 仅存储于本地设备；多智能体分析中的推理由后端调用火山方舟（豆包）大模型完成；汇率数据由后端 FX 模块统一获取。

先看系统边界（总览）：

```mermaid
flowchart LR
    User["用户（浏览器 / 手机）"] --> Web["Webapp<br/>React · NestJS · PostgreSQL<br/>账户 · 交易 · 风控 · 鉴权 · 数据"]
    Web <-->|"HTTP / SSE · x-agent-token 鉴权"| Agent["Python Agent 服务<br/>研究 · 工具调用 · 推理 · 多角色分析"]
    Agent --> LLM["大模型（可切换）<br/>火山方舟 · DeepSeek · OpenAI 兼容"]
    Agent --> Ext["外部数据源"]

    classDef actor fill:#57606a,stroke:#24292f,color:#ffffff,stroke-width:2px
    classDef web fill:#2da44e,stroke:#116329,color:#ffffff,stroke-width:2px
    classDef py fill:#8250df,stroke:#5a2f9e,color:#ffffff,stroke-width:2px
    classDef ext fill:#a371f7,stroke:#6e40c9,color:#ffffff,stroke-width:2px
    class User actor
    class Web web
    class Agent py
    class LLM,Ext ext
```

后端是唯一的系统记录层，Agent 只通过受控接口取数、产出分析，不直接读写数据库；下面展开各组件与数据流。

```mermaid
flowchart TB
    subgraph Browser["浏览器 / 手机 PWA"]
        P["React 页面<br/>Dashboard · Holdings · Watchlist<br/>Analysis · Journal · Transactions"]:::fe
        H["自定义 Hooks<br/>useMarketQuotes · useTheme"]:::fe
        AC["api/index.ts<br/>axiosForBackend 统一封装"]:::fe
        P --> AC
        P --> H
    end

    subgraph Server["NestJS 后端（编排中枢）"]
        C["Controller 层<br/>@NeedLogin 登录校验<br/>从 req.userContext 获取 userId"]:::ctrl
        S["Service 层<br/>业务逻辑 · Drizzle 查询构造"]:::svc
        MA["内置 multi-agent 模块<br/>pipeline · evidence · llm"]:::svc
        GW["Agent Gateway 网关<br/>x-agent-token · userContext · 开关"]:::gw
        C --> S
        C --> MA
        C --> GW
    end

    subgraph PyAgent["Python Agent 服务（agent/ · 模型无关）"]
        RT["智能体运行时<br/>ReAct 循环 · 规划 · 检查点"]:::py
        TOOLS["工具层<br/>行情 · 网页 · 财务 · 工作流"]:::py
        MODELS["模型抽象层<br/>方舟 · DeepSeek · OpenAI 兼容"]:::py
        RT --> TOOLS
        RT --> MODELS
    end

    PG[("PostgreSQL<br/>20 张业务表<br/>按 owner 行级隔离")]:::db
    FH["Finnhub<br/>实时行情"]:::ext
    ARK["方舟 / DeepSeek<br/>大模型服务"]:::ext
    FXEXT["汇率数据源"]:::ext

    H -. 浏览器直连 .-> FH
    AC --> C
    S --> PG
    MA --> PG
    MA --> ARK
    S --> FXEXT
    GW -. "HTTP + x-agent-token<br/>（委托智能步骤）" .-> RT
    RT -. "仅走 HTTP API<br/>（不直连数据库）" .-> C
    TOOLS -.-> FH
    MODELS -.-> ARK

    classDef fe fill:#1f6feb,stroke:#0b3d91,color:#ffffff,stroke-width:2px
    classDef ctrl fill:#2da44e,stroke:#116329,color:#ffffff,stroke-width:2px
    classDef svc fill:#f0883e,stroke:#9e4b0f,color:#ffffff,stroke-width:2px
    classDef gw fill:#bc4c00,stroke:#7a2f00,color:#ffffff,stroke-width:2px
    classDef py fill:#8250df,stroke:#5a2f9e,color:#ffffff,stroke-width:2px
    classDef db fill:#0891b2,stroke:#155e75,color:#ffffff,stroke-width:2px
    classDef ext fill:#a371f7,stroke:#6e40c9,color:#ffffff,stroke-width:2px
```

### 智能体推理：内置流水线与独立 Agent 服务

智能分析落在两个位置，分别对应已经在生产运行的业务流水线，和被独立出来的推理服务，职责并不重叠：

- **后端内置分析流水线（NestJS）**：当前每天运行的实现，是一条固定的五阶段流水线（取数 → 多空辩论 → Critic 批判 → 风控闸 → 评级汇总），由后端直接调用大模型，产出 14 个板块的深度报告。
- **独立 Python Agent 服务（`agent/`）**：把推理能力从业务后端中拆出的独立服务。它不依赖重量级 Agent 框架，工具调用、规划、检查点与多智能体编排都在本仓库内实现，便于调试与扩展；模型层与厂商解耦，可切换火山方舟、DeepSeek 或任意 OpenAI 兼容接口。

两者之间是清晰的服务边界。NestJS 负责登录、数据库、交易、权限和页面，是唯一写库的地方；Python Agent 不连接业务库，只通过 Agent Gateway（`x-agent-token` 鉴权、服务端注入用户身份）向后端取数，后端把需要推理的步骤委托给它。这样更换模型、调整推理逻辑或重写 Agent 都不会影响账户与数据，Agent 也可以独立开发和测试。

### 请求链路

所有后端接口遵循统一的分层设计，以持仓接口为例：

- Controller 层通过 `@NeedLogin()` 拦截未登录请求；userId 从 `req.userContext` 获取，不接受前端传入。
- Service 层通过注入的 `DRIZZLE_DATABASE` 句柄访问数据库，所有查询均包含 `owner = userId` 条件，防止越权访问。
- 前后端共享的类型定义（如 `Holding`、`CreateHoldingDto`、`ListResponse<T>`）统一存放于 `shared/api.interface.ts`。

```mermaid
flowchart LR
    Page["页面组件<br/>如 HoldingsPage"]:::fe
    Api["api/index.ts<br/>axiosForBackend"]:::fe
    Ctrl["HoldingsController<br/>@NeedLogin()"]:::ctrl
    Svc["HoldingsService"]:::svc
    Drizzle["Drizzle ORM"]:::drv
    PG[("holdings 表")]:::db

    Page -->|"fetchHoldings()"| Api
    Api -->|"GET /api/portfolio/holdings"| Ctrl
    Ctrl -->|"req.userContext.userId"| Svc
    Svc -->|"db.select()...<br/>where(owner = userId)"| Drizzle
    Drizzle --> PG
    PG -->|"rows"| Svc
    Svc -->|"mapRow → ListResponse"| Page

    classDef fe fill:#1f6feb,stroke:#0b3d91,color:#ffffff,stroke-width:2px
    classDef ctrl fill:#2da44e,stroke:#116329,color:#ffffff,stroke-width:2px
    classDef svc fill:#f0883e,stroke:#9e4b0f,color:#ffffff,stroke-width:2px
    classDef drv fill:#bf5af2,stroke:#8957e5,color:#ffffff,stroke-width:2px
    classDef db fill:#0891b2,stroke:#155e75,color:#ffffff,stroke-width:2px
```

### 多智能体流水线

单只股票的深度分析由五个阶段组成。各阶段状态实时写回 `agent_runs`，前端可轮询展示进度，运行过程中支持随时取消。

```mermaid
flowchart TB
    Start(["创建 agent_run"]):::start
    F["① 取数 fetching<br/>evidence.service 汇总行情、财务、<br/>新闻与组合上下文"]:::phase
    D["② 多空辩论 debating<br/>Bull 研究员撰写多头论点<br/>Bear 研究员撰写空头论点<br/>每条论点须引用证据"]:::phase
    CR["③ Critic 批判 critiquing<br/>质疑数据时效与估值假设<br/>至少推翻一个先验结论"]:::phase
    RG["④ 风控闸 risk_check<br/>逐条对照 strategy_rules<br/>hard 规则不通过则限制评级"]:::gate
    R["⑤ 评级汇总 rating<br/>PM 聚合多空与风控结果<br/>给出评级、置信度与操作方案"]:::phase
    H{"人工决策"}:::decision
    Done(["写入评级<br/>生成深度报告"]):::done

    Start --> F --> D --> CR --> RG --> R --> H
    H -->|"确认"| Done
    H -->|"驳回重跑"| F

    Cancel["取消信号"]:::cancel
    Cancel -.-> F
    Cancel -.-> D
    Cancel -.-> CR

    classDef start fill:#57606a,stroke:#24292f,color:#ffffff,stroke-width:2px
    classDef phase fill:#1f6feb,stroke:#0b3d91,color:#ffffff,stroke-width:2px
    classDef gate fill:#f0883e,stroke:#9e4b0f,color:#ffffff,stroke-width:2px
    classDef decision fill:#f7d046,stroke:#c99c00,color:#24292f,stroke-width:2px
    classDef done fill:#2da44e,stroke:#116329,color:#ffffff,stroke-width:2px
    classDef cancel fill:#cf222e,stroke:#a40e26,color:#ffffff,stroke-width:2px
```

深度报告共 14 个板块，由 `client/src/components/MultiAgent/DeepReportView.tsx` 渲染，数据通过 `GET /api/multi-agent/deep-report/:runId` 获取。

### 本地 Coding Agent 控制台

除投资研究角色外，Python Agent 还内置一个 `coder` 角色，用于开发和修复 Webapp 本身。它以一个自主编码任务的状态机内环运行——复现失败检查、诊断根因、提出补丁、验证；一旦验证失败，带着失败证据自动回滚并回到诊断——同时受迭代次数、模型调用次数和时间预算约束，并有一道硬闸：绝不允许靠放宽测试来强行通过。

这个控制台刻意做成**本地开发工具，而不是云端功能**。云端运行时是只读 FaaS 容器，没有 git、Python 和开发依赖，还有执行时长上限，无法承载"改代码 + 跑测试"这类工作。因此该功能默认关闭，仅在本地开发通过 `AGENT_DEV_ENABLED=true` 启用。

```mermaid
flowchart TB
    Page["浏览器 /dev 页<br/>列表 · 新建弹窗 · 详情<br/>状态步骤条 · 迭代时间线 · diff 查看器"]:::fe
    Page -->|"REST /api/dev（轮询）"| Ctrl["DevAgentController<br/>@NeedLogin · /health 放开"]:::ctrl
    Ctrl --> Svc["DevAgentService<br/>状态校验 · in-flight 锁<br/>run/approve 发后即忘"]:::svc
    Svc --> Reader["TaskArtifactReader<br/>id 白名单 + 路径前缀防护<br/>读 task.json / iterations.jsonl / *.diff"]:::svc
    Svc --> Runner["AgentProcessRunner<br/>spawn argv 数组 · shell:false<br/>子命令白名单 · 超时"]:::gw
    Runner -->|"agent dev new/run/approve/reject --json"| Py["本机 Python coder"]:::py
    Py --> Artifacts["任务工件（唯一权威）<br/>agent/data/coder/tasks/&lt;id&gt;/"]:::db
    Reader --> Artifacts

    classDef fe fill:#1f6feb,stroke:#0b3d91,color:#ffffff,stroke-width:2px
    classDef ctrl fill:#2da44e,stroke:#116329,color:#ffffff,stroke-width:2px
    classDef svc fill:#f0883e,stroke:#9e4b0f,color:#ffffff,stroke-width:2px
    classDef gw fill:#bc4c00,stroke:#7a2f00,color:#ffffff,stroke-width:2px
    classDef py fill:#8250df,stroke:#5a2f9e,color:#ffffff,stroke-width:2px
    classDef db fill:#0891b2,stroke:#155e75,color:#ffffff,stroke-width:2px
```

三个设计选择把边界收窄并保证安全：

- **磁盘工件是唯一权威，不建数据库表、不做常驻服务。** 后端按需 spawn 本机 `agent` 可执行文件，只读取 Python 侧已原子写入的工件，因此命令行与浏览器始终看到同一份状态，任务也可以回放和审计。
- **子进程被严格锁定。** 命令以 argv 数组 + `shell:false` 启动（shell 注入无从发生），仅限 `new/run/approve/reject` 子命令，在固定工作目录执行并设超时；Python 侧另有 npm/git 命令白名单，并禁止 `commit/push/reset/clean`。
- **人工在环是强制的。** 补丁只写到 `patches/*.diff`，在审批门前不会应用；批准后才应用并运行验证，拒绝必须填写原因；系统全程不会自动 commit 或 push。

后端模块是一层防腐层：TypeScript 类型与 Python 模型逐字段对齐；输入用 id 白名单和路径前缀校验防止路径穿越；失败统一映射为标准 HTTP 状态（503 未启用 / 400 非法 / 404 缺失 / 409 状态冲突 / 500 子进程失败）。全栈 E2E 使用零依赖的确定性假 agent，工件写在临时目录，服务跑在隔离端口（Nest 3099 / Vite 8090，`strictPort`，绝不复用），在不调用大模型的前提下覆盖批准和拒绝两条端到端主流程。

## 目录结构

```
.
├── agent/                  # Python Agent 服务（模型无关，Typer/FastAPI）
│   ├── src/agent_core/     # 模型层、工具、webapp 客户端、coder/ 内环
│   ├── tests/              # pytest + pytest-httpx（不打真实网络）
│   ├── data/checkpoints/   # JSONL 检查点（运行时数据，git 中保留空目录）
│   └── pyproject.toml
├── client/                 # React 前端
│   └── src/
│       ├── pages/          # 各业务页面（按功能分目录），含 Dev/
│       ├── components/
│       │   ├── MultiAgent/ # 深度报告、运行卡片、评级徽章
│       │   ├── ui/         # 基础组件（shadcn 风格）
│       │   └── business-ui/# 业务选择器（人员 / 部门 / 会话）
│       ├── hooks/          # 行情轮询、主题、移动端判断
│       └── api/index.ts    # 后端接口的前端封装
├── e2e/                    # Playwright：启动冒烟 + fullstack/（假 agent）
│   └── fixtures/           # 供开发控制台使用的确定性 fake-agent.cjs
├── server/                 # NestJS 后端（编排中枢）
│   ├── database/schema.ts  # Drizzle 表结构（自动生成，勿手动修改）
│   ├── common/
│   │   ├── middleware/     # 本地 dev 身份注入（LOCAL_DEV_USER_ID 门控）
│   │   └── filters/        # 全局异常过滤器
│   └── modules/            # 业务模块（controller + service + module），
│                           # 含 dev-agent/（拉起本机 coder、读取工件）
├── shared/
│   └── api.interface.ts    # 前后端共享类型
├── db/
│   └── snapshot/           # 本地真实数据快照（*.sql 已 gitignore，仅本地）
├── drizzle/                # drizzle-kit 生成的建表 migration
├── playwright.config.ts          # 仅 Vite 冒烟（忽略 fullstack/）
├── playwright.fullstack.config.ts # 隔离全栈 E2E（Nest 3099 / Vite 8090）
└── scripts/
    ├── db/                 # 本地 PostgreSQL：建库/建表/角色 + start/stop/rebuild
    ├── dev-local-*.ps1     # Windows 本地一键启动（minimal / db / full / client）
    ├── dev-e2e-server.js   # 为全栈 E2E 编译并用假 agent 启动 Nest
    └── sync-from-miaoda.ps1# 妙搭 -> GitHub 同步
```

## 数据模型

数据库共 20 张表，分为三组：

| 分组 | 表 | 说明 |
|---|---|---|
| 日常业务 | `holdings`、`watchlist`、`transactions`、`closed`、`analysis`、`groups`、`journal`、`snapshots`、`alpha_picks`、`cash_accounts`、`fx_rates` | 持仓、关注、交易、每日分析、分组、日志、净值快照等 |
| 多智能体 | `agent_runs`、`agent_evidence`、`bull_bear_arguments`、`debate_records`、`agent_ratings`、`risk_gate_results`、`agent_audit_log`、`deep_report` | 分析运行的全过程数据及最终深度报告 |
| 配置 | `strategy_rules` | 风控规则，支持页面增删改与启停 |

表结构以 `server/database/schema.ts` 为准。该文件由平台工具根据数据库自动生成（`npm run gen:db-schema`），不应手动编辑。

## 本地开发

环境要求：Node.js >= 22、npm >= 10。提供三种运行模式，按需选择：

| 模式 | 启动方式 | 数据库 | 登录态 | 适用场景 |
| --- | --- | --- | --- | --- |
| 官方云端模式 | `npm run dev` | 妙搭托管 PostgreSQL | 需要 `lark-cli` + 账号登录 | 与线上完全一致的完整环境 |
| 最小离线模式 | `scripts/dev-local-minimal.ps1` | 不连库（跳过） | 无 | 只调公开行情端点（Agent 开发早期） |
| **全栈离线模式（推荐）** | `scripts/dev-local-full.ps1` | **本地 PostgreSQL + 真实数据快照** | 本地注入固定用户 | 完整页面、完整数据，做 Agent 开发与演示 |

### 全栈离线模式：本地 PostgreSQL + 真实数据（推荐）

该模式在本机完整复刻平台运行时，**无需登录、无需联网到妙搭**，就能看到自己的真实持仓，适合离线开发 Agent 与面试演示。它做了四件事：

1. **建表**：用 drizzle-kit 从 `server/database/schema.ts` 生成 DDL，建在独立的 `workspace_*` schema 下（`scripts/db/02_tables.sql`）。
2. **角色**：模拟平台 datapaas 每个请求 `SET LOCAL ROLE` 的三个数据库角色 `service_role_/authenticated_/anon_<schema>`（`scripts/db/03_roles.sql`）。
3. **数据**：把从妙搭导出的真实数据快照（`db/snapshot/*.sql`，**含个人数据，已 gitignore，不入库**）导入本地库。
4. **身份**：后端通过 `SUDA_DATABASE_URL` 连本地库；一个仅在 `LOCAL_DEV_USER_ID` 设置时生效的本地中间件（`server/common/middleware/local-dev-auth.middleware.ts`）注入网关用户头，于是 `@NeedLogin()` 守卫放行、SQL 上下文设置 `app.user_id`、`owner` 行级隔离与云端完全一致。

一次性准备：

```powershell
# 1) 安装 PostgreSQL（scoop 用户级安装，无需管理员）
scoop install postgresql

# 2) 把从妙搭导出的 7 个 *.sql 放入 db/snapshot/（详见 db/snapshot/README.md）

# 3) 一键建库 → 建表/角色 → 导入快照（幂等，可重复执行）
powershell -ExecutionPolicy Bypass -File scripts\db\rebuild-local.ps1
```

每次启动：

```powershell
# 启动本地 PostgreSQL（若未运行）+ 后端（连本地库）+ 前端
powershell -ExecutionPolicy Bypass -File scripts\dev-local-full.ps1
# 然后打开 http://127.0.0.1:8080
```

`LOCAL_DEV_USER_ID` 默认取快照里的属主用户 ID，只展示该账号的数据（例如同一快照里属于另一账号的持仓会被 `owner` 条件正确过滤掉）；要切换成其他账号，在启动前设置该环境变量即可。该中间件在不设置 `LOCAL_DEV_USER_ID` 时完全不生效，也不会覆盖真实网关头，因此对线上零影响。

### 测试

```bash
npm run test:unit          # Vitest：server/**/*.spec.ts 单测（不启动 Nest、不连库）
npm run test:unit:watch    # 监听模式
npm run test:unit:coverage # 覆盖率报告（V8）

npm run test:e2e:install   # 一次性：下载 Playwright Chromium
npm run test:e2e           # 仅 Vite 冒烟：前端 bundle 能挂载
npm run test:e2e:fullstack # 全栈：开发控制台的批准/拒绝闭环
npm run test:e2e:ui        # 交互式 Playwright 调试界面

cd agent && pytest -q      # Python Agent 测试（离线，不打真实网络）
```

单元测试覆盖业务逻辑和 dev-agent 模块（用 mock 的进程执行器与工件读取器），不启动 NestJS、不连数据库。仅 Vite 的端到端测试断言前端能正常挂载、不出现错误边界。全栈 E2E 会在隔离端口（Nest 3099 / Vite 8090，绝不复用）上用确定性假 agent 和临时工件目录启动一对隔离服务，让真实浏览器走完开发控制台的批准/拒绝流程，全程不调用大模型、不连数据库，也不影响正在运行的开发栈。Python Agent 测试使用脚本化模型和录制的 HTTP，完全离线。

### 官方云端模式

```bash
# 安装依赖
npm install

# 复制环境变量模板并按需填写
cp .env.example .env
#   未填写 DOUBAO_API_KEY 时应用可正常运行，仅多智能体的 LLM 推理不可用

# 同时启动后端（NestJS）与前端（Vite）；需要 lark-cli 拉取云端环境变量
npm run dev

# 也可分别启动
npm run dev:server   # http://localhost:3000
npm run dev:client   # http://localhost:8080
```

`npm run dev` 执行 `scripts/dev.js`，统一管理前后端进程：进程异常退出时自动重启，短时间内反复崩溃则采用指数退避；日志按进程分别写入 `logs/`；退出时按进程组清理并释放占用端口。

生产构建与启动：

```bash
npm run build
npm start
```

### Python 智能体（`agent/`）

智能体使用 Python 3.12 与 [uv](https://docs.astral.sh/uv/)。

```bash
cd agent
uv sync                       # 创建 .venv 并安装依赖
cp .env.example .env          # 填入 ARK_API_KEY / DEEPSEEK_API_KEY
uv run agent health           # 检查 webapp 客户端
uv run agent quote AAPL       # 经 webapp 拉取真实行情
uv run pytest -q              # 运行离线测试
```

智能体通过 HTTP 与 Webapp 通信（`agent/.env` 中的 `WEBAPP_BASE_URL`），不需要独立的数据库连接。

## 妙搭云端 <-> GitHub 同步

Webapp 主要在妙搭（aPaaS）云端用 AI 开发，云端是 NestJS/React 代码的权威源头，而妙搭不是 git 仓库。可用一键同步脚本保持 GitHub 同步——它通过 `lark-cli` 导出云端最后一次提交的快照，只覆盖属于云端的路径，然后提交并推送：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\sync-from-miaoda.ps1 -DryRun   # 仅预演
powershell -ExecutionPolicy Bypass -File scripts\sync-from-miaoda.ps1           # 同步 + 提交 + 推送
```

脚本会镜像 `client/`、`server/`、`shared/`、`.githooks/`、`.spark/` 及根配置文件，但绝不触碰 `agent/`、`docs/`、`README*`、`.gitignore`、`.env`、`*.sql`；覆盖前会先自动提交一个本地安全快照，因此本地改动不会丢失。云端沙箱里未提交的改动不会被导出，请先在妙搭里提交/发布。

## 配置说明

- **Finnhub Token**：不入库、不经过服务端。在页面界面中配置后存储于当前设备浏览器的 `localStorage`，更换设备需重新配置。
- **豆包 LLM**：在 `.env` 中设置 `DOUBAO_API_KEY`，模型与 base URL 均可通过环境变量覆盖，详见 `.env.example`。
- **平台依赖**：项目依赖 `@lark-apaas/*` 系列包完成托管、登录与数据库注入。若需完全脱离平台独立部署，需将登录、数据库连接与构建配置替换为自有实现，业务模块代码可原样保留。

## 免责声明

本项目仅用于个人记录与学习交流，不构成任何投资建议，据此操作产生的盈亏由使用者自行承担。

## 许可证

[MIT](LICENSE)
