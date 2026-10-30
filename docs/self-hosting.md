# Self-Hosting Guide

吵股 Squabble is designed to be self-hosted first: your data stays on your
machine. Research and optional AI review use your configured LLM; quotes use
public market-data providers. Optional Finnhub research requests and push
messages use the credentials or channels you configure.
See [privacy.md](privacy.md).

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
No API keys are needed to inspect the pre-generated demo reports; quote
requests may still contact public data providers. Change or drop the demo account
for any public deployment.

## What the two containers do

- **db** — PostgreSQL 16. On first start the entrypoint applies, in order:
  `scripts/db/01_schema.sql` (base tables including `users`, in the public
  schema, with text ownership columns), `02_demo_seed.sql` (the fictional demo
  dataset and account), `03_agent_builder.sql` (builder profiles and
  proposals), then `04_user_api_settings.sql` (per-user API settings). Data
  persists in the `dpa-data` volume.
- **app** — the NestJS server serving both the API and the built SPA on port
  3000, connecting to the db service directly via Drizzle (no platform layer).
  On startup it also applies the idempotent Agent Builder and API Settings
  SQL to existing database volumes. Docker generates a private settings
  encryption key once in the separate `settings-secrets` volume and reuses it
  after app rebuilds. Back up that volume with `dpa-data`.

## Environment variables

| Variable | Default in compose | Purpose |
|---|---|---|
| `SERVER_HOST` / `SERVER_PORT` | `0.0.0.0` / `3000` | Listen address |
| `DATABASE_URL` | `postgres://postgres:postgres@db:5432/portfolio` | PostgreSQL connection (legacy `?schema=` params are ignored) |
| `JWT_SECRET` | *(demo value)* | JWT signing secret for auth — **change it for any real deployment** (min 16 chars) |
| `SETTINGS_ENCRYPTION_KEY` | *(auto-generated in Docker)* | Optional explicit secret (at least 16 characters) for encrypting each user's saved LLM and Finnhub API keys. Docker keeps its generated key in `settings-secrets`. In source installs without this value, the app derives encryption from a private `JWT_SECRET`; the known demo JWT value is refused for saved API keys. Keep the effective key stable and backed up: changing it requires users to re-enter saved keys |
| `REGISTER_ENABLED` | `true` | Set to `false` to close registration for a private deployment |
| `ACCESS_TOKEN_TTL` / `REFRESH_TOKEN_TTL` | `2h` / `30d` | Session lifetimes |
| `DOUBAO_API_KEY` | *(unset)* | Host-wide LLM fallback for running fresh analyses and Agent Builder custom-prompt review. A user's saved Settings configuration overrides it; deleting that configuration returns to this fallback. Explicit builder rules and the pre-generated demo work without it |
| `AGENT_GATEWAY_ENABLED` | `false` | Enables the `/openapi/agent-gateway` used by the Python agent service |
| `PAPER_TRADING_ENABLED` | *(enabled)* | Set to `false` to disable the paper-trading bot scheduler entirely |
| `PAPER_TRADING_SCAN_MINUTES` | `15` | Minutes between bot scans (only runs while some market is open) |

To run analyses against real stocks, the simplest route is to log in, open
**API Settings**, choose an OpenAI-compatible provider, and
save its API key, Base URL, fast model and slow model. The Settings page has
step-by-step provider links and a connection test. A host-wide alternative is
to put a Doubao key in `docker-compose.override.yml`:

```yaml
services:
  app:
    environment:
      DOUBAO_API_KEY: sk-your-key
```

then `docker compose up -d`. User-specific Settings take precedence over the
host-wide Doubao environment variables. The server also queries public quote
providers; their prices may be delayed or unavailable.

Docker Compose generates a stable, private key in its `settings-secrets` volume
when `SETTINGS_ENCRYPTION_KEY` is unset. Keep that volume with the database
backup; losing it makes saved provider keys unreadable. You may supply your own
`SETTINGS_ENCRYPTION_KEY` through Compose's environment or `.env` before saving
any keys. For a source install, set a private key (at least 16 characters) or
a private `JWT_SECRET`; the shipped demo JWT value cannot protect saved API
keys and will be rejected. Changing the effective encryption key means users
must re-enter their saved keys. Do not commit secrets to Git or expose them in
a browser URL.

## API integrations in Settings

