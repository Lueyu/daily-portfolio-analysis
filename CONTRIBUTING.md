# Contributing to 吵股 Squabble

Help make personal investing tools easier to understand and safer to try.
Useful contributions include clearer onboarding, verified research data,
paper-trading rules, privacy controls, translations and bug fixes.
Start with the [local demo](docs/self-hosting.md), then use the
[development guide](docs/development.md) if you want to change the app.

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
| `Dockerfile`, `docker-compose.yml`, `deploy/`, `.github/` | Local demo, public deployment & CI |

The project was originally developed on the Miaoda (aPaaS) cloud; that
coupling has been fully removed, so there is no mirror/sync workflow anymore.

## Before you open a PR

```bash
npm ci               # install the versions in package-lock.json
npm run lint         # eslint + typecheck + stylelint
npm run test:server  # offline server tests
npm run test:client  # client behavior tests
```

These checks must pass for application changes. For documentation changes,
check local links, rendered Markdown and commands against the current scripts.
For Python agent changes also run:

```bash
cd agent
uv sync
uv run pytest -q     # offline test suite, no live network access
```

## Guidelines

- **Scope**: one PR per feature or fix. Small, focused PRs get reviewed faster.
- **Commits**: use [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat:`, `fix:`, `docs:`, `chore:` …) — the history follows this style.
- **Language**: code comments in English; update both Chinese and English UI
  strings. Keep `README.md` and `README.zh-CN.md` aligned when behavior changes.
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
- Paper trading guardrails and manual trade-review workflows
- Anything that makes the self-hosted experience smoother

Label-worthy beginner issues are marked `good first issue`.
