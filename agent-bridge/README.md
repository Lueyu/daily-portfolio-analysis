# Local Codex Agent / 本地 Codex Agent

This bridge exposes an installed, authenticated **Codex CLI** as an **A2A 1.0 JSON-RPC** research agent using the official `@a2a-js/sdk`. Squabble sends a research brief; Codex uses its own search and read-only tools, and returns a report artifact. Squabble owns the discussion and routing. This is a local **agent runtime**, usually backed by a cloud model; it does not install model weights or provide free inference.

这个桥接服务把已安装并登录的 **Codex CLI** 接成标准 **A2A 1.0** Agent。Squabble 下发研究任务，Codex 自己检索和研究，最后提交报告。模型调用与收费沿用本机 Codex 账号；「本地运行」不等于「模型离线运行」。

## Windows quickstart

Run from the Squabble repository on the **Windows host**, in PowerShell. Node.js 22+ and a recent native Codex CLI are required. The current integration uses CLI flags shown by `codex exec --help`, including `--ignore-user-config`, `--ignore-rules`, `--ephemeral` and `--output-last-message`.

```powershell
npm ci
codex login
$env:SQUABBLE_CODEX_BINARY = (Get-Command codex.exe).Source
$env:SQUABBLE_A2A_TOKEN = node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
$env:SQUABBLE_A2A_DATA_DIR = Join-Path $env:LOCALAPPDATA 'SquabbleAgent'
npx tsx agent-bridge/main.ts
```

Keep that terminal running. Save the generated token in a password manager and use the same value in your server's agent registry. On later starts set `SQUABBLE_A2A_TOKEN` to that saved value. Never commit it. If `codex.exe` is not on PATH, set `SQUABBLE_CODEX_BINARY` to the native executable's full path; `.cmd` and PowerShell wrappers are not supported because the bridge never uses a command shell.

默认地址是 `http://127.0.0.1:4310`。请在运行桥接的终端保存 Token；服务端注册 Agent 时需要填写同一个 Token。完整接入步骤见 [本地 Agent 配置](../docs/local-agents.md)。

## Squabble running in Docker Desktop

Docker's `localhost` is the container. Run the bridge on the host with an address the container can reach:

```powershell
$env:SQUABBLE_A2A_HOST = '0.0.0.0'
$env:SQUABBLE_A2A_PUBLIC_URL = 'http://host.docker.internal:4310'
# Set SQUABBLE_A2A_TOKEN and SQUABBLE_CODEX_BINARY as above.
npx tsx agent-bridge/main.ts
```

Configure `cardUrl` as `http://host.docker.internal:4310/.well-known/agent-card.json` in `A2A_AGENTS_FILE`, with the same token and the exact authorized Squabble user ID in `owners`. Bind/firewall the host port for the intended local network only. A cloud-hosted Squabble server cannot reach your personal computer via `localhost` or `host.docker.internal`; it needs an explicitly configured private network or authenticated tunnel.

Example registry entry (the file belongs to the Squabble server, not the bridge):

```json
[
  {
    "id": "codex-local",
    "name": "Local Codex",
    "cardUrl": "http://host.docker.internal:4310/.well-known/agent-card.json",
    "token": "REPLACE_WITH_THE_SAVED_BRIDGE_TOKEN",
    "owners": ["REPLACE_WITH_YOUR_EXACT_SQUABBLE_USER_ID"]
  }
]
```

## Linux / macOS

```bash
npm ci
codex login
export SQUABBLE_A2A_TOKEN="$(node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))')"
export SQUABBLE_CODEX_BINARY="$(command -v codex)"
npx tsx agent-bridge/main.ts
```

Use a native executable on PATH. Save and reuse the generated token as described above. On Linux Docker, configure a host-gateway mapping for `host.docker.internal` when needed.

## Configuration

