# 本地 Agent 投研团队 · Local agent research teams

Squabble 可以通过 **A2A 1.0 的 JSON-RPC 接口**把研究交给独立 Agent。应用负责分派成员任务、传递讨论上下文、接收进度和报告；Agent 使用自己的搜索和研究能力完成任务。现有「模型 API · 内置研究」也可以继续使用，团队成员可分别选择执行方式。

本指南以受支持的**本地 Docker Compose 安装**为例。桌面安装包不捆绑 Codex CLI 或本桥接服务；如要接入它们，需单独安装 Node.js、Codex CLI 并配置受信的本机连接。以下 Compose 命令不能用于桌面安装包。

本地 Agent 指的是执行程序在你的电脑上运行。Codex 通常仍通过供应商云端推理，使用现有 Codex 登录凭证；它不是自动离线的大模型，也不使用网页中保存的 DeepSeek Key。仓库提供的桥接服务使用只读沙箱、独立任务目录和原生搜索，不继承用户自定义 MCP 与规则配置。完整运行参数见 [Bridge README](../agent-bridge/README.md)。

## 1. 准备本地 Agent

安装项目依赖，并确认本机 Codex CLI 已登录。在项目根目录打开 PowerShell：

```powershell
npm ci
codex login status
```

在网页登录你要使用的账号，打开「**设置 → 本地投研 Agent**」，复制页面显示的**账号 ID**。这里需要完整账号 ID，不是用户名。运营者通过这个 ID 决定谁可以使用本地 Agent。

## 2. 创建连接配置并启动桥接服务

下面以 **Docker Desktop 运行干净的本地 Compose 应用，Windows 本机运行 Codex** 为例。在项目根目录的 PowerShell 执行，把占位值替换为刚才复制的账号 ID：

```powershell
$agentOwnerId = '替换为网页显示的完整账号ID'
$agentConfigDir = Join-Path (Get-Location) 'output/local-agents'
[System.IO.Directory]::CreateDirectory($agentConfigDir) | Out-Null
$agentRegistryPath = Join-Path $agentConfigDir 'agents.json'

$env:SQUABBLE_A2A_TOKEN = node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
$env:SQUABBLE_CODEX_BINARY = (Get-Command codex.exe).Source
$env:SQUABBLE_A2A_HOST = '0.0.0.0'
$env:SQUABBLE_A2A_PUBLIC_URL = 'http://host.docker.internal:4310'

$agentRegistry = @([ordered]@{
  id = 'local-codex'
  name = 'Local Codex'
  cardUrl = 'http://host.docker.internal:4310/.well-known/agent-card.json'
  token = $env:SQUABBLE_A2A_TOKEN
  owners = @($agentOwnerId)
})
[System.IO.File]::WriteAllText(
  $agentRegistryPath,
  (ConvertTo-Json -InputObject $agentRegistry -Depth 5),
  [System.Text.UTF8Encoding]::new($false)
)
npx tsx agent-bridge/main.ts
```

保持这个终端运行。成功时会显示监听地址和 Agent Card 地址，不会启动研究任务。`SQUABBLE_CODEX_BINARY` 必须指向原生可执行程序；如果系统只找到 `.cmd` 或 `.ps1` 启动器，请按 [Bridge README](../agent-bridge/README.md) 定位实际 Codex 二进制。

`output/` 已被 Git 忽略。`agents.json` 包含连接密钥，应只由运营者保管。该密钥用于网页服务端与桥接器之间的认证，不是模型供应商 Key。桥接服务不应暴露到公网；Docker 场景监听 `0.0.0.0` 时，在系统防火墙中只允许所需的本机或 Docker 网络访问。

**Web 应用也直接运行在本机时**，上面的 `SQUABBLE_A2A_HOST` 改为 `127.0.0.1`，`SQUABBLE_A2A_PUBLIC_URL` 和 `cardUrl` 都使用 `http://127.0.0.1:4310`。Agent Card 所声明的执行地址必须与配置里的 `cardUrl` 同源。

## 3. 让 Squabble 服务端读取连接表

连接表由运营者在服务端配置，用户网页不能提交任意内网地址或启动命令。文件的格式是 JSON 数组：

```json
[
  {
    "id": "local-codex",
    "name": "Local Codex",
    "cardUrl": "http://host.docker.internal:4310/.well-known/agent-card.json",
    "token": "与桥接器使用的认证密钥一致",
    "owners": ["允许使用该Agent的完整账号ID"]
  }
]
```

每个 Agent 必须列出允许使用的账号。多个成员可以复用同一个 Agent；如果你启动了多个 Agent 服务，也可以添加多条记录供成员分别选择。Squabble 只向当前账号展示其被授权的记录，不会把认证密钥发送到浏览器。

对于 Docker，在项目根目录新增 `output/local-agents/compose.a2a.yml`：

```yaml
services:
  app:
    environment:
      A2A_AGENTS_FILE: /run/squabble-agents/agents.json
    volumes:
      - ./output/local-agents/agents.json:/run/squabble-agents/agents.json:ro
```

在第二个 PowerShell 终端执行：

```powershell
docker compose -f docker-compose.yml -f output/local-agents/compose.a2a.yml up -d --build app
```

后续更新服务时也要带上这两个 `-f` 参数。只把 `A2A_AGENTS_FILE` 写进 `.env` 并不会自动传给容器，需要上面的环境变量和文件挂载。

