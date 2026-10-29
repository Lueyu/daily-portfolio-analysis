# Development Guide

Thanks for hacking on 吵股 Squabble. For the contribution workflow (which
paths are mirrored, how PRs work) see [CONTRIBUTING.md](../CONTRIBUTING.md);
this page is about running and extending the codebase.

## Requirements

- Node.js >= 22, npm >= 10
- Python 3.12 + [uv](https://docs.astral.sh/uv/) for the agent service
- On Windows, shell-based scripts run through Git Bash

## Run modes

| Mode | How to start | Database | Best for |
|---|---|---|---|
| **Docker demo** | `docker compose up --build` | containerized PostgreSQL + demo seed | Full product in ~5 minutes, zero keys |
| Source: full stack | `npm run dev` | via `DATABASE_URL` (local PostgreSQL) | Everyday development |
| Source: backend only | `npm run dev:server` | same | API work |
| Source: client only | `npm run dev:client` | proxies `/api` to :3000 | UI work |

The historical platform launchers and the Miaoda sync script have been
removed — GitHub is the single source of truth since the de-platforming, and
the first-party auth system (username + password, JWT sessions) replaced the
platform gateway entirely.

## Lint, types, tests

```bash
npm run lint          # eslint + stylelint + full typecheck (also runs in CI)
npm run type:check    # typecheck only
```

Agent service:

```bash
cd agent
uv sync
uv run pytest -q      # offline suite, no live network access
```

CI (`.github/workflows/ci.yml`) runs the same three jobs on every push and PR:
lint & typecheck, agent tests, and a Docker image build.

## Python Agent (`agent/`)

A standalone, model-agnostic reasoning service. It talks to the webapp over
HTTP (`WEBAPP_BASE_URL` in `agent/.env`) and never connects to the business
database directly.

```bash
cd agent
cp .env.example .env          # fill in ARK_API_KEY / DEEPSEEK_API_KEY
uv run agent health           # check the webapp client
uv run agent quote AAPL       # fetch a real quote through the webapp
```

Structure: `agent/src/agent_core/` holds the runtime (ReAct loop, planning,
checkpoints), the model abstraction (Ark / DeepSeek / any OpenAI-compatible
endpoint) and the tool layer (market · web · finance · workflow).

## Design tokens & theming

All colors, fonts, radii and shadows live as CSS variables in
`client/src/tailwind-theme.css`. Pages consume semantic tokens
(`bg-background`, `text-muted-foreground`, …) — re-theming the app does not
require touching page components. Bull-green / bear-red are the brand's
market-semantic colors; keep them reserved for market up/down semantics.

## Database schema

`server/database/schema.ts` is generated from the database
(`npm run gen:db-schema`) — do not edit it by hand. The SQL sources of truth
for self-hosting live in `scripts/db/` and `drizzle/`.

## Notes on the de-platforming (completed)

The webapp was originally developed on the Miaoda (aPaaS) cloud and inherited
`@lark-apaas/*` packages for hosting, auth and database injection. That
coupling has been fully removed: GitHub is the single source of truth, auth is
the first-party username+password system in `server/modules/auth`, and the
database layer is a direct Drizzle connection (`server/common/platform`).
The old env vars (`SUDA_DATABASE_URL`, `LOCAL_DEV_USER_ID`, `DISABLE_CSRF`)
are gone; the current set is documented in
[self-hosting.md](self-hosting.md).
