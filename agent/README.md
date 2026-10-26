# Python Agent

This package contains the current local Coding Agent, a shared model layer, a portfolio HTTP client, and the evaluated-evolution CLI. It does not connect directly to the business database.

## Current Coding Agent flow

```text
/dev React UI
  → server/modules/dev-agent (Nest process orchestration)
  → agent dev new / run
  → coder/cli.py::build_harness
  → coder/general_harness.py::GeneralHarness
  → coder/react_loop.py::ReactLoop
  → model request → validated tool call → real observation → next turn
  → current-revision target + regression evidence
  → user review → isolated revalidation → source landing
```

| Module | Responsibility |
| --- | --- |
| `coder/general_harness.py` | Current v2 source workspace, execution and completion rules |
| `coder/react_loop.py` | Model turns, tool validation and feedback |
| `coder/general_tools.py`, `extension_tools.py` | Tool schemas and registration |
| `coder/read_tools.py` | Shared read-only dispatch, independent of either harness |
| `coder/extensions.py` | Plans, memory, live messages, approvals and integration dispatch |
| `coder/runtime/` | Container terminals, preview services, browser and network policy |
| `coder/checkpoints/`, `general_landing.py` | Reversible source changes and reviewed landing |
| `coder/workers.py` | Isolated child agents, conflict checks and merge transactions |
| `coder/integrations/` | Operator-configured HTTP MCP and trusted project Skills |
| `coder/session_control.py`, `scratchpad.py` | Durable input/approvals and bounded conversation history |
| `models/` | Coding/vision profiles, provider requests, retries and usage |

New tasks explicitly select runtime v2. The files `coder/harness.py`, `sandbox.py`, `checks.py` and the legacy registry/probe paths still support existing v1 tasks. `cli.py` chooses the appropriate harness from saved task metadata. Do not delete that compatibility path without migrating the old tasks.

Use `agent dev capabilities --json` or the `/dev` settings dialog for the current tools and effective capabilities. Source changes stay in a task copy until reviewed. Each mutation has a checkpoint; edits invalidate old verification. The model requests completion, while the harness checks the actual source revision, test evidence, unread instructions and running workers.

## Setup and commands

Requires Python 3.11+ and uv. Run these commands from `agent/`:

```powershell
uv sync
# Populate .env from .env.example only if no local .env already exists.
uv run agent --help
uv run agent dev --help
uv run agent dev capabilities --json
```

The CLI reads this package's `.env` regardless of the invoking working directory. See [.env.example](.env.example) for coding/vision models, credentials, MCP, network policy and worker limits. The default coding tier is pro; coding fallback is disabled unless explicitly enabled.

For `/dev`, enable `AGENT_DEV_ENABLED=true` in the webapp's root `.env.local`, configure the Python environment and prepare the Docker image. Start the webapp from its root with `npm run dev:local`. See [the script index](../scripts/README.md).

The complete Coding Agent currently runs locally. Publishing the webapp does not deploy its Python/Docker execution environment. See [deployment boundaries and the remote-worker design](DEPLOYMENT.md) before deploying to Miaoda.

`agent dev new/run/approve/reject` manages tasks; `message/decide` provides live input and external-operation decisions. Use `changes` through the agent or the UI to review source history; CLI `undo/restore` requires explicit revision checks. `runtime-inspect/runtime-stop` inspects and cleans up owned runtime resources. Run `agent dev --help` for current command options.

## Data and validation

Runtime artifacts live in `agent/data/coder/tasks/<task-id>/`, outside the editable task source. Conversation history, verification evidence, approvals, workers and checkpoints persist there. A task-wide iteration or duration cap is not enabled by default.

```powershell
uv run python -m pytest -q
```

The default suite uses controlled model/runtime adapters. Docker integration cases are opt-in; model connectivity and real task evaluations are separate from unit checks. Local learning documents are indexed in `../docs/README.md` (intentionally not committed).

## Other package areas

- `runtime/webapp_client.py`: authenticated backend HTTP access for portfolio tools.
- `tools/`: market and portfolio client tools; CLI examples include `agent quote AAPL` and `agent holdings`.
- `evolution/`: evidence validation and proposal records. The E0 scope and limitations follow below.

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
