"""Read-only tool dispatch shared by the legacy and container harnesses."""

from collections.abc import Callable
from pathlib import Path

from .parser import (
    GlobStep,
    GrepStep,
    ListDirStep,
    ProbeEnvStep,
    ReadFileStep,
    ReadOnlyStep,
)
from .tools import ControlledTools


def dispatch_readonly(
    step: ReadOnlyStep, tools: ControlledTools, cwd: Path
) -> tuple[str, str, Callable[[], str]]:
    """Map a read-only step to (action label, target desc, result thunk)."""
    if isinstance(step, ReadFileStep):
        return ("read_file", step.path,
                lambda: tools.read_file_page(
                    step.path, start_line=step.start_line,
                    max_lines=step.max_lines, start_column=step.start_column,
                    cwd=cwd))
    if isinstance(step, ListDirStep):
        return ("list_dir", step.path,
                lambda: f"LIST {step.path}:\n"
                        + tools.list_dir(step.path, cwd=cwd))
    if isinstance(step, GlobStep):
        return ("glob", step.pattern,
                lambda: f"GLOB {step.pattern}:\n"
                        + tools.glob(step.pattern, step.path, cwd=cwd))
    if isinstance(step, GrepStep):
        return ("grep", step.pattern,
                lambda: f"GREP {step.pattern}:\n"
                        + tools.grep(step.pattern, step.path,
                                     step.glob_include, step.max_results,
                                     cwd=cwd))
    if isinstance(step, ProbeEnvStep):
        return ("probe_env", "env",
                lambda: "ENVIRONMENT:\n"
                        + tools.probe_env(step.targets, cwd=cwd))
    raise ValueError(f"unsupported read-only step: {type(step).__name__}")
