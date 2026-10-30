# 在一台服务器上部署自己的吵股

[English](public-deployment.md) · [本地演示](self-hosting.zh-CN.md) · [返回首页](../README.zh-CN.md)

本文适用于**全新 Ubuntu 服务器**，包括阿里云 ECS，采用手动部署。使用 [`deploy/compose.public.yml`](../deploy/compose.public.yml)：空白 PostgreSQL 数据库、没有演示账号、一个应用容器，可选 Caddy HTTPS 入口。目前不提供需要注册的官方托管服务，也没有一键云安装器。

服务器由你运维。如果邀请其他人使用，他们的数据保存在**你的服务器**上，你作为运营者拥有数据库与加密密钥的访问权。这与每位用户自己部署的隐私边界不同，详见[隐私说明](privacy.zh-CN.md)。

## 开始前准备好

- 一台全新 Ubuntu 24.04 LTS 服务器，能通过 SSH 登录，登录账号可以使用 `sudo`。下文服务器端命令适用于 Ubuntu，不能在自己电脑的 Windows PowerShell 中直接代替执行。
- 服务器能够访问 GitHub、镜像源、软件包源及你选择的行情/模型服务商。应用在服务器上编译，需要为构建过程预留内存与磁盘，而不只是满足运行时占用。
- 若要公网 HTTPS：一个你控制的域名，配置 A 记录指向服务器公网 IPv4。仅通过下文的 SSH 隧道访问时，不需要域名。

在云控制台的安全组中，将 **SSH 22 端口限制为只允许你的 IP**。后续启用 HTTPS 时开放 TCP **80、443**。保持 **3000、5432 不对公网开放**。使用系统防火墙时也需配置相应规则；修改 SSH 规则时避免把自己锁在外面。

| 文中的标记 | 在哪里执行 |
|---|---|
| **自己的电脑** | Windows PowerShell 或 macOS / Linux 终端 |
| **服务器** | SSH 登录成功后出现的远程终端 |

下面的 `SERVER_IP` 和 `SSH_USER` 是占位符，分别替换为云控制台给出的服务器地址和 SSH 登录用户名，不是吵股账号。如果使用密钥文件登录，给 SSH 命令加上 `-i 密钥文件路径`。

## 1. 登录服务器，安装工具

**自己的电脑：**

```sh
ssh SSH_USER@SERVER_IP
```

