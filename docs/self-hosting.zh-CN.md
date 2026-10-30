# 在自己的电脑上运行吵股

[English](self-hosting.md) · [返回首页](../README.zh-CN.md) · [服务器部署](public-deployment.zh-CN.md)

先用虚构数据体验完整界面。你只需要 **Git 和带 Compose 的 Docker**，无需单独安装 Node.js、Python、PostgreSQL，也不需要先申请大模型 API Key。Docker 会负责构建并运行应用与数据库。

| 你的目标 | 从这里开始 |
|---|---|
| 在本机体验界面与基础分析 | 继续阅读本页 |
| 用自己的账号，从空数据库开始 | [服务器全新部署](public-deployment.zh-CN.md)，完成 SSH 隧道步骤即可；不需要域名时可一直使用隧道访问 |
| 通过域名在外部访问 | [单机服务器与 HTTPS 部署](public-deployment.zh-CN.md) |
| 修改源码 | [开发文档](development.md) |

自托管意味着你掌握服务器、数据库和运维。它不等于完全离线：公开行情请求会出网；启用模型、金融数据或通知服务后，相应请求会发往配置的服务商。如果使用别人部署的网站，服务器和数据库由对方控制。输入真实持仓或 API Key 前，请阅读[隐私边界](privacy.zh-CN.md)。

## 1. 先检查工具

