# 妙搭部署与 GitHub 同步

核验日期：2026-10-26。

当前结论：业务 React/NestJS 应用具备妙搭的构建结构；完整 Coding Agent 目前是本地执行架构，不能直接随现有 Web 产物发布后使用。GitHub 保存源码，妙搭发布部署产物，两者是独立流程。

## 当前部署边界

| 部分 | 当前实现 | 发布前的条件 |
| --- | --- | --- |
| 持仓、看板等业务 Web | React + NestJS + 平台 Drizzle 服务 | 验证目标应用、平台环境、正式数据库及实际页面 |
| `/dev` 工作台 | 前端页面和 Nest HTTP 路由可构建 | 现有接口调用同机执行器，尚无远程 Worker 适配器 |
| Python Agent | Nest `ChildProcessRunner` 启动本地可执行文件 | 需要 Python、依赖、源码仓库和长期运行的进程宿主 |
| 终端与浏览器 | Docker 容器、网络、卷、Playwright 浏览器 | 需要受控 Docker engine 和已准备的运行镜像 |
| 任务状态与回滚 | 本地文件、源码副本、checkpoint、landing journal | 需要可写且持久的存储；临时目录不能代替持久状态 |
| 模型/MCP 设置 | 本机操作员文件，HTTP 接口校验 loopback | 公网配置需重新设计身份、秘密存储与访问边界 |

关键源码：

- [`loadDevAgentConfig()`](../server/modules/dev-agent/dev-agent.config.ts)：默认关闭，工作目录、Python 路径和任务目录默认都在本地项目中。开关只检查 `AGENT_DEV_ENABLED`，不会因为 `NODE_ENV=production` 自动强制关闭。
- [`ChildProcessRunner`](../server/modules/dev-agent/agent-process.runner.ts)：直接启动本地进程，没有远程任务协议。
- [`DevAgentService`](../server/modules/dev-agent/dev-agent.service.ts)：用进程内状态管理任务执行、取消和审批。
- [`assertLocalSettingsRequest()`](../server/modules/dev-agent/dev-settings.controller.ts)：检查实际 socket、Host、Origin；线上域名不能直接使用本机设置入口。
- [`ContainerRuntime`](src/agent_core/coder/runtime/container.py)：创建和管理任务所属的 Docker 资源。
- [`TaskStore`](src/agent_core/coder/task_store.py) 与 [`general_landing.py`](src/agent_core/coder/general_landing.py)：持久化任务并把批准的源码补丁落地。
- [`build.sh`](../scripts/build.sh) 与 [`nest-cli.json`](../nest-cli.json)：构建 Web/Node 产物，没有部署 Python、Docker 镜像或可编辑 Git 工作区；构建还清理 `dist/scripts`。

本项目的平台规范将生产 FaaS 部署目录视为只读目录。当前没有核验目标租户是否提供额外的持久卷、后台进程或 Docker 权限，因此这里的结论是“当前实现不能直接部署运行”，不是声称平台在所有部署形态下都不支持 Python/Docker。

## 仅发布现有业务 Web

保留 `AGENT_DEV_ENABLED=false`，不把本地开发环境文件当作云端配置。`scripts/build.sh` 会在根 `.env` 存在时复制它到发布产物；应在干净构建环境使用目标应用所需的配置，并检查最终产物，不能把本地模型密钥和默认开发令牌带入发布包。

本地可执行的源码验证：

```powershell
npm run lint
npm run test:unit
npm run build:prod
Set-Location agent
uv run python -m pytest -q
```

`build:prod` 验证 Node 与前端编译，不代表妙搭平台完整打包、数据库连接或线上发布已经通过。平台正式构建仍走 [`scripts/build.sh`](../scripts/build.sh)。本地持仓不会随源码推送迁移到云端数据库。

官方本地开发流程将妙搭应用源码推送到该应用的远端分支后，通过 `lark-cli apps +release-create` 创建 release，再查询 release 状态确认完成。需要先确定目标 `app_id`、妙搭远端及当前 CLI 帮助参数；不要把 GitHub `origin` 当作妙搭应用远端。

- [官方本地开发与发布流程](https://github.com/larksuite/cli/blob/main/skills/lark-apps/references/lark-apps-local-dev.md)
- [官方 release-create 契约](https://github.com/larksuite/cli/blob/main/skills/lark-apps/references/lark-apps-release-create.md)

用户指定的发布目标是 `app_17en1wnqecc`，访问地址为 [股票投资管理终端](https://4m3ksb6knp0wc.doubaoapps.com/app/app_17en1wnqecc/signals)。这是运行页面地址，不代表本机已经具备编辑或发布权限。本地 `.spark/meta.json` 尚未绑定应用，Git remote 只有 GitHub。

2026-10-26 的实际发布入口核验结果：

- 本机豆包定制版 `lark-cli`（`v1.0.102+f7f71da`）对该应用执行 `apps +get --app-id app_17en1wnqecc --as user` 和 `apps +release-list` 均返回 `not_configured`。该构建没有 `auth`、`config`、`+git-credential-init` 或 `+release-create`，不能直接套用上面完整版 CLI 的命令。
- 缓存的 `@lark-apaas/miaoda-cli`（`0.1.48`）声明只供妙搭沙箱使用。仅传入用户提供的应用 ID 后，`app get --json` 仍报告缺少平台域名环境，说明本机没有完整的沙箱会话；不能猜测内部域名补齐配置。
- [`sync-from-miaoda.ps1`](../scripts/sync-from-miaoda.ps1) 的方向是云端导出后覆盖本地并同步 GitHub，不是把本地源码发布到妙搭。不能用它代替发布步骤。

下一步需要拥有该应用编辑权限的妙搭管理会话，或已经完成用户认证且具备源码发布能力的官方 CLI。取得入口后，先读取云端当前源码与版本、比较本地改动，再创建发布候选并验证。当前没有上传本地环境文件、覆盖云端源码或创建线上 release。

## 完整 Agent 的云端部署方案（待实现）

```text
妙搭 Web：工作台、登录、HTTP API
  → 认证的任务请求与短轮询
独立执行服务：Python Agent、Git 工作区、Docker/Playwright
  → 持久卷：任务记录、源码检查点、截图、审批与回滚日志
  → 审阅补丁、提交 Git/PR、再走妙搭发布流程
```

需要补齐的工程工作：

1. 远程任务 API 和 Nest runner 适配器，包含幂等创建、查询、取消、审批与结果读取。
2. 当前用户与任务/项目的所有权校验，以及租户之间的状态、工具凭证和运行资源隔离。
3. 持久任务调度、进程所有权和重启恢复，不能只依赖某个 HTTP 实例的内存 Map。
4. 云端秘密存储、网络访问策略和执行服务认证；不能简单移除现有 loopback 检查。
5. 保留容器沙箱、当前 revision 验收、逐次外部写审批和单笔源码修改回滚，并验证整个远程链路。

执行服务必须运行在有相应权限的宿主上；当前没有为它选择或创建服务器。源码回滚也不等于可以自动回滚外部 MCP 系统或已发布的云端数据库修改。

## 同步到 GitHub 的内容

同步应用、Agent、测试、脚本与公共说明。`.env*`、操作员密钥、数据库快照、`agent/data/coder/`、截图/日志和本地 `docs/` 学习材料继续按 `.gitignore` 排除。不要用强制添加把这些本地材料混入公开仓库。

功能分支推送只更新该分支；Pull Request 合并和妙搭发布需要分别核验，不能把“推送成功”写成“生产已更新”。
