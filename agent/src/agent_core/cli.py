"""Stock Agent CLI.

Day 1: init
Day 2: health, quote (public webapp endpoint)
Day 3: holdings (gateway auth), modelping (OpenAI-compatible providers)
"""

import typer
from rich.console import Console

from .config import ensure_dirs, get_settings
from .logging_conf import setup_logging
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
    console.print(f"ark key configured = {bool(s.ark_api_key)}")
    console.print(f"deepseek key configured = {bool(s.deepseek_api_key)}")
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


if __name__ == "__main__":
    app()
