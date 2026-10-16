"""Stock Agent CLI.

Day 1: init
Day 2: health, quote (public webapp endpoint)
Day 3: holdings (authenticated agent gateway), modelping (OpenAI-compatible LLM)
"""

import typer
from rich.console import Console
from rich.table import Table

from .config import ensure_dirs, get_settings
from .logging_conf import setup_logging
from .models.openai_compatible import build_provider
from .runtime.webapp_client import WebappClient

app = typer.Typer(help="Stock Agent CLI")
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


if __name__ == "__main__":
    app()
