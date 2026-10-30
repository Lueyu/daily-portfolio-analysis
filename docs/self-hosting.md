# Run Squabble on your own computer

[中文](self-hosting.zh-CN.md) · [README](../README.md) · [Server deployment](public-deployment.md)

Start here to explore Squabble with fictional data. You need **Git and Docker
with Docker Compose**. You do not need to install Node.js, Python, PostgreSQL,
or obtain an LLM API key. Docker builds and runs the application and database.

| Your goal | Follow this path |
|---|---|
| Try the interface and basic analysis locally | This page |
| Start with your own account and an empty database | [Clean single-server deployment](public-deployment.md), through the SSH-tunnel step; keep using the tunnel if you do not need a domain |
| Make your instance available through a domain | [Single-server deployment with HTTPS](public-deployment.md) |
| Work on the source code | [Development guide](development.md) |

Self-hosting puts the database and its operation under your control. It does
not mean all processing is offline: public quotes leave the server, and
configured AI, financial-data and notification services receive relevant
requests. On someone else's instance, that instance's operator controls the
server and database. Read the [privacy boundaries](privacy.md) before entering
real holdings or provider keys.

## 1. Check the prerequisites

- Install [Git](https://git-scm.com/downloads).
- On Windows or macOS, install and **open [Docker Desktop](https://docs.docker.com/desktop/)**. Wait until its engine is running. On Windows, use Linux containers and complete Docker's WSL setup if prompted.
- On Linux, install [Docker Engine and the Compose plugin](https://docs.docker.com/engine/install/). Depending on your installation, Docker commands may need `sudo`.

Open PowerShell on Windows, or Terminal on macOS/Linux, and run:

```sh
git --version
docker compose version
docker info
```

All three commands should succeed. If `docker info` cannot connect to the
daemon, start Docker before continuing.

## 2. Download and start

Run these commands in the same terminal, one at a time:

```sh
git clone https://github.com/Lueyu/squabble.git
cd squabble
docker compose up -d --build
```

The first build downloads images and dependencies, then compiles the app. It
can take several minutes or longer on a slow connection; later starts reuse
the build. Keep the terminal open until the command finishes.

```sh
docker compose ps
docker compose logs --tail=80 app
```

Expect `db` to be **healthy** and `app` to be **Up**. The local Compose file
does not define an app health check, so verify the app in your browser too:

- [Health check](http://localhost:3000/api/health) returns `{"status":"ok"}`.
- [Open Squabble](http://localhost:3000) displays the login page.
- Log in with **username `demo` / password `demo1234`**, or use the demo-account button.

The root Compose file publishes port 3000 on the host's network interfaces
and uses known demo credentials. Keep this trial on a trusted local machine;
use the [clean deployment configuration](public-deployment.md) for a real
instance. Do not expose the demo port through a router or cloud security group.

## 3. Try the first workflow

1. Open the portfolio and existing research reports to inspect the fictional holdings and saved results.
2. Open **Daily Analysis**, choose a stock or your portfolio, and start an analysis. With no model configured, it uses free basic mode: local rules plus available public quotes. Reports identify missing evidence and retain a conservative Watch/low result.
3. To try AI analysis, open **API Settings**. Enter your provider's key, OpenAI-compatible Base URL, and fast/slow model IDs, save, then use **Test connection**. The built-in instructions link to provider setup pages. This is optional; provider usage may incur charges.

Personal model settings take precedence over a host-wide model. Configured
model failures are shown as failures; they do not silently become basic
reports. A connection test sends a small request using the saved key. Public
quotes may be delayed or unavailable regardless of model configuration.

Current research still lacks complete verified financial inputs, so newly
generated AI reports also remain Watch/low with no target price. Adding a
model or optional Finnhub key does not remove that evidence requirement.

Paper trading stays in an isolated paper account. A real-execution note is a
manual record; it does not submit an order to a broker.

## Stop, start, and update

Run commands from the `squabble` folder. Closing the terminal does not stop
containers started with `-d`.

| Action | Command |
|---|---|
| Stop while keeping data | `docker compose stop` |
| Start again | `docker compose up -d` |
| Restart the app | `docker compose restart app` |
| Inspect status | `docker compose ps` |
| Watch recent logs; Ctrl+C exits the log view | `docker compose logs -f --tail=100 app db` |
| Apply a Compose environment change | `docker compose up -d app` |

Before updating, make the backup below and note the current version with
`git rev-parse HEAD`. Then:

```sh
git pull --ff-only
docker compose up -d --build
docker compose ps
```

Recheck [health](http://localhost:3000/api/health) and sign in. Existing data
stays in Docker volumes; current startup migrations apply additive changes
from SQL files 03–06. If Git reports local changes or the app fails to start,
inspect the error before proceeding. Do not delete volumes to fix an upgrade.

## Where data and settings live

| Item | Location in the local Compose deployment |
|---|---|
| Accounts, holdings, reports, paper activity and encrypted provider keys | PostgreSQL in the `dpa-data` named volume |
| Key used to decrypt saved provider credentials | Generated once in the `settings-secrets` named volume, unless explicitly supplied |
| Application code and build instructions | Your cloned repository |

Docker prefixes volume names with the Compose project name. Keep the same
repository folder/project name when restarting; changing it can create a new
empty deployment while the old volumes still exist. Database initialization
and demo seeding run only when the database volume is empty.

### Environment variables: what actually takes effect

The root `docker-compose.yml` reads only these values through `${...}`:

| Variable | Behavior |
|---|---|
| `JWT_SECRET` | Uses the shipped demo value unless overridden; real deployments need a private secret |
| `SETTINGS_ENCRYPTION_KEY` | Uses your explicit key, or generates and retains one in `settings-secrets` |
| `DB_IMAGE` | Defaults to `postgres:16-alpine` |

A root `.env` file supplies Compose substitutions. It **does not automatically
forward arbitrary variables into the app**. In particular, the demo file sets
`REGISTER_ENABLED: "true"` literally, so writing `REGISTER_ENABLED=false` only
in `.env` will not close registration. Use the public deployment file for a
clean private instance; it supports that substitution explicitly.

For an advanced local override, create `docker-compose.override.yml`:

```yaml
services:
  app:
    environment:
      REGISTER_ENABLED: "false"
      PAPER_TRADING_ENABLED: "false"
```

Then run `docker compose up -d app`. This closes new registration and disables
the paper scheduler; it does **not** remove the existing demo account. Other
server settings, such as host-wide `DOUBAO_API_KEY`, also require an explicit
Compose `environment` entry. Prefer personal API Settings for the usual setup,
and never commit a file containing secrets.

## Back up before changing data or upgrading

If the repository does not yet contain a `backups` folder, create it once:

```sh
mkdir backups
```

The commands below work in PowerShell as well as macOS/Linux shells and avoid
piping binary backup data through the terminal:

```sh
docker compose exec -T db pg_dump -U postgres -d portfolio -Fc -f /tmp/squabble-backup.dump
docker compose cp db:/tmp/squabble-backup.dump ./backups/squabble-backup.dump
docker compose cp app:/app/.secrets/settings.key ./backups/settings.key
```

Use a different dated filename for each backup so you retain older copies.
The last command applies to the default automatically generated key. If you
set `SETTINGS_ENCRYPTION_KEY` explicitly, securely back up that value instead,
along with your private environment configuration. Record the code version.
Copy backups to protected storage outside this machine. They contain private
data; losing the corresponding encryption key makes saved API keys unreadable.

### Test a restore without replacing the running database

This creates a **separate database** called `portfolio_restore_check` inside
the existing PostgreSQL container. It needs additional free disk space. The
running app continues to use `portfolio`.

```sh
docker compose cp ./backups/squabble-backup.dump db:/tmp/squabble-restore.dump
docker compose exec -T db createdb -U postgres portfolio_restore_check
docker compose exec -T db pg_restore -U postgres --exit-on-error --no-owner -d portfolio_restore_check /tmp/squabble-restore.dump
docker compose exec -T db psql -U postgres -d portfolio_restore_check -c "SELECT count(*) FROM users; SELECT count(*) FROM holdings;"
```

Require `pg_restore` to finish without errors and compare the restored records
with the expected backup. If the check database already exists, choose a new
name throughout; do not restore over it. This verifies the database dump, not
an application cutover or the saved-key backup. For an actual recovery, retain
the original volumes and validate the database **and its matching encryption
key** in an isolated deployment before switching users to it.

**Do not run `docker compose down -v` to upgrade, troubleshoot, or restore.**
It deletes both local data and the generated encryption-key volume. To see a
fresh demo without deleting the current one, stop this stack and start a
separate project with `docker compose -p squabble-demo-fresh up -d --build`;
use that same `-p` name for its later commands.

## Troubleshooting

| What you see | What to check |
|---|---|
| `docker` or `git` is not recognized | Install the prerequisite, then reopen the terminal |
| Cannot connect to the Docker daemon | Open Docker Desktop and wait for the engine; on Linux check the Docker service and permissions |
| `no configuration file provided` | Run the command inside the cloned `squabble` folder |
| Port 3000 is already allocated | Stop the program or other Compose project using port 3000, then run `docker compose up -d` again |
| Image pull, `npm ci`, or build fails | Read the first failed step; check registry/package network access, free disk and Docker memory. A first build is not an instant download |
| Login page is not ready | Check `docker compose ps` and `docker compose logs --tail=100 app db`; wait for the database and app to start |
| `demo` login fails | An existing database may not contain the demo seed, or its password may have changed. Seeding is not repeated on existing volumes |
| Health returns 503 | The app cannot query the database; inspect both app and database logs |
| Health works but analysis fails | Check the report error, quote availability and saved model connection. Health only checks the app/database connection |
| Saved API keys cannot be decrypted | Restore the matching encryption key, or re-enter the affected provider keys; do not keep rotating secrets |
| Data appears to have vanished | Check the Compose project/folder name and existing volumes before creating or removing anything |

For restricted networks, `Dockerfile` supports `BASE_REGISTRY` and Compose
supports `DB_IMAGE`. Use a registry you trust; a mirror can help image pulls
but does not solve blocked npm downloads or market-data endpoints.

Old platform-era databases using `workspace_*` schemas or composite owner
types need a separately planned migration. Keep an untouched dump and test
conversion on a copy; current startup migrations do not perform that conversion.
