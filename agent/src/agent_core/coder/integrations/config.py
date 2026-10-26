"""MCP configuration is supplied by the operator, never by a model tool call."""

from __future__ import annotations

import json
import re
from pathlib import Path
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ServerConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    url: str
    headersEnv: dict[str, str] = Field(default_factory=dict)
    allowedTools: list[str] | None = None
    readOnlyTools: list[str] = Field(default_factory=list)
    timeoutSeconds: float = Field(default=30.0, ge=1, le=120)
    maxResultChars: int = Field(default=24000, ge=1000, le=100000)

    @field_validator("url")
    @classmethod
    def validate_url(cls, value: str) -> str:
        url = urlsplit(value)
        if url.scheme not in ("https", "http") or not url.hostname:
            raise ValueError("MCP endpoints require an explicit HTTP(S) URL; stdio is not supported")
        if url.username or url.password or url.query or url.fragment:
            raise ValueError("MCP URL credentials/query/fragment are forbidden; use headersEnv")
        return value

    @field_validator("headersEnv")
    @classmethod
    def validate_headers(cls, values: dict[str, str]) -> dict[str, str]:
        for header, variable in values.items():
            if (not re.fullmatch(r"[A-Za-z0-9-]{1,80}", header)
                    or header.lower() in {"host", "content-length", "content-type", "accept"}
                    or header.lower().startswith("mcp-")):
                raise ValueError("MCP authentication header name is invalid or reserved")
            if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,127}", variable):
                raise ValueError("headersEnv values must be environment variable names")
        return values


def load_servers(path: str | None, forbidden_roots: list[Path]) -> dict[str, ServerConfig]:
    if not path:
        return {}
    source = Path(path).expanduser().resolve()
    if any(source.is_relative_to(Path(root).resolve()) for root in forbidden_roots):
        raise ValueError("MCP configuration cannot be inside an editable task workspace")
    if source.stat().st_size > 262144:
        raise ValueError("MCP configuration exceeds 256 KB")
    raw = json.loads(source.read_text(encoding="utf-8"))
    if not isinstance(raw, dict) or set(raw) != {"servers"} or not isinstance(raw["servers"], dict):
        raise ValueError("MCP configuration must contain a servers object")
    if len(raw["servers"]) > 32:
        raise ValueError("At most 32 MCP servers can be configured")
    result = {}
    for name, config in raw["servers"].items():
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", name):
            raise ValueError("MCP server name must contain only letters, numbers, _ or -")
        try:
            result[name] = ServerConfig.model_validate(config)
        except Exception:
            # Pydantic errors contain raw input values. Config may contain a
            # mistakenly pasted secret; never surface it to the model/logs.
            raise ValueError(f"Invalid configuration for MCP server '{name}'") from None
    return result
