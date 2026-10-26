"""Stock Agent CLI.

Day 1: init
Day 2: health, quote (public webapp endpoint)
Day 3: holdings (authenticated agent gateway), modelping (OpenAI-compatible LLM)
M1:     chat (routed call with retries, fallback, usage and cost)
"""

import typer
from rich.console import Console
from rich.table import Table

from .config import ensure_dirs, get_settings
from .coder.cli import app as coder_app
from .evolution.cli import app as evolution_app
from .logging_conf import setup_logging
from .models import ChatChunk, ChatRequest, ChatService, ModelTask
from .models.openai_compatible import build_provider
from .runtime.webapp_client import WebappClient

app = typer.Typer(help="Stock Agent CLI")
app.add_typer(evolution_app, name="evolution")
app.add_typer(coder_app, name="dev")
console = Console()


@app.callback()
def _main() -> None:
    """Root command group (keeps subcommands explicit even with one command)."""


@app.command()
def init() -> None:
    """Initialize config and dirs, print resolved settings (keys masked)."""
    s = get_settings()
    setup_logging(s.log_level)
    ensure_dirs(s)
    console.print("[green]stock-agent initialized[/green]")
    console.print(f"webapp = {s.webapp_base_url}")
    console.print(f"default tier = {s.default_tier}")
    console.print(f"flash key configured = {bool(s.flash_api_key)} ({s.flash_model})")
    console.print(f"pro key configured   = {bool(s.pro_api_key)} ({s.pro_model})")
    console.print(f"checkpoint dir = {s.checkpoint_dir}")


@app.command()
def health() -> None:
    """Probe webapp reachability via the public quote endpoint."""
    s = get_settings()
    setup_logging(s.log_level)
    try:
        with WebappClient(s.webapp_base_url) as client:
            quote = client.get_quote("AAPL")
    except Exception as exc:  # network / HTTP error -> non-zero exit for scripts
        console.print(f"[red]webapp unreachable:[/red] {type(exc).__name__}: {exc}")
        raise typer.Exit(code=1)
    if not quote:
        console.print("[yellow]webapp reachable, but no quote returned for AAPL[/yellow]")
        raise typer.Exit(code=1)
    console.print(
        f"[green]webapp OK[/green]  AAPL {quote.get('price')} "
        f"({quote.get('changePercent')}%)  {quote.get('currency')}"
    )


@app.command()
def quote(
    symbol: str = typer.Argument("AAPL", help="Ticker, e.g. AAPL / 0700.HK / 600519"),
) -> None:
    """Fetch a live quote via the public webapp endpoint."""
    s = get_settings()
    setup_logging(s.log_level)
    try:
        with WebappClient(s.webapp_base_url) as client:
            data = client.get_quote(symbol)
    except Exception as exc:
        console.print(f"[red]request failed:[/red] {type(exc).__name__}: {exc}")
        raise typer.Exit(code=1)
    if not data:
        console.print(f"[yellow]no quote returned for {symbol}[/yellow]")
        raise typer.Exit(code=1)
    console.print_json(data=data)


@app.command()
def holdings() -> None:
    """List the authenticated owner's holdings via the agent gateway."""
    s = get_settings()
    setup_logging(s.log_level)
    if not s.webapp_agent_token:
        console.print(
            "[red]no WEBAPP_AGENT_TOKEN configured[/red] "
            "(the gateway requires x-agent-token)"
        )
        raise typer.Exit(code=1)
    try:
        with WebappClient(
            s.webapp_base_url,
            token=s.webapp_agent_token,
            user_id=s.webapp_default_user_id or None,
        ) as client:
            rows = client.get_holdings()
    except Exception as exc:
        console.print(f"[red]gateway request failed:[/red] {type(exc).__name__}: {exc}")
        raise typer.Exit(code=1)

    acting = s.webapp_default_user_id or "gateway default"
    console.print(f"[green]gateway OK[/green]  {len(rows)} holding(s) for "
                  f"{acting}")
    if not rows:
        return
    table = Table(show_header=True, header_style="bold cyan")
    table.add_column("Ticker")
    table.add_column("Company")
    table.add_column("Shares", justify="right")
    table.add_column("Price", justify="right")
    table.add_column("Rating")
    table.add_column("Action")
    for h in rows:
        table.add_row(
            str(h.get("ticker") or ""),
            str(h.get("company") or ""),
            str(h.get("shares") or ""),
            str(h.get("currentPrice") or ""),
            str(h.get("rating") or "-"),
            str(h.get("action") or "-"),
        )
    console.print(table)


@app.command()
def modelping(
    tier: str = typer.Argument(
        None, help="Model tier: flash | pro (defaults to DEFAULT_TIER)"
    ),
) -> None:
    """Send one minimal chat request to verify a model tier on Ark."""
    s = get_settings()
    setup_logging(s.log_level)
    chosen = tier or s.default_tier
    try:
        result = build_provider(s, chosen).ping()
    except Exception as exc:
        console.print(f"[red]model ping failed ({chosen}):[/red] {type(exc).__name__}: {exc}")
        raise typer.Exit(code=1)
    console.print(
        f"[green]model OK[/green]  tier={result.tier}  model={result.model}  "
        f"{result.latency_ms}ms  tokens={result.prompt_tokens}+{result.completion_tokens}"
    )
    if result.reply:
        console.print(f"reply: {result.reply}")
    elif result.reasoning:
        console.print(
            f"[yellow]no visible content (reasoning model); reasoning tail:[/yellow] "
            f"{result.reasoning[-120:]}"
        )