**服务器：**先安装基础工具，再按 Docker 官方的 [Ubuntu apt 仓库安装步骤](https://docs.docker.com/engine/install/ubuntu/#install-using-the-apt-repository)安装 Docker Engine **和 Compose 插件**。如果已装过其他 Docker 软件包，先按该官方页面处理包冲突。服务器不需要单独安装 Node.js 或 Python。

```bash
sudo apt update
sudo apt install -y git curl openssl nano
```

安装 Docker 后先验证：

```bash
sudo systemctl enable --now docker
sudo docker run --rm hello-world
sudo docker compose version
```

应看到 Docker 测试成功提示和 Compose 版本。本文统一使用 `sudo docker`，不要求把登录用户加入 `docker` 用户组。

## 2. 下载应用，生成私有密钥

**服务器：**

```bash
git clone https://github.com/Lueyu/squabble.git
cd squabble
```

在这个文件夹中执行下面的完整代码块，**只执行一次**。它会生成三个独立的 64 位十六进制随机值，写入仅当前用户可访问的 `.env.production`；若文件已存在则拒绝覆盖。不需要复制示例密钥，也不需要 Node.js。

```bash
(
  set -eu
  umask 077
  set -C
  database_secret=$(openssl rand -hex 32)
  session_secret=$(openssl rand -hex 32)
  settings_secret=$(openssl rand -hex 32)
  cat > .env.production <<EOF
POSTGRES_PASSWORD=$database_secret
JWT_SECRET=$session_secret
SETTINGS_ENCRYPTION_KEY=$settings_secret
REGISTER_ENABLED=true
EOF
)
```

启动检查要求密钥至少 32 个字符，并拒绝仓库中的占位值。三个值应彼此独立且保持稳定。现在就安全备份这个文件：丢失 `SETTINGS_ENCRYPTION_KEY` 会使已保存的服务商 Key 无法解密。Git 已忽略 `.env.production`；不要公开、截图分享，也不要每次升级都重新生成。

本文为新部署固定使用 Compose 项目名 `squabble-public`。**下面每条命令中的 `-p squabble-public`、`--env-file .env.production`、`-f deploy/compose.public.yml` 都需要保留。**直接运行 `docker compose up` 会选择根目录的演示配置。已有部署若使用其他项目名，请继续沿用原名，不要把更换项目名当作升级步骤。

## 3. 先私下启动，确认健康

**服务器，在克隆后的 `squabble` 文件夹中：**

```bash
sudo docker compose -p squabble-public --env-file .env.production -f deploy/compose.public.yml config --quiet
sudo docker compose -p squabble-public --env-file .env.production -f deploy/compose.public.yml up -d --build
sudo docker compose -p squabble-public --env-file .env.production -f deploy/compose.public.yml ps
curl -fsS http://127.0.0.1:3000/api/health
```

首次构建可能需要几分钟，慢网络下会更久。构建结束后再等两个容器进入 **healthy**；健康接口应返回 `{"status":"ok"}`。若尚未就绪，查看日志，不要重复初始化或删除数据：

```bash
sudo docker compose -p squabble-public --env-file .env.production -f deploy/compose.public.yml logs --tail=100 app db
```

应用只绑定服务器的 `127.0.0.1:3000`，PostgreSQL 不发布主机端口。生产构建会隐藏演示登录按钮。该配置只保证**新卷**不导入演示数据，不会清除复用数据库里已有的演示账号。

## 4. 用 SSH 隧道注册自己的账号

**自己的电脑，另开一个终端**，执行并保持运行：

```sh
ssh -N -L 13000:127.0.0.1:3000 SSH_USER@SERVER_IP
```

认证成功后没有输出是正常的。在**自己电脑的浏览器**打开[注册页面](http://localhost:13000/register)。隧道将本机的 13000 端口转发到服务器内部的应用端口，无需在安全组开放 3000。

使用 12–128 个字符的密码注册个人账号。它是普通应用账号，并不是特殊的管理员角色。离开页面前，**离线保存一次性恢复码**。已有账号可在「设置」中凭当前密码生成恢复码；密码和恢复码同时丢失后无法自助找回。

如果只供自己使用，注册后关闭新用户注册。**服务器：**

```bash
nano .env.production
```

只把 `REGISTER_ENABLED=true` 改为 `REGISTER_ENABLED=false`。nano 中按 Ctrl+O、回车保存，再按 Ctrl+X 退出。然后使配置生效：

```bash
sudo docker compose -p squabble-public --env-file .env.production -f deploy/compose.public.yml up -d app
```

仅执行 `restart app` 不会加载新的环境变量。通过隧道重新登录验证。只想私人访问，到这里就可以了；每次使用时重新连接隧道即可。基础分析不需要模型 Key，之后想用 AI 再到 **设置**中添加个人配置。

如果明确希望开放注册，可保留 `true`；分享地址前先阅读本文末尾的运营限制。

## 5. 可选：用域名与 HTTPS 访问

**服务器：**按 Caddy 官方 [Debian / Ubuntu 软件包安装步骤](https://caddyserver.com/docs/install#debian-ubuntu-raspbian)安装，它会提供名为 `caddy` 的系统服务。下文假设是没有既有网站配置的全新服务器。

```bash
sudo cp deploy/Caddyfile.example /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile
```

把 `squabble.example.com` 改成自己的真实域名，保留上游地址 `127.0.0.1:3000`，保存并退出。确认 DNS A 记录已指向这台服务器，且 TCP 80/443 已放行，再执行：

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl enable --now caddy
sudo systemctl reload caddy
```

**自己的电脑：**打开 `https://你的域名` 登录，再打开 `https://你的域名/api/health`。应看到有效 HTTPS 连接，健康接口返回 `{"status":"ok"}`。DNS 和入站网络正确时，Caddy 会获取并续期证书。此时可按 Ctrl+C 关闭 SSH 隧道，通过域名访问已不依赖隧道。

## 备份与安全的恢复演练

**服务器，在仓库目录内：**用与部署一致的项目名执行备份脚本：

```bash
sudo env SQUABBLE_COMPOSE_PROJECT=squabble-public bash deploy/backup-public.sh
```

脚本会在 `backups/` 中创建带时间戳、限制访问权限的 PostgreSQL 自定义格式备份，记下它输出的文件名。另外安全备份 `.env.production`，并用 `git rev-parse HEAD` 记录代码版本。数据和密钥均应加密复制到**这台服务器以外**。此部署的数据库备份不包含加密密钥。

使用服务器调度器每天执行。例如运行 `sudo crontab -e`，加入下面这一行；将 `/ABSOLUTE/PATH/squabble` 替换为在仓库目录执行 `pwd` 得到的绝对路径：

```cron
15 3 * * * SQUABBLE_COMPOSE_PROJECT=squabble-public /bin/bash /ABSOLUTE/PATH/squabble/deploy/backup-public.sh >> /var/log/squabble-backup.log 2>&1
```

该时间以**服务器时区**为准。它不会自动异地复制或清理旧备份；需要另外安排保留期限和异地存储，并检查是否每天产生非空的新文件。

在**独立数据库**演练恢复，运行中的应用继续使用 `portfolio`。把下面的 `BACKUP_FILE.dump` 替换为备份脚本输出的实际文件名。逐行执行，任何一步报错都先停下排查：

```bash
sudo docker compose -p squabble-public --env-file .env.production -f deploy/compose.public.yml cp backups/BACKUP_FILE.dump db:/tmp/restore-check.dump
sudo docker compose -p squabble-public --env-file .env.production -f deploy/compose.public.yml exec -T db createdb -U postgres portfolio_restore_check
sudo docker compose -p squabble-public --env-file .env.production -f deploy/compose.public.yml exec -T db pg_restore -U postgres --exit-on-error --no-owner -d portfolio_restore_check /tmp/restore-check.dump
sudo docker compose -p squabble-public --env-file .env.production -f deploy/compose.public.yml exec -T db psql -U postgres -d portfolio_restore_check -c "SELECT count(*) FROM users; SELECT count(*) FROM holdings;"
```

确认恢复成功并核对数据。如果检查库已经存在，请在全部命令中换一个新库名。该演练需要额外磁盘空间，只验证数据库备份，不会切换应用，也没有验证密钥恢复。真正灾难恢复时，保留原部署，先在隔离实例验证恢复的数据库与匹配的加密密钥，再切换流量。**不要先删除正在使用的数据卷来测试备份。**

## 日常维护与升级

**服务器，在仓库目录内：**

```bash
# 不改变配置，仅重启应用
sudo docker compose -p squabble-public --env-file .env.production -f deploy/compose.public.yml restart app

# 停止容器，保留数据库
sudo docker compose -p squabble-public --env-file .env.production -f deploy/compose.public.yml stop

# 再次启动，或使环境变量修改生效
sudo docker compose -p squabble-public --env-file .env.production -f deploy/compose.public.yml up -d
```

升级前先备份，用 `git rev-parse HEAD` 记录当前版本，并阅读与部署有关的变更，再执行：

```bash
git pull --ff-only
sudo docker compose -p squabble-public --env-file .env.production -f deploy/compose.public.yml up -d --build
sudo docker compose -p squabble-public --env-file .env.production -f deploy/compose.public.yml ps
curl -fsS http://127.0.0.1:3000/api/health
```

从平时使用的地址验证登录和一次基础分析。数据仍保留在命名卷内；当前启动迁移会应用 03–06 号 SQL。修改环境文件里的 `POSTGRES_PASSWORD` 不会自动更改已初始化数据库内的密码。不要把轮换密钥作为常规升级步骤，也不要在维护时运行 `down -v` 或删除 Docker 卷。

## 出错时从这里查

| 现象 | 下一步 |
|---|---|
| Docker 提示权限不足 | 使用本文的 `sudo docker` 命令 |
| Compose 提示缺少必需变量 | 检查仓库目录、`.env.production` 路径和 `--env-file`；`config --quiet` 可检查替换结果且不输出密钥 |
| 应用提示密钥不安全 | 检查三个值均为独立随机值、至少 32 字符，且不是示例占位值 |
| 拉镜像或构建失败 | 找第一个失败步骤；检查镜像/包源网络、`df -h` 磁盘空间和 `free -h` 内存 |
| 应用反复重启，或健康接口 503 | 查看 `logs --tail=100 app db`，检查数据库是否就绪和密码是否一致 |
| 隧道失败 | 检查 SSH 登录和本机 13000 端口；若被占用，同时修改命令与浏览器地址中的本机端口 |
| 提示注册已关闭 | 临时改为 `REGISTER_ENABLED=true`，执行 `up -d app`，再通过私人隧道注册 |
| 本机健康检查成功，但域名访问失败 | 检查 DNS、80/443 安全组规则、Caddy 配置，以及 `sudo journalctl -u caddy -n 100 --no-pager` |
| Caddy 返回 502 | 在服务器检查应用健康接口，核对 Caddy 上游与应用主机端口是否一致 |
| 恢复后已保存的服务商 Key 失效 | 恢复匹配的 `SETTINGS_ENCRYPTION_KEY`，或重新填写服务商 Key |
| 健康检查正常，但报告失败 | 健康检查只验证数据库连接，不验证外部行情或模型；查看报告错误并测试已保存的模型配置 |

求助时不要直接分享环境文件或完整的 Compose 展开配置，其中可能包含密钥。

## 开放注册前需要知道的限制

当前配置适合**一台服务器、一个应用实例**。登录限流与分析队列在单进程内；重启后被中断的分析会标记为失败，用户可以重试。当前没有持久化分布式任务队列、跨实例限流、邮箱验证或验证码；账号找回依赖离线恢复码，不是邮件重置。

持续关注容器健康、应用错误、磁盘、备份成功率与服务商故障。公开行情可能延迟或不可用，面向其他用户服务时还需核对数据源的使用条款。若准备大规模开放注册或扩展多个应用副本，应先补齐相应的身份验证、防滥用与任务基础设施。

只有公网 Compose 明确映射的环境变量才会传入应用。例如，只在 `.env.production` 写 `DOUBAO_API_KEY` 不会启用全站模型。个人 **设置**不需要修改 Compose；高级全站配置需要额外覆盖文件中显式映射环境变量，并在后续每条 Compose 命令中一致带上该文件。
