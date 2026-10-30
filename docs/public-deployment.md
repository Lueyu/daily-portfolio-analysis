# Deploy your own instance on one server

[中文](public-deployment.zh-CN.md) · [Local demo](self-hosting.md) · [README](../README.md)

This is a manual deployment guide for a **fresh Ubuntu server**, including an
ECS instance. It uses [`deploy/compose.public.yml`](../deploy/compose.public.yml):
an empty PostgreSQL database, no demo account, one application container, and
an optional Caddy HTTPS entry point. There is no managed hosting account or
one-click cloud installer to sign up for.

The server is yours to operate. If you let other people use it, their data is
stored on **your server**, and you are the operator with access to the database
and encryption secrets. This is a different privacy boundary from each person
self-hosting. See [privacy](privacy.md).

## Before you start

You need:

- A fresh Ubuntu 24.04 LTS server with SSH access and an account that can use `sudo`. The commands below are for Ubuntu, not Windows PowerShell on the server.
- Internet access from the server to GitHub, container/package registries and the data/model providers you choose. Building happens on the server; allow disk and memory for compilation as well as normal operation.
- For public HTTPS: a domain you control and its DNS A record pointing at the server's public IPv4 address. A domain is unnecessary if you only use the SSH tunnel below.

In the cloud console's security group, allow **SSH port 22 only from your own
IP**. For HTTPS later, allow TCP **80 and 443**. Keep **3000 and 5432 closed**.
Apply equivalent rules if you use a server firewall. Do not change SSH rules
in a way that locks you out.

| Label in this guide | Where to run it |
|---|---|
| **Your computer** | PowerShell on Windows or Terminal on macOS/Linux |
| **Server** | The shell shown after connecting over SSH |

`SERVER_IP` and `SSH_USER` below are placeholders: replace them with the
server address and login name from your server provider. They are not Squabble
credentials. If your provider uses a key file, add `-i path/to/key` to SSH.

## 1. Connect and install the prerequisites

**Your computer:**

```sh
ssh SSH_USER@SERVER_IP
```

