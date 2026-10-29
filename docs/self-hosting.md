# Self-Hosting Guide

吵股 Squabble is designed to be self-hosted first: your data stays on your
machine, and the only outbound calls are the ones you configure (see
[privacy.md](privacy.md)).

## Quick start

```bash
git clone https://github.com/Lueyu/squabble.git
cd squabble
docker compose up --build
```

Open http://localhost:3000 and log in with the built-in demo account
(**demo / demo1234** — the login page can fill it with one click). The demo
loads a fictional portfolio (6 holdings across US/HK/CN, 3 completed agent
runs including a 2-version NVDA research report, one triggered risk gate).
No API keys are needed: quotes fall back to seeded prices and the
pre-generated reports speak for themselves. Change or drop the demo account
for any public deployment.

## What the two containers do

- **db** — PostgreSQL 16. On first start the entrypoint applies, in order:
  `scripts/db/01_schema.sql` (21 tables incl. `users`, in the public schema,
  text ownership columns) and `02_demo_seed.sql` (the fictional demo dataset
  plus the demo account). Data persists in the `dpa-data` volume.
- **app** — the NestJS server serving both the API and the built SPA on port
  3000, connecting to the db service directly via Drizzle (no platform layer).

## Environment variables

| Variable | Default in compose | Purpose |
|---|---|---|
| `SERVER_HOST` / `SERVER_PORT` | `0.0.0.0` / `3000` | Listen address |
| `DATABASE_URL` | `postgres://postgres:postgres@db:5432/portfolio` | PostgreSQL connection (legacy `?schema=` params are ignored) |
| `JWT_SECRET` | *(demo value)* | JWT signing secret for auth — **change it for any real deployment** (min 16 chars) |
| `REGISTER_ENABLED` | `true` | Set to `false` to close registration for a private deployment |
| `ACCESS_TOKEN_TTL` / `REFRESH_TOKEN_TTL` | `2h` / `30d` | Session lifetimes |
| `DOUBAO_API_KEY` | *(unset)* | LLM key for running real analyses. Without it the multi-agent reasoning is disabled; everything else works |
| `AGENT_GATEWAY_ENABLED` | `false` | Enables the `/openapi/agent-gateway` used by the Python agent service |

To run analyses against real stocks, put your key in a
`docker-compose.override.yml`:

```yaml
services:
  app:
    environment:
      DOUBAO_API_KEY: sk-your-key
```

then `docker compose up -d`. A Finnhub token for live quotes is entered in the
UI (stored only in that browser, see [privacy.md](privacy.md)).

## Behind a firewall

If Docker Hub is unreachable, pull base images through a mirror:

```bash
docker compose build --build-arg BASE_REGISTRY=docker.m.daocloud.io/library
```

and set `DB_IMAGE=docker.m.daocloud.io/library/postgres:16-alpine` in a `.env`
file before `docker compose up`.

## Upgrading

```bash
git pull
docker compose up --build -d
```

Database schema changes are applied via SQL migration notes in the release
notes when they occur; your data volume is preserved.

## Backup & restore

```bash
# backup
docker compose exec db pg_dump -U postgres portfolio > backup-$(date +%F).sql

# restore into a fresh volume
docker compose down -v
docker compose up -d db       # wait for healthy
cat backup-2026-10-30.sql | docker compose exec -T db psql -U postgres -d portfolio
docker compose up -d
```

## Resetting the demo

```bash
docker compose down -v        # removes the data volume
docker compose up -d          # re-seeds schema + fictional demo dataset
```

## Upgrading from a pre-2.0 self-hosted deployment

Older self-hosted instances stored row ownership in a `user_profile` Postgres
composite type inside a `workspace_*` schema. The current release uses plain
`text` owner columns in the public schema plus a `users` table. To migrate an
existing database, extract the data (`pg_dump`), then restore it into a fresh
container while rewriting the owner values:

```sql
-- inside the new database, after restoring business tables:
-- 1) convert owner columns from the composite type to text, e.g.
UPDATE holdings SET owner = (owner).user_id;  -- if restoring into the old schema
-- 2) or transform the dump: replace ('<user-id>') literals and
--    "workspace_<id>"."table" references with plain "table" + '<user-id>'
```

For most personal deployments the fastest path is exporting your holdings,
transactions and watchlist as CSV from the old instance and re-importing into
a fresh one.

## Reverse proxy / HTTPS

The app listens on one port and serves both the SPA and `/api`, so any
reverse proxy (Caddy, nginx, Traefik) forwarding to `app:3000` works. WebSockets
are not required.
