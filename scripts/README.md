# 脚本入口

以下命令均从仓库根目录执行。日常本地开发使用 `npm run dev:local`；离线数据库环境使用下表中的 PowerShell 入口。

## 开发与构建

| 命令 | 用途与调用关系 |
| --- | --- |
| `npm run dev:local` | `dev-local-guard.cjs` 检查端口与重复启动，再调用 `dev-local.js` 拉取平台环境、同步 skills 并启动前后端。 |
| `npm run dev` | Bash 入口 `dev.sh`：沙箱调用 `dev.js` 管理进程与日志；本地先同步平台文件，再调用 `dev-local.js`。 |
| `npm run dev:server` / `npm run dev:client` | 分别启动 Nest watch / Vite；环境变量需由调用方准备。 |
| `npm run build` | Bash 入口 `build.sh`：生成路由、构建前后端、准备部署产物，再调用 `prune-smart.js` 裁剪依赖。 |
| `npm run build:server` / `npm run build:client` | 仅构建对应端，不执行完整部署打包。 |
| `bash run.sh`（在 `dist/` 内） | 构建脚本复制的生产入口，执行 `server/main.js`。 |

`dev.sh`、`dev.js`、`dev-local.js`、`build.sh`、`run.sh` 和 `prune-smart.js` 各有调用方，应保留。

## Windows 离线开发

使用 `powershell -ExecutionPolicy Bypass -File scripts/<文件>` 执行以下入口。

| 文件 | 用途 |
| --- | --- |
| `dev-local-full.ps1` | 启动本地 PostgreSQL，再分别打开完整后端与前端。 |
| `dev-local-db.ps1` | 连接本地数据库的后端；自动检测快照中的用户身份。 |
| `dev-local-client.ps1` | 独立 Vite 前端；需先启动后端。 |
| `dev-local-all.ps1` | 同时打开无数据库后端与前端，适合公开行情接口调试。 |
| `dev-local-minimal.ps1` | 仅启动无数据库后端；持仓等依赖数据库的功能不可用。 |
| `db/start-db.ps1` / `db/stop-db.ps1` | 启停本地 PostgreSQL。 |
| `db/rebuild-local.ps1` | **重建本地业务 schema**，执行 `db/01_init.sql`、`db/02_tables.sql`、`db/03_roles.sql`，再导入 `db/snapshot/*.sql` 中的本地快照。运行前确认快照能恢复所需数据。 |

快照说明见 [db/snapshot/README.md](../db/snapshot/README.md)。`db/snapshot/archive/` 与 `backups/` 下的历史文件不参与自动导入。

## 检查、测试与同步

| 命令 | 用途 |
| --- | --- |
| `npm run lint` | `lint.js` 顺序运行 ESLint、类型检查与样式检查。 |
| `node scripts/lint.js --files <路径...>` | 选择文件检查；相关端的类型检查仍会完整执行。 |
| `npm run precommit` | `hooks/run-precommit.js` 调用完整 lint。 |
| `npm run test:e2e:fullstack` | Playwright 配置通过 `dev-e2e-server.js` 启动隔离测试后端。 |
| `powershell -ExecutionPolicy Bypass -File scripts/sync-from-miaoda.ps1 -DryRun` | 预览妙搭同步；去掉 `-DryRun` 会覆盖云端权威文件、提交并推送，`-NoPush` 仅跳过推送。 |

## Coding Agent 运行环境

| 入口 | 用途 |
| --- | --- |
| `powershell -ExecutionPolicy Bypass -File scripts/coder-runtime/prepare.ps1` | 通过 WSL Docker 构建 `coding-agent-runtime:local`；默认发行版为 Ubuntu，可传 `-Distro` / `-Image`。 |
| `coder-runtime/supervisor.py` / `egress_proxy.py` | 容器进程管理与网络代理，由运行时装配。 |
| `coder-browser/worker.mjs` / `network-policy.mjs` | Python 容器运行时调用的浏览器工作进程及网络策略。 |
| `agent/.venv/Scripts/python.exe scripts/evaluate-coding-agent.py ui` | 显式运行真实模型评估；另一个案例参数是 `feature`。需要 Agent 环境配置和容器运行环境，会调用模型服务。 |

上述运行时目录和评估脚本属于开发中的 Agent 功能；它们不是临时调试产物。