- 安装 [Git](https://git-scm.com/downloads)。
- Windows / macOS：安装并**打开 [Docker Desktop](https://docs.docker.com/desktop/)**，等引擎启动。Windows 使用 Linux 容器；如果安装器要求配置 WSL，请先完成提示步骤。
- Linux：安装 [Docker Engine 和 Compose 插件](https://docs.docker.com/engine/install/)。根据安装方式，Docker 命令可能需要加 `sudo`。

Windows 打开 PowerShell；macOS / Linux 打开终端，逐行执行：

```sh
git --version
docker compose version
docker info
```

三条命令均应成功。若 `docker info` 提示无法连接 daemon，请先启动 Docker，再继续。

## 2. 下载并启动

在同一个终端逐行执行：

```sh
git clone https://github.com/Lueyu/squabble.git
cd squabble
docker compose up -d --build
```

首次运行会下载镜像、安装依赖并编译应用，可能需要几分钟，网络较慢时会更久。后续启动会复用构建结果。先等命令执行完，不要把下载和编译阶段误认为卡死。

```sh
docker compose ps
docker compose logs --tail=80 app
```

应看到 `db` 为 **healthy**，`app` 为 **Up**。本地 Compose 没有配置应用健康检查，还需要打开浏览器确认：

- [健康检查](http://localhost:3000/api/health)返回 `{"status":"ok"}`。
- [打开吵股](http://localhost:3000)，能看到登录页。
- 输入**用户名 `demo` / 密码 `demo1234`**，或点击演示账号按钮。

根目录 Compose 会将 3000 端口发布到主机网络接口，并使用公开的演示账号与密码。请只在可信的本地环境体验；正式使用请走[全新部署配置](public-deployment.zh-CN.md)。不要通过路由器或云安全组把演示端口开放到公网。

## 3. 第一次可以这样体验

1. 查看持仓和已有研究报告，了解虚构组合与报告结构。
2. 打开**每日分析**，选择单只股票或整个组合并开始分析。没有配置模型时，会使用免费基础模式：本地规则加可用的公开行情；缺失证据会明确标记，评级保持保守的 Watch / 低置信度。
3. 想体验 AI 分析，再打开 **设置**，填写服务商 Key、兼容 OpenAI 的 Base URL、快速模型和深度模型 ID，保存后点击**测试连接**。界面内有服务商申请指引。此步骤可选，服务商调用可能产生费用。

个人模型配置优先于部署者配置。已配置模型调用失败时会显示失败，不会静默改成基础报告。连接测试会使用已保存的 Key 发送一个小请求。是否配置模型，都不能保证公开行情一定及时、可用。

当前研究仍缺少完整且经过核验的财务输入，因此新生成的 AI 报告同样保持 Watch / 低置信度，不给出目标价。添加模型或可选 Finnhub Key 不会绕过这项证据要求。

模拟交易使用独立模拟账户。真实成交回录是手工记录，不会向券商下单。

## 停止、重启与升级

在 `squabble` 文件夹内执行命令。以 `-d` 启动后，关闭终端不会停止容器。

| 操作 | 命令 |
|---|---|
| 停止，保留数据 | `docker compose stop` |
| 再次启动 | `docker compose up -d` |
| 重启应用 | `docker compose restart app` |
| 查看状态 | `docker compose ps` |
| 持续查看日志；Ctrl+C 仅退出日志查看 | `docker compose logs -f --tail=100 app db` |
| 使 Compose 环境变量修改生效 | `docker compose up -d app` |

升级前先按下文备份，并运行 `git rev-parse HEAD` 记录当前版本，然后执行：

```sh
git pull --ff-only
docker compose up -d --build
docker compose ps
```

再次确认[健康检查](http://localhost:3000/api/health)和登录正常。数据保存在 Docker 卷中；当前版本启动时会自动运行 03–06 号增量 SQL。若 Git 提示存在本地修改，或应用启动失败，先检查具体错误。不要通过删除卷来解决升级问题。

## 数据和设置保存在哪里

| 内容 | 本地 Compose 的保存位置 |
|---|---|
| 账号、持仓、报告、模拟交易、加密后的服务商 Key | PostgreSQL 的 `dpa-data` 命名卷 |
| 解密已保存服务商 Key 的密钥 | 首次生成并保存在 `settings-secrets` 命名卷；显式指定密钥时除外 |
| 应用源码与构建配置 | 克隆下来的仓库目录 |

Docker 会在卷名前加 Compose 项目名。后续请保持仓库目录名和项目名一致；改名可能启动一个全新实例，而原来的卷仍然存在。建库和演示数据导入只在数据库卷为空时执行。

### 环境变量：哪些设置真的会生效

根目录 `docker-compose.yml` 只通过 `${...}` 读取以下变量：

| 变量 | 作用 |
|---|---|
| `JWT_SECRET` | 默认使用演示值；正式部署必须用私有随机值 |
| `SETTINGS_ENCRYPTION_KEY` | 使用显式设置的值；未设置时自动生成并保存在 `settings-secrets` |
| `DB_IMAGE` | 默认是 `postgres:16-alpine` |

根目录 `.env` 用于 Compose 变量替换，**不会自动把任意变量传入应用容器**。演示配置把 `REGISTER_ENABLED: "true"` 写成固定值，因此仅在 `.env` 写 `REGISTER_ENABLED=false` 无法关闭注册。正式私人实例请使用公网部署配置，它明确支持该变量替换。

需要修改本地行为时，可以新建 `docker-compose.override.yml`：

```yaml
services:
  app:
    environment:
      REGISTER_ENABLED: "false"
      PAPER_TRADING_ENABLED: "false"
```

再运行 `docker compose up -d app`，即可关闭新注册与模拟盘调度；这**不会删除已有演示账号**。其他服务器设置，例如全站模型的 `DOUBAO_API_KEY`，也需要显式写进 Compose 的 `environment`。通常直接用个人 设置即可；不要把含密钥的文件提交到 Git。

## 修改数据或升级前，先备份

如果仓库里还没有 `backups` 文件夹，先执行一次：

```sh
mkdir backups
```

下面的命令适用于 PowerShell 和 macOS / Linux 终端，不需要通过终端管道传输二进制备份：

```sh
docker compose exec -T db pg_dump -U postgres -d portfolio -Fc -f /tmp/squabble-backup.dump
docker compose cp db:/tmp/squabble-backup.dump ./backups/squabble-backup.dump
docker compose cp app:/app/.secrets/settings.key ./backups/settings.key
```

每次使用不同的日期文件名，以便保留历史备份。最后一条命令适用于默认自动生成的加密密钥；若显式设置了 `SETTINGS_ENCRYPTION_KEY`，请改为安全备份该值及私有环境配置。同时记录代码版本，并把备份复制到本机以外的受保护存储。备份包含私人数据；丢失匹配的加密密钥后，数据库里的服务商 Key 将无法解密。

### 演练恢复，不覆盖正在使用的数据库

以下步骤在现有 PostgreSQL 容器中新建一个**独立数据库** `portfolio_restore_check`，需要额外磁盘空间；运行中的应用仍使用 `portfolio`。

```sh
docker compose cp ./backups/squabble-backup.dump db:/tmp/squabble-restore.dump
docker compose exec -T db createdb -U postgres portfolio_restore_check
docker compose exec -T db pg_restore -U postgres --exit-on-error --no-owner -d portfolio_restore_check /tmp/squabble-restore.dump
docker compose exec -T db psql -U postgres -d portfolio_restore_check -c "SELECT count(*) FROM users; SELECT count(*) FROM holdings;"
```

确认 `pg_restore` 无错误退出，并核对恢复的数据。如果检查库已存在，请在全部命令中换一个新库名，不要向已有检查库重复恢复。这个步骤只验证数据库备份，不会切换应用，也没有验证加密密钥备份。真正灾难恢复时，应保留原卷，先在隔离实例验证数据库**及匹配的加密密钥**，再切换使用者。

**不要用 `docker compose down -v` 升级、排错或恢复。**它会删除本地数据卷及自动生成的加密密钥卷。想重新看一份干净演示，可先停止当前实例，再运行 `docker compose -p squabble-demo-fresh up -d --build` 创建独立项目；以后操作该演示时始终带上相同的 `-p` 名称。

## 常见问题

| 现象 | 检查方法 |
|---|---|
| 找不到 `docker` 或 `git` | 安装相应工具后，重新打开终端 |
| 无法连接 Docker daemon | 打开 Docker Desktop 等引擎就绪；Linux 检查 Docker 服务与权限 |
| `no configuration file provided` | 先进入克隆后的 `squabble` 文件夹 |
| 3000 端口被占用 | 停止占用该端口的程序或其他 Compose 项目，再运行 `docker compose up -d` |
| 拉取镜像、`npm ci` 或构建失败 | 找到第一个报错步骤，检查镜像源/包源网络、可用磁盘和 Docker 内存；首次运行包含实际编译 |
| 登录页暂时打不开 | 查看 `docker compose ps` 和 `docker compose logs --tail=100 app db`，确认数据库与应用均已启动 |
| 演示账号无法登录 | 已有数据库可能未导入演示账号，或密码已经修改；已有卷不会重新执行演示数据导入 |
| 健康检查返回 503 | 应用无法查询数据库；同时检查 app 和 db 日志 |
| 健康检查成功，分析却失败 | 查看报告中的具体错误、行情可用性和已保存模型的连接状态；健康检查只验证应用与数据库 |
| 已保存的 API Key 无法解密 | 恢复匹配的加密密钥，或重新填写受影响的服务商 Key；不要反复轮换密钥 |
| 数据好像消失了 | 先核对 Compose 项目名、目录名和已有卷，不要急于创建或删除数据 |

网络受限时，`Dockerfile` 支持 `BASE_REGISTRY`，Compose 支持 `DB_IMAGE`。只使用你信任的镜像源；镜像加速不能解决 npm 下载或行情服务连接失败。

使用 `workspace_*` schema、复合 owner 类型的旧平台数据库，需要单独规划迁移。保留原始备份并在副本上验证转换；当前启动迁移不会自动完成这种旧数据转换。