def _print_summary(
    console: Console,
    *,
    tier: str,
    model: str,
    usage,
    latency_ms: int,
    attempts: str,
) -> None:
    """Render the post-response usage/cost table (shared by stream/non-stream)."""
    cost = f"${usage.cost_usd:.6f}" if usage.cost_usd > 0 else "price unset"
    table = Table(show_header=True, header_style="bold cyan")
    table.add_column("tier")
    table.add_column("model")
    table.add_column("tokens")
    table.add_column("cost")
    table.add_column("attempts")
    table.add_column("latency")
    table.add_row(
        tier,
        model,
        f"{usage.prompt_tokens}+{usage.completion_tokens}={usage.total_tokens}",
        cost,
        attempts,
        f"{latency_ms}ms",
    )
    console.print(table)


@app.command()
def chat(
    prompt: str = typer.Argument(..., help="The prompt to send to the model"),
    task: str = typer.Option(
        None,
        "--task",
        help="Routing task: rating|plan|critic|debate|summarize|extract|translate",
    ),
    tier: str = typer.Option(
        None, "--tier", help="Force a tier: flash|pro (overrides --task)"
    ),
    json_mode: bool = typer.Option(False, "--json", help="Request JSON output"),
    stream: bool = typer.Option(
        False, "--stream", help="Stream tokens as they are produced (SSE)"
    ),
    show_reasoning: bool = typer.Option(
        False, "--reasoning", help="Also print the hidden reasoning chain if present"
    ),
) -> None:
    """Send a real chat prompt through the routed model layer (M1)."""
    s = get_settings()
    setup_logging(s.log_level)

    model_task = None
    if task:
        try:
            model_task = ModelTask(task.strip().lower())
        except ValueError:
            valid = ", ".join(t.value for t in ModelTask)
            console.print(f"[red]unknown task '{task}'[/red] (one of: {valid})")
            raise typer.Exit(code=2)

    request = ChatRequest(
        messages=[{"role": "user", "content": prompt}],
        task=model_task,
        json_mode=json_mode,
        stream=stream,
    )

    service = ChatService(s)
    forced_tier = None
    if tier:
        # Forced tier: bypass routing/fallback and hit exactly that tier.
        forced_tier = tier.strip().lower()
        if forced_tier not in ("flash", "pro"):
            console.print("[red]--tier must be flash or pro[/red]")
            raise typer.Exit(code=2)

    if stream:
        _run_stream(service, request, forced_tier, show_reasoning)
        return

    # Non-streaming path.
    try:
        if forced_tier:
            resp = service.provider_for(forced_tier).chat(request)
        else:
            resp = service.chat(request)
    except Exception as exc:
        console.print(f"[red]chat failed:[/red] {type(exc).__name__}: {exc}")
        raise typer.Exit(code=1)

    if resp.degraded:
        console.print(
            f"[yellow]⚠ degraded {resp.requested_tier} → {resp.tier}:[/yellow] "
            f"{resp.degrade_reason}"
        )
    console.print(resp.content)
    if show_reasoning and resp.reasoning:
        console.print(f"[dim]reasoning: {resp.reasoning[-500:]}[/dim]")

    _print_summary(
        console,
        tier=resp.tier,
        model=resp.model,
        usage=resp.usage,
        latency_ms=resp.latency_ms,
        attempts=str(resp.attempts),
    )


def _run_stream(service: ChatService, request: ChatRequest, forced_tier, show_reasoning: bool) -> None:
    """Consume an SSE stream, print tokens live, then render the summary."""
    if forced_tier:
        gen = service.provider_for(forced_tier).stream_chat(request)
    else:
        gen = service.stream_chat(request)

    final: ChatChunk | None = None
    reasoning_started = False
    answer_started = False
    try:
        for chunk in gen:
            if chunk.degraded:
                console.print(
                    f"[yellow]⚠ degraded {chunk.requested_tier} → {chunk.tier}:[/yellow] "
                    f"{chunk.degrade_reason}"
                )
            if chunk.delta_reasoning and show_reasoning:
                console.print(
                    chunk.delta_reasoning,
                    style="dim",
                    end="",
                    markup=False,
                    highlight=False,
                )
                reasoning_started = True
            if chunk.delta_content:
                if reasoning_started and not answer_started:
                    console.print()  # visually separate reasoning from answer
                console.print(
                    chunk.delta_content, end="", markup=False, highlight=False
                )
                answer_started = True
            if chunk.is_final():
                final = chunk
    except Exception as exc:
        console.print(f"\n[red]stream failed:[/red] {type(exc).__name__}: {exc}")
        raise typer.Exit(code=1)

    if answer_started or reasoning_started:
        console.print()
    if final is None:
        console.print("[red]stream ended without usage[/red]")
        raise typer.Exit(code=1)

    _print_summary(
        console,
        tier=final.tier,
        model=final.model,
        usage=final.usage,
        latency_ms=final.latency_ms,
        attempts="stream",
    )


if __name__ == "__main__":
    app()