Each account can configure its own LLM and optional financial-data key. The
LLM uses the OpenAI-compatible **Chat Completions** API. Obtain an API key and
model IDs from your provider, enter the provider's **Base URL** (without
`/chat/completions`), then save and select **Test connection**. The Base URL
must be a public HTTPS address. For a self-hosted model on a private network,
set the trusted host-wide `DOUBAO_BASE_URL` and `DOUBAO_API_KEY` on the server;
the personal Settings form intentionally rejects private addresses.

Examples and official setup guides:

| Provider | Example Base URL | Setup guide |
|---|---|---|
| OpenAI | `https://api.openai.com/v1` | [API keys](https://platform.openai.com/api-keys), [quickstart](https://developers.openai.com/api/docs/quickstart), [available models](https://developers.openai.com/api/docs/models/all) |
| DeepSeek | `https://api.deepseek.com` | [API key and current models](https://api-docs.deepseek.com/en/) |
| Doubao / Ark | `https://ark.cn-beijing.volces.com/api/v3` | [beginner quickstart](https://docs.volcengine.com/docs/ark/quick-start-beginner?lang=zh), [API key management](https://docs.volcengine.com/docs/ark/manage-api-keys?lang=zh) |

Model IDs and availability change, so copy the IDs shown in your provider's
console. **Test connection** sends a small request with the *saved* key and
may count toward your provider usage. Leaving the key field blank while saving
other settings keeps the current saved key. Settings only reports whether a
key exists and a masked hint; the original key is never returned to the
browser. Delete the user LLM configuration to return to the host-wide Doubao
fallback, if configured.
If the saved key becomes unreadable after encryption-key rotation, Settings
asks for a replacement key and analysis stops; it does not silently switch to
the host-wide fallback. Explicitly removing the user connection restores that
fallback.

For financial data, [register with Finnhub](https://finnhub.io/register),
find your API key, then save it under **API Settings → Financial data** and test
with the sample US ticker. Squabble uses it to add available US-company basic
metrics and company news to research. Finnhub's official
[API documentation](https://finnhub.io/docs/api) describes coverage and
entitlements; its company-news endpoint is limited to North American
companies. A configured key does not guarantee every field or ticker will
return data. Unavailable inputs remain explicit gaps in the research. Public
quote providers remain separate, and deleting the Finnhub key returns research
to those existing sources and explicit data gaps.

## Agent Builder

Open **Agent Builder** after login. Choose a guard template (paper sells only),
scout (new paper buys from the watchlist), or balanced (paper buys from your
holdings and watchlist plus exits). Set an optional ticker allowlist, explicit
per-symbol buy/sell price triggers, minimum research rating and hard per-order,
daily-loss and daily-order limits. Price triggers are investor-authored rules
and can produce paper ideas without an AI rating. The
preview explains example outcomes; it is not a backtest. Activate one profile
and use **Run now** or the scheduled scan. The bot uses your existing research
ratings when recent and sufficiently confident; run a fresh analysis separately
when you need an updated view. Missing financial/news/valuation inputs currently
keep new analyses at Watch/low, so explicit price rules are the usable path
until verified research feeds are added. It requires an open market and a usable
public quote, which may be delayed. All orders remain in the isolated
paper account.

You can add a free-text preference. With a user LLM key or host-wide
`DOUBAO_API_KEY` configured, the LLM
may veto a rule-approved candidate; it cannot change the ticker, side, size or
hard risk limits. If LLM review fails, that candidate is skipped.

For a paper fill, the proposal inbox shows an optional real-trade idea. Push
requires a notification channel and the profile's proposal-notification
setting. You execute a real trade yourself at your broker, then skip the idea
or record the actual execution. That record is a self-reported comparison
ledger. It does **not** submit a broker order or update holdings/transactions.

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

The app applies `scripts/db/03_agent_builder.sql` and
`scripts/db/04_user_api_settings.sql` at startup. They use additive,
idempotent table/index creation, so an existing data volume is preserved. To
apply the migrations manually while the database container is running:

```bash
docker compose exec -T db psql -U postgres -d portfolio < scripts/db/03_agent_builder.sql
docker compose exec -T db psql -U postgres -d portfolio < scripts/db/04_user_api_settings.sql
```

Then restart the app (`docker compose up --build -d app`) and check its logs
with `docker compose logs app` if startup fails.

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
