# 在阿里云 ECS 开放注册（单机公测）

使用 `deploy/compose.public.yml`。它不导入演示持仓和演示账号；PostgreSQL 不对外开放，应用仅监听本机 3000 端口，由 Caddy 提供 HTTPS。此配置只适合单台 ECS、单个应用实例。

1. 在 Ubuntu ECS 安装 Docker Engine 与 Compose 插件。将域名 A 记录指向 ECS；安全组只对外开放 80/443，SSH 仅允许你的 IP。不要开放 3000/5432。
2. 克隆仓库，在根目录创建不提交到 Git 的 `.env.production`。分别生成三个独立的随机密钥，长度至少 32 位。PostgreSQL 密码只用字母和数字。示例字段见 `deploy/public.env.example`，**不要使用示例值**。

   ```dotenv
   POSTGRES_PASSWORD=<独立随机字母数字密码>
   JWT_SECRET=<独立随机密钥>
   SETTINGS_ENCRYPTION_KEY=<独立随机密钥>
   REGISTER_ENABLED=true
   ```

   执行 `chmod 600 .env.production`。丢失 `SETTINGS_ENCRYPTION_KEY` 会使用户保存的 API Key 无法解密。
3. 先不开放公网入口，启动并检查健康状态：

   ```bash
   docker compose --env-file .env.production -f deploy/compose.public.yml up -d --build
   docker compose --env-file .env.production -f deploy/compose.public.yml ps
   curl -fsS http://127.0.0.1:3000/api/health
   ```

   在你自己的电脑执行 `ssh -L 3000:127.0.0.1:3000 user@服务器地址`，打开 `http://localhost:3000/register` 注册管理员账号。**离线保存**页面给出的一次性恢复码。
4. 将 `deploy/Caddyfile.example` 的域名改成自己的域名，放到 `/etc/caddy/Caddyfile`，启动 Caddy。确认浏览器使用 HTTPS，并通过域名访问 `/api/health`。保持 `REGISTER_ENABLED=true` 即允许陌生用户注册；关闭注册可改为 `false` 后重新运行上述 Compose 命令。
5. 每天执行 `bash deploy/backup-public.sh`，将生成的压缩备份加密复制到 ECS 以外，并在独立数据库实际演练恢复。另行安全备份 `.env.production`。升级时不要运行 `docker compose down -v`。

忘记密码可使用恢复码重设；重设会撤销旧浏览器会话及 Agent Session，并生成新恢复码。旧账号可在 API 设置页凭当前密码生成恢复码。密码和恢复码同时丢失后，无法自助找回。

当前限制：没有邮箱验证、验证码、跨实例限流或持久化分析任务队列；公开行情也没有服务等级保证。面向大规模不受限制的注册前，仍需补上这些能力并确认数据服务商的使用条款。分析任务在服务重启后会标记为失败，用户可以重新启动。
