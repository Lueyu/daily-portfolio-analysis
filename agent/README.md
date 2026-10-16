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

## License

MIT
