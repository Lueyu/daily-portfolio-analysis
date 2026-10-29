# Contributing to Daily Portfolio Analysis

Thanks for your interest in improving this project! A few minutes reading this
document will save both of us a round trip.

## Project layout — read this first

This repository is a **hybrid**: part of it is mirrored from the Miaoda (aPaaS)
cloud where the webapp is primarily developed, and part of it is native to
GitHub. Where your change lives determines how it should be contributed:

| Path | Owned by | How to change it |
|---|---|---|
| `client/`, `server/`, `shared/`, root config files | **Mirrored** from the Miaoda cloud (`scripts/sync-from-miaoda.ps1` overwrites them) | Open an issue describing the change; direct PRs here will be overwritten by the next sync |
| `agent/`, `docs/`, `README*`, `Dockerfile`, `docker-compose.yml`, `scripts/db/`, `.github/` | **GitHub-native** | PRs welcome |
| `scripts/*.js` (postinstall, patches, dev tooling) | GitHub-native (re-applied after each sync) | PRs welcome |

If you want to change business logic in `client/` or `server/`, open an issue
with a clear description — the change will be applied on the cloud side and
flow back through the sync. Everything else can go through a normal PR.

## Before you open a PR

```bash
npm install          # postinstall/prepare are safe on any OS; no platform CLI needed
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
- **For demo/seed data** (`scripts/db/04_demo_seed.sql`): keep it fictional,
  plausible and clearly marked as demo data; it must never contain real
  holdings.

## Reporting bugs

Open an issue with the **Bug report** template. The Docker demo
(`docker compose up --build`) is the fastest way to reproduce — mention
whether the bug also happens there.

## Feature requests

Ideas are welcome, especially around:

- New analysis pipeline stages or report sections
- Strategy rule types enforced by the risk gate
- LLM provider support in `agent/`
- Anything that makes the self-hosted experience smoother

Label-worthy beginner issues are marked `good first issue`.