对于直接运行的开发服务，在启动服务的终端设置：

```powershell
$env:A2A_AGENTS_FILE = Join-Path (Get-Location) 'output/local-agents/agents.json'
npm run dev
```

Docker 的 `127.0.0.1` 指向容器自己，所以访问宿主机需要 `host.docker.internal`。这是 Docker Desktop 的宿主机入口；Linux Docker 需要另外配置宿主机映射或可达的受信网络地址。

## 4. 在网页开始讨论

1. 打开「设置 → 本地投研 Agent」，点击「刷新 Agent」，确认出现 `Local Codex`。
2. 点击「测试连接」。它只读取 Agent Card，不会启动付费研究。
3. 打开同页「研究预算」，关闭开关。标准 A2A 无法强制控制外部 Agent 内部的 Token 消耗，因此当前实现要求先关闭网页的研究预算才能委派任务。Agent 的供应商限额和收费仍然生效。
4. 新建投研讨论。可用的本地 Agent 会成为新独立团队的默认执行者。编辑成员可分别选择执行方式、Agent、角色、性格和提示词。
5. 开始聊天。任务进度与发言出现在对话中，完成的报告保存在侧栏。已有团队不会被自动迁移；可用「让本地 Agent 执行这支团队的任务」保留角色设定并切换执行者。

外部 Agent 返回 Token 用量时会记录该信息；未返回时显示用量未知，不代表零消耗。暂停会请求远端停止，但已经发送的供应商请求仍可能产生费用。遇到执行中断或投递结果不确定时，先查看现有任务状态，避免通过反复新建讨论重复执行研究。

## 重启与其他 Agent

重启桥接器时要使用同一认证密钥。重新打开 PowerShell 后，可以从本机保存的配置恢复它：

```powershell
$agentRegistryPath = Join-Path (Get-Location) 'output/local-agents/agents.json'
$savedAgentRegistry = Get-Content -Raw -LiteralPath $agentRegistryPath | ConvertFrom-Json
$env:SQUABBLE_A2A_TOKEN = $savedAgentRegistry[0].token
$env:SQUABBLE_CODEX_BINARY = (Get-Command codex.exe).Source
$env:SQUABBLE_A2A_HOST = '0.0.0.0'
$env:SQUABBLE_A2A_PUBLIC_URL = 'http://host.docker.internal:4310'
npx tsx agent-bridge/main.ts
```

上面的地址适用于 Docker Desktop；直接运行的本机服务仍应改为 `127.0.0.1`。

如果你已有其他 A2A Agent，只需在连接表中注册它的 Agent Card 地址、认证密钥和账号授权。当前客户端要求 **A2A 1.0 + JSON-RPC**，不会把 0.3 格式当作 1.0。原始 Ollama/LM Studio 的模型接口不是 A2A Agent；需要由支持任务执行和工具的 Agent 运行时提供 A2A 服务。

## 其他网络中的连接边界

另一台电脑上的 `localhost` 指向它自己，无法直接访问你的个人电脑。`host.docker.internal` 也只指向运行 Docker 的那台宿主机。当前版本没有实现跨设备的自动配对或反向隧道。公网服务器部署不是受支持的安装方式。

如果你自行在其他受信网络中运行 Agent，先建立受认证的私有连接，再把应用可达的 Agent Card 地址写入连接表。不要把自己的付费 Agent 授权给陌生账号；`owners` 应列出实际允许使用的账号。

## English quick reference

Squabble uses **A2A 1.0 JSON-RPC** to assign work to independent agents and collect task progress and report artifacts. Local runtime does not imply offline model inference. The bundled bridge runs Codex in a read-only sandbox with native search; it uses your existing Codex login and does not inherit custom MCP/rule configuration.

1. Install dependencies with `npm ci`. Verify that the native Codex CLI is installed and logged in.
2. Set `SQUABBLE_A2A_TOKEN` to a private random value of at least 32 characters and `SQUABBLE_CODEX_BINARY` to the native executable. Start `npx tsx agent-bridge/main.ts`. See [bridge configuration](../agent-bridge/README.md).
3. Create an operator-owned JSON registry using the schema above. `owners` contains exact account IDs, available in **Settings → Local research agents**. Configure `A2A_AGENTS_FILE` in the Squabble server; Docker also needs a read-only registry mount.
4. Use `127.0.0.1` for a backend running directly on the same host. For Docker Desktop, use `host.docker.internal` and set the bridge's advertised URL to the same origin as its card URL. Another computer cannot reach your laptop through either address; it needs a separate authenticated network connection. Public server deployment is not a supported Squabble installation path.
5. Test the connection in Settings, turn off the Squabble research budget, and choose a local agent for each team member. Autonomous agents manage their own internal token usage, which standard A2A does not let Squabble enforce. Missing usage is shown as unknown.

The integration is inspired by Clowder's separation of agent orchestration and CLI execution. Clowder's internal A2A delivery design is distinct from the standard protocol used here: [Clowder architecture](https://github.com/zts212653/clowder-ai/blob/main/docs/architecture/a2a-protocol.md), [A2A specification](https://a2a-protocol.org/v1.0.1/specification/), [official TypeScript SDK](https://github.com/a2aproject/a2a-js).
