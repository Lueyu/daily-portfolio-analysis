# Stock Agent

A model-agnostic AI agent service for equity research, used by the Daily Portfolio Analysis terminal. It runs the reasoning side of the workflow — market queries, research, and later portfolio analysis — while the trading webapp ([../](../)) remains the system of record.

The agent does **not** connect to PostgreSQL. It reads and writes business data only through the webapp's HTTP API, authenticated with an `x-agent-token`; the backend injects the user context and enforces ownership. Keeping the agent outside the database boundary means models, prompts and reasoning logic can be changed — or the agent run on its own — without touching accounts or data.

## Capabilities

- A Typer CLI: `agent init`, `agent health`, `agent quote`
- A resilient HTTP client to the webapp (`httpx` + `tenacity`), with a mocked transport in tests
- A model/provider abstraction (Volcengine Ark / DeepSeek / any OpenAI-compatible endpoint)
- The runtime, tools and model layers, with structured logging and JSONL checkpoints

## Quick start

Requires Python 3.11+ and [uv](https://docs.astral.sh/uv/) (developed on 3.12).

```bash
uv sync                       # create .venv and install dependencies
cp .env.example .env          # fill in API keys and webapp settings
uv run agent health           # check the webapp client
uv run agent quote AAPL       # fetch a real quote through the webapp
uv run pytest -q              # run the offline test suite (no real network)
```

## Layout

```
agent/
├── src/agent_core/
│   ├── cli.py                # Typer CLI: init / health / quote
│   ├── config.py             # pydantic-settings, loaded from .env
│   ├── logging_conf.py       # structured logging
│   ├── models/               # model/provider abstraction
│   ├── runtime/
│   │   └── webapp_client.py  # HTTP client to the NestJS webapp
│   └── tools/                # tool layer (market, web, finance, workflow)
├── tests/test_smoke.py       # pytest + pytest-httpx, fully offline
├── data/checkpoints/         # JSONL run/event logs (runtime, kept empty in git)
├── .env.example              # environment template (committed)
└── pyproject.toml
```

## Design principles

- **Model-agnostic** — every provider sits behind one interface; switch Ark / DeepSeek / any OpenAI-compatible endpoint via `.env`, without changing agent code.
- **Explicit control flow** — the agent loop (tool selection, observation, termination) is implemented directly in this repository rather than hidden inside a heavyweight framework, so the control flow stays easy to debug and reason about.
- **Database isolation** — the agent reads and writes business data only through the webapp's HTTP API with an `x-agent-token`; the server injects the user context and enforces ownership.
- **Deterministic tests** — external HTTP is mocked, so the test suite runs fully offline and is CI-safe.

## Configuration

Set values in `agent/.env` (copied from `.env.example`; secrets are git-ignored):

| Variable | Purpose |
|---|---|
| `ARK_API_KEY` | Volcengine Ark API key |
| `DEEPSEEK_API_KEY` | DeepSeek API key |
| `ARK_MODEL` | model id used for the Ark provider |
| `WEBAPP_BASE_URL` | base URL of the NestJS webapp, e.g. `http://127.0.0.1:3000` |
| `WEBAPP_AGENT_TOKEN` | shared secret sent as the `x-agent-token` header |
| `WEBAPP_DEFAULT_USER_ID` | user id used in local development |

## Evaluated evolution foundation (E0)

The `evolution` CLI and `agent_core.evolution` library capture immutable decision
exports and check whether their **supplied metadata** is suitable for historical
replay. This is the data foundation for later feedback-driven improvement; it
does not generate new rules, train a model or change the active portfolio policy.

```powershell
# Fully offline. The fictional example is deliberately rejected with exit code 1.
uv run agent evolution validate examples/evolution_case.json --as-of 2026-10-17T00:00:00Z

# Preserve even rejected decisions for audit; records only the decision, not outcomes.
uv run agent evolution record examples/evolution_case.json --as-of 2026-10-17T00:00:00Z
```

`validate` prints JSON: `replay_eligible`, `eligible_outcome_ids`, and issue codes.
Exit 0 means the decision passes the metadata checks; it **does not** mean there
are mature outcomes, a profitable strategy, or authorization to publish. Exit 1
means the decision is ineligible; exit 2 means invalid input or a storage error.
Pending/unavailable labels never become zero-return observations.

`record` saves one file per decision UUID in `data/evolution/` (git-ignored), or an
explicit `--directory`. Identical writes are idempotent; conflicting content is
rejected. Same-day runs retain separate IDs. Publication uses same-filesystem hard
links to avoid partial reads and overwrites; unsupported filesystems fail rather
than falling back to unsafe overwrite. A crash can leave an unused temporary file.
This local export is not a multi-user database, signed audit log or Webapp backup.
It contains research inputs and should stay private. PostgreSQL remains the
business system of record; the Python agent does not connect to it directly.

The frozen contract includes the model/config and rule/prompt/memory versions,
actual evidence text and source times, original/final ratings, required rule IDs,
executed rules separately from model citations, and predeclared forecast targets
(horizon, benchmark, currency, price basis and cost model). Retrieved memories
require owner, approval time and validity. An outcome must match its original
forecast target and be observable at the explicitly supplied evaluation time.
Supply only one as-of outcome revision per label/horizon; revision history and
automatic market-calendar labeling will be implemented in the backend later.

The checker cannot authenticate a caller's `quality=real` declaration or timestamps,
verify returns against a vendor, reconstruct a model's training cutoff, prove rule
coverage without a trustworthy required-rule manifest, or assess causal alpha.
The example remains marked `synthetic`; never relabel fixtures as real data.
Production adapters must generate these records from captured tool executions.
Automatic capture into a future ReAct loop, feedback collection, candidate memory/
rubric generation, independent evaluation, approval, rollback and scheduling are
subsequent milestones, not implemented by these commands.

Local project research and phased design live under the intentionally untracked
`../docs/research/` and `../docs/superpowers/specs/` directories. Run the offline
checks with `uv run pytest -q`; no new packages or paid APIs are required.

## License

MIT
