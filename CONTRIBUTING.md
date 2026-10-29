# Contributing to 吵股 Squabble

Thanks for your interest in improving this project! A few minutes reading this
document will save both of us a round trip.

## Project layout

GitHub is the single source of truth — every path accepts normal pull
requests:

| Path | What lives there |
|---|---|
| `client/` | React SPA (pages, components, hooks, api wrappers) |
| `server/` | NestJS backend (modules, first-party auth, platform layer in `server/common/platform/`) |
| `shared/` | Types shared by front-end and backend |
| `agent/` | Standalone Python agent service |
| `docs/`, `README*` | Documentation |
| `scripts/db/` | Schema + demo seed used by docker compose |
| `Dockerfile`, `docker-compose.yml`, `.github/` | Deployment & CI |

The project was originally developed on the Miaoda (aPaaS) cloud; that
coupling has been fully removed, so there is no mirror/sync workflow anymore.

## Before you open a PR

```bash
npm install          # lifecycle scripts are safe on any OS; no platform CLI needed
npm run lint         # eslint + typecheck + stylelint
```

Both must pass. For Python agent changes also run:

```bash
cd agent
uv sync
uv run pytest -q     # offline test suite, no live network access
```

## Guidelines

- **Scope**: one PR per feature or fix. Small, focused PRs get reviewed faster.
- **Commits**: use [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat:`, `fix:`, `docs:`, `chore:` …) — the history follows this style.
- **Language**: code comments in English; the UI strings are Simplified Chinese.
- **No secrets**: never commit API keys or `db/snapshot/*.sql` (personal data).
- **For demo/seed data** (`scripts/db/02_demo_seed.sql`): keep it fictional,
  plausible and clearly marked as demo data; it must never contain real
  holdings.
- **Database changes**: `server/database/schema.ts` and
  `scripts/db/01_schema.sql` must stay in sync (the SQL file is applied on
  fresh installs; note schema changes in your PR description for existing
  deployments).

## Reporting bugs

Open an issue with the **Bug report** template. The Docker demo
(`docker compose up --build`, login demo/demo1234) is the fastest way to
reproduce — mention whether the bug also happens there.

## Feature requests

Ideas are welcome, especially around:

- New analysis pipeline stages or report sections
- Strategy rule types enforced by the risk gate
- LLM provider support in `agent/`
- Paper trading guardrails and broker adapters
- Anything that makes the self-hosted experience smoother

Label-worthy beginner issues are marked `good first issue`.
