# Public deployment on a single ECS instance

This setup has no demo account, does not publish PostgreSQL or port 3000, and
checks database readiness. It is a **single-instance** deployment: the auth
rate limiter and analysis queue are local to one process. Do not scale the app
to multiple replicas without shared rate limiting and a durable job queue.

1. Install Docker Engine with the Compose plugin on Ubuntu. Point a domain's A
   record to the server. Allow inbound 80/443, restrict SSH to your IP, and keep
   3000/5432 closed. Use Caddy for HTTPS.
2. Clone the repository. Create an untracked `.env.production` in the repository
   root with independent random `POSTGRES_PASSWORD`, `JWT_SECRET` and
   `SETTINGS_ENCRYPTION_KEY` values (at least 32 characters, and a URL-safe
   alphanumeric PostgreSQL password). Set file permissions to owner-only. Do
   not copy the placeholder values from `deploy/public.env.example`.
3. Start without public ingress and temporarily set `REGISTER_ENABLED=true`:

   ```bash
   docker compose --env-file .env.production -f deploy/compose.public.yml up -d --build
   docker compose --env-file .env.production -f deploy/compose.public.yml ps
   curl -fsS http://127.0.0.1:3000/api/health
   ```

   From your own computer, use `ssh -L 3000:127.0.0.1:3000 user@server` and
   register your first account through `http://localhost:3000/register`. Save
   the one-time recovery code offline. For a private instance, set
   `REGISTER_ENABLED=false` and restart the app. For a public beta, leave
   `REGISTER_ENABLED=true` to allow strangers to sign up, and check the
   abuse controls and data-provider terms for your expected audience.
4. Install Caddy, replace the domain in `deploy/Caddyfile.example`, and load it
   as `/etc/caddy/Caddyfile`. DNS and inbound 80/443 must work for automatic
   HTTPS. Check the browser's secure connection and `/api/health` through the
   public domain.
5. Run `bash deploy/backup-public.sh` for a compressed database backup, schedule
   it daily, and copy backups **off the ECS** with your preferred encrypted
   storage. Test restoring a backup into a separate database before launch.
   Back up `.env.production` securely as well; losing the settings encryption
   key makes stored provider keys unreadable. Enable cloud-disk snapshots and
   test a restore. Never use `docker compose down -v` during an upgrade.

The production Compose file omits the fictional demo seed. Rates are fetched
from Frankfurter with the provider's actual publication date. Public quotes
may be delayed or unavailable. Interrupted analysis runs are marked failed at
startup so users can retry without an indefinitely spinning task. Monitor
container health, logs, available disk space, backups, and provider failures.

Registration issues a one-time offline recovery code. Users must save it before
entering the app. Recovery replaces the password and code and revokes prior
sessions. Existing accounts can generate a code from API Settings using their
current password. With neither password nor recovery code, an account cannot
be restored. There is no verified email, CAPTCHA, shared rate limit, or
provider-grade market-data SLA. For a large unrestricted public signup, add
identity verification, distributed abuse controls, and a durable queue before
increasing capacity.
