"""Offline CLI entry points. Never loads settings, credentials or network clients."""

from datetime import datetime, timezone
from pathlib import Path

import typer
from pydantic import ValidationError

from .contracts import ResearchCase
from .journal import DecisionJournal, decision_digest
from .temporal import assess_case

app = typer.Typer(help="Offline decision exports and learning-data checks (E0).")


def _case(path: Path) -> ResearchCase:
    try:
        # Bound local input before decoding; these are small decision exports.
        with path.open("rb") as stream:
            content = stream.read(16 * 1024 * 1024 + 1)
        if len(content) > 16 * 1024 * 1024:
            typer.echo("Invalid case: export exceeds 16 MiB.", err=True)
            raise typer.Exit(2)
        return ResearchCase.model_validate_json(content)
    except ValidationError as exc:
        # Pydantic's default string includes raw input values: don't echo them.
        typer.echo(f"Invalid case: {exc.error_count()} schema error(s).", err=True)
        raise typer.Exit(2) from None
    except OSError:
        typer.echo("Cannot read case file.", err=True)
        raise typer.Exit(2) from None


def _clock(value: str) -> datetime:
    try:
        result = datetime.fromisoformat(value)
        if result.tzinfo is None or result.utcoffset() is None:
            raise ValueError
        return result.astimezone(timezone.utc)
    except (ValueError, OverflowError):
        typer.echo("as-of must be an ISO timestamp with a timezone.", err=True)
        raise typer.Exit(2) from None


@app.command()
def validate(
    path: Path = typer.Argument(..., help="ResearchCase JSON file."),
    as_of: str = typer.Option(..., help="Explicit evaluation timestamp, including timezone."),
) -> None:
    """Print eligibility JSON; exit 1 for an ineligible decision, 2 for bad input.

    Pending outcomes do not invalidate the historical decision itself. Inspect
    eligible_outcome_ids before using any returns. This is not a release gate.
    """
    report = assess_case(_case(path), as_of=_clock(as_of))
    typer.echo(report.model_dump_json(indent=2))
    if not report.replay_eligible:
        raise typer.Exit(1)


@app.command()
def record(
    path: Path = typer.Argument(..., help="ResearchCase JSON file."),
    directory: Path = typer.Option(Path("data/evolution"), help="Local export directory."),
    as_of: str = typer.Option(..., help="Explicit evaluation timestamp, including timezone."),
) -> None:
    """Save a decision snapshot, including failed runs, without approving it.

    Only the decision is journaled. Outcomes remain in the supplied case export;
    they must not overwrite a historical decision as labels mature.
    """
    import json

    case = _case(path)
    report = assess_case(case, as_of=_clock(as_of))
    try:
        saved = DecisionJournal(directory).save(case.decision)
    except ValueError:
        typer.echo("Decision id conflict; existing record preserved.", err=True)
        raise typer.Exit(2) from None
    except OSError:
        typer.echo("Cannot publish local export; writable hard-link-capable storage is required.", err=True)
        raise typer.Exit(2) from None
    typer.echo(json.dumps({
        "path": str(saved.resolve()), "decision_digest": decision_digest(case.decision),
        "offline_only": True, "eligibility": report.model_dump(mode="json"),
    }, ensure_ascii=False, indent=2))