**Server:** install basic tools, then follow Docker's official
[Ubuntu apt-repository installation](https://docs.docker.com/engine/install/ubuntu/#install-using-the-apt-repository)
to install Docker Engine **and the Compose plugin**. Use that page's package
conflict instructions if Docker was already installed. Node.js and Python do
not need to be installed on the server.

```bash
sudo apt update
sudo apt install -y git curl openssl nano
```

After Docker installation, check it before proceeding:

```bash
sudo systemctl enable --now docker
sudo docker run --rm hello-world
sudo docker compose version
```

Expect the Docker test's success message and a Compose version. This guide
uses `sudo docker` consistently, so joining the `docker` group is unnecessary.

## 2. Download the app and create private secrets

**Server:**

```bash
git clone https://github.com/Lueyu/squabble.git
cd squabble
```

Run the following block **once** in this folder. It creates `.env.production`
with three independent random 64-character hex values and owner-only access.
It refuses to overwrite an existing file. No secret needs to be pasted from
the example file and no Node.js command is required.

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

The startup checks require secrets of at least 32 characters and reject
shipped placeholders. Keep all three independent and stable. Securely back up
this file now; losing `SETTINGS_ENCRYPTION_KEY` makes saved provider keys
unreadable. `.env.production` is ignored by Git. Do not publish it, include it
in screenshots, or regenerate it on every update.

This guide gives new deployments the fixed Compose project name
`squabble-public`. **Keep `-p squabble-public`, `--env-file .env.production`
and `-f deploy/compose.public.yml` in every command below.** A bare
`docker compose up` would select the local demo configuration instead. If you
already run an instance under another project name, retain its existing name;
do not switch names as an upgrade step.

## 3. Start privately and check health

**Server, inside the cloned `squabble` folder:**

```bash
sudo docker compose -p squabble-public --env-file .env.production -f deploy/compose.public.yml config --quiet
sudo docker compose -p squabble-public --env-file .env.production -f deploy/compose.public.yml up -d --build
sudo docker compose -p squabble-public --env-file .env.production -f deploy/compose.public.yml ps
curl -fsS http://127.0.0.1:3000/api/health
```

The first build can take several minutes or longer. After it finishes, allow
time for both containers to become **healthy**. The health URL should return
`{"status":"ok"}`. If it is not ready, inspect logs rather than repeating
initialization or deleting data:

```bash
sudo docker compose -p squabble-public --env-file .env.production -f deploy/compose.public.yml logs --tail=100 app db
```

The app is bound to the server's `127.0.0.1:3000`; PostgreSQL has no published
host port. The production build also removes the demo-login shortcut. This
configuration omits demo seeding on a **fresh volume**; it does not erase demo
accounts from a reused database.

## 4. Create your account through an SSH tunnel

**Your computer, in a second terminal:** keep this command running:

```sh
ssh -N -L 13000:127.0.0.1:3000 SSH_USER@SERVER_IP
```

No output after authentication is normal. On **your computer**, open
[the registration page](http://localhost:13000/register). The tunnel forwards
your local port 13000 to the server's private app port; do not open port 3000
in the security group.

Create your personal account with a 12–128-character password. This is an
ordinary application account, not a special administrator role. **Save the
one-time recovery code offline** before leaving the page. Existing accounts
can generate one in API Settings using their current password; losing both
password and recovery code prevents self-service recovery.

For your own private instance, close further registration. **Server:**

```bash
nano .env.production
```

Change only `REGISTER_ENABLED=true` to `REGISTER_ENABLED=false`. In nano, use
Ctrl+O, Enter to save, then Ctrl+X to exit. Apply the change:

```bash
sudo docker compose -p squabble-public --env-file .env.production -f deploy/compose.public.yml up -d app
```

`restart app` alone does not load changed environment values. Sign in again
through the tunnel and confirm it works. You can stop here for private SSH
access; reconnect the tunnel each time you need it. No LLM key is required for
basic analysis. Add a personal model later through **API Settings**.

If you deliberately want open registration, leave the value `true` and read
the operating limits at the end before sharing the URL.

## 5. Optional: publish through HTTPS

**Server:** install Caddy using its official
[Debian/Ubuntu package instructions](https://caddyserver.com/docs/install#debian-ubuntu-raspbian).
The package provides a `caddy` system service. These steps assume a fresh
server without an existing site configuration.

```bash
sudo cp deploy/Caddyfile.example /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile
```

Replace `squabble.example.com` with your actual domain, keeping the upstream
`127.0.0.1:3000`. Save and exit. Confirm the domain's A record points to this
server and TCP 80/443 are allowed; then:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl enable --now caddy
sudo systemctl reload caddy
```

**Your computer:** open `https://YOUR_DOMAIN`, sign in, and visit
`https://YOUR_DOMAIN/api/health`. Expect a valid HTTPS connection and
`{"status":"ok"}`. Caddy obtains and renews the certificate when DNS and
inbound connectivity are correct. You can now close the SSH tunnel with
Ctrl+C; it is no longer needed for browser access through the domain.

## Backups and a safe restore drill

**Server, in the repository:** run the supplied backup script with the same
project name used above:

```bash
sudo env SQUABBLE_COMPOSE_PROJECT=squabble-public bash deploy/backup-public.sh
```

It writes a timestamped PostgreSQL custom-format dump under `backups/` with
private permissions. Record the printed filename. Also retain a protected
copy of `.env.production` and the deployed code version (`git rev-parse HEAD`).
Copy both data and secrets to encrypted storage **outside this server**.
Database backups alone do not preserve the encryption key in this deployment.

Schedule the backup daily using your server's scheduler. For example,
`sudo crontab -e` can run the following line; replace `/ABSOLUTE/PATH/squabble`
with the repository path printed by `pwd`:

```cron
15 3 * * * SQUABBLE_COMPOSE_PROJECT=squabble-public /bin/bash /ABSOLUTE/PATH/squabble/deploy/backup-public.sh >> /var/log/squabble-backup.log 2>&1
```

That schedule uses the **server's timezone**. It does not copy backups off-site
or remove old backups; arrange retention and off-site copies separately, and
check that new nonempty files actually appear.

Test restoring into a **separate database** while the running app keeps using
`portfolio`. Replace `BACKUP_FILE.dump` with the exact filename printed above.
Run one line at a time and stop on any error:

```bash
sudo docker compose -p squabble-public --env-file .env.production -f deploy/compose.public.yml cp backups/BACKUP_FILE.dump db:/tmp/restore-check.dump
sudo docker compose -p squabble-public --env-file .env.production -f deploy/compose.public.yml exec -T db createdb -U postgres portfolio_restore_check
sudo docker compose -p squabble-public --env-file .env.production -f deploy/compose.public.yml exec -T db pg_restore -U postgres --exit-on-error --no-owner -d portfolio_restore_check /tmp/restore-check.dump
sudo docker compose -p squabble-public --env-file .env.production -f deploy/compose.public.yml exec -T db psql -U postgres -d portfolio_restore_check -c "SELECT count(*) FROM users; SELECT count(*) FROM holdings;"
```

Check for a successful restore and compare expected data. If the check
database already exists, use a new name everywhere. This drill consumes extra
disk space and tests the dump, not an application cutover or secret recovery.
For actual disaster recovery, preserve the original deployment and validate
the restored database with its matching settings key in an isolated instance
before switching traffic. **Never delete the live volume to test a backup.**

## Daily operation and updates

**Server, in the repository:**

```bash
# Restart without changing configuration
sudo docker compose -p squabble-public --env-file .env.production -f deploy/compose.public.yml restart app

# Stop while retaining the database
sudo docker compose -p squabble-public --env-file .env.production -f deploy/compose.public.yml stop

# Start again, or apply edited environment values
sudo docker compose -p squabble-public --env-file .env.production -f deploy/compose.public.yml up -d
```

To update: back up first, record `git rev-parse HEAD`, read changes relevant to
deployment, then run:

```bash
git pull --ff-only
sudo docker compose -p squabble-public --env-file .env.production -f deploy/compose.public.yml up -d --build
sudo docker compose -p squabble-public --env-file .env.production -f deploy/compose.public.yml ps
curl -fsS http://127.0.0.1:3000/api/health
```

Verify login and a basic analysis through your usual URL. Existing data stays
in the named volume and current startup migrations apply SQL files 03–06.
Changing `POSTGRES_PASSWORD` in the environment does not change the password
inside an already initialized database. Do not rotate secrets as an upgrade
step. Do not use `down -v` or delete Docker volumes during maintenance.

## Diagnose failures

| Symptom | Next check |
|---|---|
| Docker permission denied | Use the `sudo docker` commands in this guide |
| Compose says a required variable is missing | Confirm the repository directory, `.env.production` path and `--env-file`; `config --quiet` checks substitutions without printing secrets |
| App reports unsafe secrets | Check that all three generated values are independent, at least 32 characters, and not example placeholders |
| Image pull or build fails | Read the first failed build step; check package/registry access, available disk (`df -h`) and memory (`free -h`) |
| App keeps restarting or health returns 503 | Read `logs --tail=100 app db`; check database readiness and password consistency |
| Tunnel fails | Check SSH login and local port 13000; if occupied, choose another local port in both the command and browser URL |
| Registration is disabled | Temporarily set `REGISTER_ENABLED=true`, apply with `up -d app`, and register through the private tunnel |
| Domain fails while the local health check works | Check DNS, 80/443 security-group rules, Caddy configuration and `sudo journalctl -u caddy -n 100 --no-pager` |
| Caddy returns 502 | Check the app health URL on the server and whether the Caddy upstream matches the app's host port |
| Saved provider keys stop working after recovery | Restore the matching `SETTINGS_ENCRYPTION_KEY`, or re-enter provider keys |
| Health succeeds but reports fail | Health checks the database connection, not external quotes or model providers. Inspect the report error and test the saved model configuration |

Do not share raw environment files or full resolved Compose configurations
when asking for help: those can contain secrets.

## Operating limits before opening registration

This setup is for **one server and one app instance**. Authentication rate
limits and the analysis queue live in one process. Interrupted analyses are
marked failed on startup so users can retry. It does not provide a durable
distributed job queue, shared rate limits, verified email or CAPTCHA. Account
recovery uses the offline code, not email reset.

Monitor container health, application errors, disk usage, backup success and
provider failures. Public quotes can be delayed or unavailable. Review the
data providers' usage terms for your audience. Before scaling to unrestricted
public signup or multiple replicas, add the identity, abuse-control and job
infrastructure that such operation requires.

Only variables explicitly mapped by the public Compose file reach the app.
For example, putting `DOUBAO_API_KEY` only in `.env.production` does not enable
a host-wide model. Personal **API Settings** need no Compose changes. For
advanced host-wide settings, add an explicit environment mapping through a
separate override file and include that file consistently in every command.
