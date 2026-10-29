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

Open http://localhost:3000 — a fictional demo account is loaded automatically
(6 holdings across US/HK/CN, 3 completed agent runs including a 2-version NVDA
research report, and one triggered risk gate). No API keys are needed for the
demo: quotes fall back to seeded prices and the pre-generated reports speak for
themselves.

## What the two containers do

- **db** — PostgreSQL 16. On first start the entrypoint applies, in order:
  `scripts/db/01_init.sql` (schema + composite types), `02_tables.sql` (20
  business tables), `03_roles.sql` (datapaas roles), `04_demo_seed.sql` (the
  fictional demo dataset). Data persists in the `dpa-data` volume.
- **app** — the NestJS server serving both the API and the built SPA on port
  3000, connecting to the db service.

## Environment variables

| Variable | Default in compose | Purpose |
|---|---|---|
| `SERVER_HOST` / `SERVER_PORT` | `0.0.0.0` / `3000` | Listen address |
| `SUDA_DATABASE_URL` | `postgres://postgres:postgres@db:5432/portfolio?schema=workspace_aadkwdme7deas` | PostgreSQL connection (will be renamed to `DATABASE_URL` when the platform-compat layer lands) |
| `LOCAL_DEV_USER_ID` | `demo-user` | Identity injected by the local-dev middleware (replaced by the real auth system in an upcoming release) |
| `DISABLE_CSRF` | `true` | CSRF is handled by the platform layer; retired together with it |
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
docker compose up -d          # re-seeds the fictional demo dataset
```

## Reverse proxy / HTTPS

The app listens on one port and serves both the SPA and `/api`, so any
reverse proxy (Caddy, nginx, Traefik) forwarding to `app:3000` works. WebSockets
are not required.
