"""Schemas for the container agent. Permission enforcement lives in its runtime."""
from dataclasses import replace
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from .models import Text
from .parser import build_default_registry
from .registry import GateKind, ToolKind, ToolRegistry, ToolSpec


class Step(BaseModel):
    model_config = ConfigDict(extra="forbid")


class WriteFile(Step):
    path: Text
    content: str
    reason: Text


class EditFile(Step):
    path: Text
    old_text: str = Field(min_length=1)
    new_text: str
    reason: Text


class TerminalStart(Step):
    command: Text
    reason: Text
    cwd: str = "."
    timeout_seconds: int = Field(default=120, ge=1, le=3600)


class TerminalPoll(Step):
    session_id: Text
    cursor: int = Field(default=0, ge=0)
    wait_ms: int = Field(default=10000, ge=0, le=10000)


class TerminalWrite(Step):
    session_id: Text
    data: str


class TerminalCancel(Step):
    session_id: Text


class ServiceStart(Step):
    command: Text
    port: int = Field(default=8080, ge=1024, le=65535)
    cwd: str = "."


class ServiceStop(Step):
    service_id: Text


class ServicePoll(ServiceStop):
    cursor: int = Field(default=0, ge=0)


class Browser(Step):
    action: Literal["navigate", "snapshot", "click", "fill", "press", "select",
                    "scroll", "screenshot", "styles", "errors", "wait_for", "close"]
    url: str | None = None
    ref: str | None = None
    text: str | None = None
    value: str | None = None
    key: str | None = None
    x: int = 0
    y: int = 600
    fullPage: bool = False
    properties: list[str] = Field(default_factory=list)
    maxElements: int = Field(default=200, ge=1, le=1000)
    clear: bool = False
    state: Literal['visible', 'hidden'] = 'visible'
    timeout_ms: int = Field(default=10000, ge=1, le=30000)


class Verify(Step):
    command: Text
    criterion_ids: list[str] = Field(default_factory=list)
    scope: Literal["target", "regression"]
    cwd: str = "."
    timeout_seconds: int = Field(default=300, ge=1, le=3600)


class Changes(Step):
    pass


class UndoChange(Step):
    change_id: Text
    expected_revision: Text


class RestoreCheckpoint(Step):
    revision: Text
    expected_revision: Text


def build_general_registry() -> ToolRegistry:
    reg = ToolRegistry()
    legacy = build_default_registry()
    for name in legacy.names():
        spec = legacy.get(name)
        if name in {"probe_env", "run_check"}:
            continue  # host probes and fixed host runners are not container tools
        if name == "apply_patch":
            spec = replace(spec, gate=GateKind.ALWAYS, description=(
                "Apply a unified diff in the task workspace; checkpoint it and retain changes."))
        if name == 'finish':
            spec = replace(spec, gate=GateKind.ALWAYS, description=(
                'Request completion. The executor checks current-revision target and regression evidence '
                'plus current task-preview browser evidence for E2E criteria and reports what is missing; '
                'no particular editing tool is required.'))
        reg.register(spec)
    specs = [
        ("write_file", ToolKind.PATCH, WriteFile, "Write a UTF-8 file in the task workspace, with a reversible checkpoint."),
        ("edit_file", ToolKind.PATCH, EditFile, "Replace exactly one occurrence of old_text; checkpoints the edit."),
        ("terminal_start", ToolKind.PATCH, TerminalStart, "Run a shell command inside the container. Poll the returned session until done before editing again. Network access follows capabilities and operator policy; HTTP(S) uses the configured allowed hosts. Use services for long-running preview."),
        ("terminal_poll", ToolKind.EXECUTE, TerminalPoll, "Read incremental output and completion. Cursor comes from the preceding result."),
        ("terminal_write", ToolKind.EXECUTE, TerminalWrite, "Send input to an active owned terminal session."),
        ("terminal_cancel", ToolKind.EXECUTE, TerminalCancel, "Cancel a terminal and its descendants; partial changes remain recoverable."),
        ("service_start", ToolKind.EXECUTE, ServiceStart, "Start a preview server with read-only source. Bind 0.0.0.0 on port. Use returned URL in browser."),
        ("service_stop", ToolKind.EXECUTE, ServiceStop, "Stop an owned preview service."),
        ("service_poll", ToolKind.EXECUTE, ServicePoll, "Read preview status and incremental startup/server logs."),
        ("browser", ToolKind.EXECUTE, Browser, "Interact with the task browser: navigate a returned task-preview URL or allowed external URL; snapshot before actions; wait_for exact text visible/hidden to await async data. After fixing the user flow collect snapshot, screenshot, errors (including HTTP failures). E2E requires these on the current task preview plus actual verify assertions; external docs do not count."),
        ("verify", ToolKind.PATCH, Verify, "Run an actual test/assertion command in the container, linked to acceptance IDs or regression scope. Poll until complete. A source change invalidates old verification."),
        ("changes", ToolKind.READ_ONLY, Changes, "List source changes and the current revision for undo/restore."),
        ("undo_change", ToolKind.PATCH, UndoChange, "Undo one independent change without overwriting subsequent edits; conflicts leave files unchanged."),
        ("restore_checkpoint", ToolKind.PATCH, RestoreCheckpoint, "Restore an entire source snapshot, also undoing subsequent source effects; history is preserved."),
    ]
    for name, kind, schema, description in specs:
        reg.register(ToolSpec(name, kind, schema, GateKind.ALWAYS, description=description))
    from .extension_tools import register_extensions
    register_extensions(reg)
    return reg