| Environment variable | Default | Meaning |
|---|---|---|
| `SQUABBLE_A2A_TOKEN` | Required | At least 32 characters; required for discovery and every A2A request |
| `SQUABBLE_CODEX_BINARY` | `codex.exe` on Windows; `codex` elsewhere | Trusted native executable, configured by the local operator |
| `SQUABBLE_A2A_HOST` | `127.0.0.1` | Listening interface |
| `SQUABBLE_A2A_PORT` | `4310` | Listening port |
| `SQUABBLE_A2A_PUBLIC_URL` | `http://127.0.0.1:4310` | HTTP origin reachable from the Squabble server; used in the Agent Card |
| `SQUABBLE_A2A_DATA_DIR` | `~/.squabble-agent-bridge` | Private persistent task storage and temporary per-task workspaces |
| `SQUABBLE_A2A_TIMEOUT_MS` | `600000` | Task runtime limit; 1 second to 1 hour |
| `SQUABBLE_A2A_CONCURRENCY` | `1` | Concurrent CLI processes; 1–4 |

One bridge/token is a single trusted owner's execution boundary. For separate users, run separate bridges with separate accounts, tokens, data directories and ports. Do not share a personal runtime between strangers. The CLI sandbox is read-only, but its account can still read local files: use a dedicated OS account/container if stronger filesystem isolation is required.

The child receives a small environment allowlist and local Codex authentication. It does not receive the bridge token or Squabble financial/model keys. It runs with native live web search, no approvals, a read-only sandbox, ephemeral sessions, and no inherited user config or execpolicy rules. This avoids silently loading arbitrary user MCP integrations/hooks. If a required flag is unsupported, execution fails; the bridge does not downgrade sandbox settings.

## Task behavior and report format

- Agent Card: authenticated `GET /.well-known/agent-card.json`.
- JSON-RPC endpoint: authenticated `POST /a2a`, `A2A-Version: 1.0`.
- Official SDK methods include `SendMessage`, `GetTask`, `CancelTask` and streaming. Squabble can poll a task submitted with `configuration.returnImmediately: true`.
- A task publishes submitted/working status, a final artifact, then completed. Tool activity is shown only as short public progress labels. Raw tool responses and private model reasoning are never relayed to the room.
- Final JSON contains `content`, `reasoningSummary`, `questions`, `evidenceIds`, `sources`, `researchStance`, `decision`, `dissent`, and `nextReviewCondition`. If the CLI returns Markdown instead, it is returned as a text artifact for the caller to consume.
- Native CLI reported token usage is copied to `task.metadata.usage.totalTokens` and artifact metadata. If the CLI does not report it, usage is unknown, not zero. A2A has no universal hard token cap; configure runtime/provider spending controls. Time and concurrency limits always apply.
- Cancel stops the native process tree. User steering can cancel the current task and send a fresh task with the revised brief. This bridge does not promise native mid-turn steering or an interactive permission dialog.
- Tasks and reports are atomically stored on disk. Startup marks unfinished tasks failed/interrupted and preserves completed reports. It never re-executes a task automatically after restart. An abrupt machine/process failure can leave native work uncertain; inspect the local Codex process before retrying.
- The task store contains research prompts and outputs. Keep its directory private; remove old task files while the bridge is stopped according to your retention needs.

This package uses the official A2A SDK rather than Clowder's source or brand assets. The design borrows its separation of team orchestration from native agent execution. References: [A2A SDK](https://github.com/a2aproject/a2a-js), [A2A 1.0 specification](https://a2a-protocol.org/v1.0.1/specification/), [Clowder message lifecycle](https://github.com/zts212653/clowder-ai/blob/main/docs/architecture/a2a-protocol.md).

## Offline verification

```powershell
npx tsc -p agent-bridge/tsconfig.json
npx tsx --test agent-bridge/bridge.spec.ts
```

The tests use a fake executor and the real SDK HTTP transport. They verify authentication, task dispatch, busy rejection, artifacts, reported usage, cancellation, persistence and interrupted-task recovery. They do not make paid model calls.
