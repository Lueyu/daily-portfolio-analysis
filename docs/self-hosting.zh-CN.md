# 在本机安装吵股

[English](self-hosting.md) · [返回首页](../README.zh-CN.md) · [隐私说明](privacy.zh-CN.md)

吵股支持两种本地安装方式：独立的 Windows／macOS 桌面应用和干净的 Docker Compose 应用。项目不运营托管账号或同步服务。两种方式的基础分析都不要求模型 Key，但公共行情和汇率仍需联网。录入真实持仓或供应商密钥前，请阅读[隐私与出网说明](privacy.zh-CN.md)。

| 方式 | 需要准备 | 数据位置 |
|---|---|---|
| 桌面应用 | Windows x64 或 macOS Intel／Apple 芯片安装包 | 本机吵股应用数据目录 |
| Docker Compose | Git 和带 Compose 的 Docker | 本地 PostgreSQL 与密钥 Docker 卷 |

## 桌面应用

当版本发布桌面安装包后，从 [Squabble Releases](https://github.com/Lueyu/squabble/releases) 下载与你系统匹配的文件：Windows x64 `.exe` 安装包，或适用于 macOS Intel（x64）／Apple 芯片（arm64）的 `.dmg`。安装并打开吵股。桌面应用会启动自己的本地后端和数据库，不要求 Docker、Node.js 或 Python。如果没有配置签名证书，macOS 构建未经签名，系统可能警告或阻止打开；决定打开前请核对安装包来源。应用不提供自动更新服务，你可以自行安装较新的发布版本。

Windows 上请正常启动吵股，不要选择“以管理员身份运行”；内置 PostgreSQL 会拒绝在提升权限的管理员进程下启动。

桌面应用的“帮助 → 检查更新”会在你点击时查询 GitHub 最新正式版。若有新版本，界面显示版本和更新说明，并提供适合当前系统的安装包下载链接；下载后请退出吵股，再手动安装。此功能不会在后台下载或自动安装，也不会改变本地数据目录。

首次打开后创建账号，并将一次性恢复码离线保存。桌面应用没有演示账号和预置持仓。可以手动添加持仓或[导入 CSV](import.md)。账号恢复需要保存的恢复码；没有邮件重置服务。

桌面版的自动扫描、通知和本地接口集成只在应用打开时运行；退出应用后本地后端和数据库会停止。Docker 实例可在浏览器关闭后继续运行。

数据库、密钥和 WebView 数据保存在操作系统的吵股应用数据目录：

| 系统 | 通常位置 |
|---|---|
| Windows | `%APPDATA%\Squabble` |
| macOS | `~/Library/Application Support/Squabble` |

备份时，先**彻底退出吵股**，再将整个目录复制到这台电脑之外的受保护位置。备份包含投资组合资料、保存的会话与凭证，或可用于解密凭证的密钥，应妥善保管。恢复时也应先退出应用，替换目录前保留当前目录的副本，并在恢复后检查数据。桌面安装与 Docker 安装、其他电脑之间不会自动同步数据。

如果应用无法打开，先确认安装包与你的系统匹配、Windows 上没有以管理员身份运行，并检查可用磁盘空间。重新安装后若已有应用数据目录，应用会继续使用该数据；更换应用或排查启动问题前先备份。

## Docker Compose

安装 [Git](https://git-scm.com/downloads/) 和[带 Compose 的 Docker](https://docs.docker.com/get-started/get-docker/)。Windows／macOS 用户先打开 Docker Desktop，等待引擎启动；Linux 用户安装 Docker Engine 和 Compose 插件。先检查：

```sh
git --version
docker compose version
docker info
```

然后在 PowerShell 或终端运行：

```sh
git clone https://github.com/Lueyu/squabble.git
cd squabble
docker compose up -d --build
docker compose ps
```

首次构建会下载并编译依赖，可能需要几分钟。打开 [http://localhost:3000](http://localhost:3000)。干净安装使用空白数据库，没有演示账号，并自动生成稳定的 JWT 和设置加密密钥。创建账号、离线保存一次性恢复码，然后添加持仓或导入 CSV。首个账号创建后，注册入口会自动关闭。应用只绑定本机的 `127.0.0.1:3000`，PostgreSQL 不对主机发布端口。[健康检查](http://localhost:3000/api/health)应返回 `{"status":"ok"}`；页面尚未就绪时运行 `docker compose logs --tail=100 app db`。

根目录 Compose 的默认项目名为 `squabble-local`。终端或 `.env` 中已有的 `COMPOSE_PROJECT_NAME`，以及 `-p` 参数，都会覆盖该名称。旧演示升级前请运行 `docker compose config`，确认输出是 `name: squabble-local`；否则先清除覆盖值，或在**每条**干净实例命令中显式使用 `-p squabble-local`。不要把干净实例命名为旧演示项目 `squabble`，以免碰到旧数据卷。后续维护请保持相同的项目名与仓库路径，以便 Docker 找到已有卷。不要用 `docker compose down -v` 排查或升级；它会删除数据和自动生成的密钥。

| 数据 | 默认 Docker 卷或容器路径 |
|---|---|
| 账号、持仓、报告及加密后的供应商凭证 | `squabble-local_dpa-data`（`db` 容器内 `/var/lib/postgresql/data`） |
| 自动生成的 JWT 与设置密钥 | `squabble-local_settings-secrets`（`app` 容器内 `/app/.secrets`） |

### 可选的虚构演示

如果想先浏览示例组合和历史报告，单独启动演示应用：

```sh
docker compose -f docker-compose.demo.yml up -d --build
```

打开 [http://localhost:3001](http://localhost:3001)，使用 `demo` / `demo1234` 登录。演示采用独立的 `squabble` Compose 项目与卷，不会向干净安装导入示例数据。演示仅用于虚构资料体验，不要用公开密码保存真实持仓。停止演示时执行 `docker compose -f docker-compose.demo.yml stop`；后续演示命令都需带相同的 `-f` 参数。若 3001 端口被占用，可在未跟踪的 `.env` 文件设置 `HOST_DEMO_PORT`，并使用对应的 localhost 地址。

若设置了 `COMPOSE_PROJECT_NAME`，请清除它，或在每条演示命令中加入 `-p squabble`，确保演示与 `squabble-local` 干净实例使用不同项目名。

**从旧版默认演示升级：**旧版根目录 Compose 没有固定项目名。仓库目录名为 `squabble` 时通常使用 `squabble` 项目和 3000 端口；其他目录名或 Compose 覆盖值可能产生不同项目名。先备份，再用 `docker compose ls` 确认旧项目名。拉取新版文件前，在旧目录、沿用原有项目设置执行 `docker compose down`，不要加 `-v`。拉取后，常见的 `squabble` 项目可用 `docker compose -f docker-compose.demo.yml down` 管理；若旧项目名不同，在演示命令中加 `-p 旧项目名` 才能沿用原数据卷。新的干净 `squabble-local` 应用从空数据库开始，不会自动导入旧记录。如果你在旧演示中录入了真实资料，请保留备份，单独规划迁移。

### 停止、升级和备份

以下命令在仓库目录执行：

| 操作 | 命令 |
|---|---|
| 停止并保留数据 | `docker compose stop` |
| 再次启动 | `docker compose up -d` |
| 查看容器状态 | `docker compose ps` |
| 查看近期日志 | `docker compose logs --tail=100 app db` |

升级前先备份。单独的数据库转储不足以解密已保存的供应商 Key，还要复制自动生成的密钥文件。以下命令适用于 PowerShell 和 macOS／Linux 终端：

```sh
mkdir backups
docker compose exec -T db pg_dump -U postgres -d portfolio -Fc -f /tmp/squabble-backup.dump
docker compose cp db:/tmp/squabble-backup.dump ./backups/squabble-backup.dump
docker compose cp app:/app/.secrets/settings.key ./backups/settings.key
docker compose cp app:/app/.secrets/jwt.key ./backups/jwt.key
git rev-parse HEAD
```

以后备份时，将转储目标文件名改为新的日期文件名，避免覆盖旧备份。保留输出的 Git 修订号，并把备份和密钥复制到这台电脑之外的受保护位置。如果你在未跟踪的 `.env` 中显式设置 `JWT_SECRET` 或 `SETTINGS_ENCRYPTION_KEY`，应改为安全备份对应的值；相应密钥文件可能不存在。`backups/` 已被 Git 忽略。

可以在同一容器内创建独立的测试数据库，检查转储而不覆盖正在使用的 `portfolio`。若使用了带日期的文件名，请相应修改第一个命令：

```sh
docker compose cp ./backups/squabble-backup.dump db:/tmp/squabble-restore.dump
docker compose exec -T db createdb -U postgres portfolio_restore_check
docker compose exec -T db pg_restore -U postgres --exit-on-error --no-owner -d portfolio_restore_check /tmp/squabble-restore.dump
docker compose exec -T db psql -U postgres -d portfolio_restore_check -c "SELECT count(*) FROM users; SELECT count(*) FROM holdings;"
```

如果检查库已存在，请在全部命令中换一个新名称。演练会占用额外磁盘，只验证数据库转储，不能验证匹配密钥或应用切换。真正恢复时应保留当前卷，先在隔离安装中验证恢复结果。

备份后执行：

```sh
git pull --ff-only
docker compose up -d --build
docker compose ps
```

重新检查[健康状态](http://localhost:3000/api/health)、登录和一份基础分析。应用启动时会对现有数据库执行 `03` 至 `14` 号增量 SQL；全新数据库首次初始化时会加载基础结构。升级时不要删除 Docker 卷。Git 提示本地修改时，先处理再拉取；应用启动失败时先查看应用与数据库日志。

### 常见问题

| 现象 | 检查方式 |
|---|---|
| Docker 无法连接 | 启动 Docker Desktop，或检查 Linux 上的 Docker 服务与权限 |
| 3000 端口被占用 | 停止其他本地程序，或在未跟踪的 `.env` 设置 `HOST_APP_PORT` 并使用对应的 localhost 端口 |
| 登录页尚未就绪 | 查看 `docker compose ps` 和 `docker compose logs --tail=100 app db` |
| 健康检查返回 503 | 检查数据库状态和应用日志；健康检查不覆盖外部供应商 |
| 健康检查正常但分析失败 | 检查报告错误、行情可用性和已保存的模型连接 |
| 已保存的供应商 Key 无法解密 | 恢复匹配的 `settings.key`，或重新录入供应商 Key |
| 数据好像消失了 | 创建或删除任何内容前，先核对 Compose 项目名与已有卷 |

基础分析不需要 AI Key，但仍会请求公共行情。模型分析、Finnhub 研究、截图识别、通知和已连接的 Agent 会使用各自配置的外部服务。本地安装不代表离线大模型，也不保证数据完全不会离开你的电脑。
