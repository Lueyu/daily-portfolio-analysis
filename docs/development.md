# Development Guide

This guide is for changing Squabble's code. To use the product, start with
the [Docker demo](self-hosting.md) or [server deployment](public-deployment.md).
For pull requests, see [CONTRIBUTING.md](../CONTRIBUTING.md).

## Requirements

- Node.js >= 22, npm >= 10
- PostgreSQL 16 and its `psql` client for source development
- Python 3.12 + [uv](https://docs.astral.sh/uv/) only if developing the optional
  Python agent; the web application's analysis does not require it
- The npm scripts use `cross-env` for Windows-compatible environment settings.
  The development supervisor's port cleanup uses Unix utilities; on Windows,
  stop any conflicting processes yourself before starting it.

## Run modes

| Mode | How to start | Database | Best for |
|---|---|---|---|
| **Docker demo** | `docker compose up -d --build` | containerized PostgreSQL + demo seed | Explore without a model key; first build time varies |
| Source: full stack | `npm run dev` | via `DATABASE_URL` (local PostgreSQL) | Everyday development |
| Source: backend only | `npm run dev:server` | same | API work |
| Source: client only | `npm run dev:client` | proxies `/api` to :3000 | UI work |

The app uses its own username/password authentication and JWT sessions.
GitHub is the source of truth; no Miaoda account is needed to run it.

## Start from source

1. Clone the repository and run `npm ci` in its root.
2. Create a new PostgreSQL database for this project. Initialize its **empty**
   schema with `psql -d YOUR_CONNECTION_URL -v ON_ERROR_STOP=1 -f scripts/db/01_schema.sql`.
   Do not run the base schema against an existing populated installation.
   The optional `02_demo_seed.sql` adds fictional demo records; leave it out
   for an empty account experience.
3. Create a private `.env` in the repository root. It is ignored by Git:

   ```dotenv
   DATABASE_URL=postgresql://YOUR_USER:YOUR_PASSWORD@127.0.0.1:5432/portfolio
   JWT_SECRET=YOUR_RANDOM_SECRET_AT_LEAST_32_CHARACTERS
   SETTINGS_ENCRYPTION_KEY=ANOTHER_RANDOM_SECRET_AT_LEAST_32_CHARACTERS
   REGISTER_ENABLED=true
   SERVER_HOST=127.0.0.1
   SERVER_PORT=3000
   ```

   Replace every placeholder. To generate each secret independently, run
   `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
   Avoid committing credentials or pasting them into an issue.
4. Run `npm run dev`. It loads `.env` and starts Nest and Vite. Open
   **http://localhost:8080** for the frontend; the API is on port **3000**.
   Vite proxies `/api` to `127.0.0.1:3000`. Register an account and save its
   recovery code, or use the demo login if you applied the optional seed.

Use available ports: the development supervisor attempts to stop processes on
its configured ports. Do not run it over an existing Docker app on port 3000.
Logs are under `logs/`; inspect them if startup fails. The individual
`dev:server` and `dev:client` commands do not use that supervisor; provide the
required environment variables in their shell when running them separately.

The supervisor still attempts a legacy `fullstack-cli action-plugin init`
step. If that CLI is absent, its initialization warning is non-blocking;
the backend and frontend continue starting.

The app applies additive migrations `03` through `06` on startup. They do not
create the base schema. The root demo Compose database has no published host
port, so it is not reachable at `localhost:5432` without an explicit local
port mapping.

## Lint, types, tests

```bash
npm run lint          # eslint + stylelint + full typecheck (also runs in CI)
npm run test:server   # offline Nest service and Agent Builder rule tests
npm run test:client   # appearance store, cross-tab sync and startup preferences
npm run type:check    # typecheck only
```

Agent service:

```bash
cd agent
uv sync
uv run pytest -q      # offline suite, no live network access
```

CI (`.github/workflows/ci.yml`) runs on pushes to `main` and pull requests
targeting `main`: webapp lint, typecheck and server/client tests; Python agent
tests; and a Docker image build.

## Python Agent (`agent/`)

An optional CLI scaffold for experimenting with external agents. It talks to
the webapp over HTTP (`WEBAPP_BASE_URL` in `agent/.env`) rather than connecting
to the database. It is separate from the built-in NestJS analysis pipeline.
Its legacy gateway must be explicitly enabled and configured by the operator;
it is disabled in both shipped deployment paths.

```bash
cd agent
cp .env.example .env          # fill in ARK_API_KEY / DEEPSEEK_API_KEY
uv run agent health           # check the webapp client
uv run agent quote AAPL       # fetch a real quote through the webapp
```

`agent/src/agent_core/` currently supplies CLI commands, an HTTP client, a
model adapter and JSONL checkpoints. A complete ReAct/planning runtime and
tool orchestration are not implemented there. See [architecture](architecture.md)
for the implemented webapp and MCP integration paths.

## Design tokens & theming

Base colors, fonts, radii and shadows live in `client/src/tailwind-theme.css`;
`client/src/themes.css` supplies the four visual styles and their dark variants.
Pages consume semantic tokens (`bg-background`, `text-muted-foreground`, …).
Use `useTheme` for shared preferences and `useChartTheme` for canvas colors.
Card defaults live in the components layer so explicit border, shadow and ring
utilities can still communicate selection, errors and drag targets. Financial
profit/loss colors stay green/red independently of decorative brand accents.
See the [appearance guide](appearance.md) for storage keys, components and
the complete visual verification checklist.

## Database schema

Keep the Drizzle definitions in `server/database/schema.ts` and fresh-install
SQL in `scripts/db/01_schema.sql` consistent. Existing installations also
need an additive migration under `scripts/db/`, registered in
`server/common/platform/database.provider.ts` and copied by the Dockerfile.
The repository has no `gen:db-schema` npm script. Test both fresh installs and
upgrades when changing the schema, preserving existing user data.

## Platform migration notes

The webapp was originally developed on the Miaoda (aPaaS) cloud and inherited
`@lark-apaas/*` packages for hosting, auth and database injection. That
runtime dependencies have been replaced: auth is the first-party
username+password system in `server/modules/auth`, and the database layer is
a direct Drizzle connection (`server/common/platform`). The development
supervisor still contains the optional legacy initialization step noted above.
The old env vars (`SUDA_DATABASE_URL`, `LOCAL_DEV_USER_ID`, `DISABLE_CSRF`)
are gone; the current set is documented in
[self-hosting.md](self-hosting.md).
