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
from .evolution.cli import app as evolution_app
from .logging_conf import setup_logging
from .models import ChatRequest, ChatService, ModelTask
from .models.openai_compatible import build_provider
from .runtime.webapp_client import WebappClient

app = typer.Typer(help="Stock Agent CLI")
app.add_typer(evolution_app, name="evolution")
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
    )

    service = ChatService(s)
    if tier:
        # Forced tier: bypass routing/fallback and hit exactly that tier.
        chosen = tier.strip().lower()
        if chosen not in ("flash", "pro"):
            console.print("[red]--tier must be flash or pro[/red]")
            raise typer.Exit(code=2)
        try:
            resp = service.provider_for(chosen).chat(request)
        except Exception as exc:
            console.print(f"[red]chat failed ({chosen}):[/red] {type(exc).__name__}: {exc}")
            raise typer.Exit(code=1)
    else:
        try:
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

    cost = (
        f"${resp.usage.cost_usd:.6f}"
        if resp.usage.cost_usd > 0
        else "price unset"
    )
    table = Table(show_header=True, header_style="bold cyan")
    table.add_column("tier")
    table.add_column("model")
    table.add_column("tokens")
    table.add_column("cost")
    table.add_column("attempts")
    table.add_column("latency")
    table.add_row(
        resp.tier,
        resp.model,
        f"{resp.usage.prompt_tokens}+{resp.usage.completion_tokens}"
        f"={resp.usage.total_tokens}",
        cost,
        str(resp.attempts),
        f"{resp.latency_ms}ms",
    )
    console.print(table)


if __name__ == "__main__":
    app()
