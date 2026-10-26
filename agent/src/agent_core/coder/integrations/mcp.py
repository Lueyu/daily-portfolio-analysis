"""Bounded Streamable HTTP MCP client (2025-06-18), with no host command execution.

Supports JSON/SSE POST responses, initialization, sessions, tool pagination,
and local JSON Schema validation. Server content is data, never authority.
"""

from __future__ import annotations

import json
import os
import time

import httpx
from jsonschema import validators

from .config import ServerConfig

PROTOCOL_VERSION = "2025-06-18"
MAX_RESPONSE_BYTES = 1_000_000


class MCPError(RuntimeError):
    pass


def validate_schema(schema: dict, instance=None, *, check_only: bool = False) -> None:
    """Never let JSON Schema resolve references over the host network."""
    def check_references(value):
        if isinstance(value, dict):
            for key, child in value.items():
                if key in ("$ref", "$dynamicRef", "$recursiveRef") and (
                    not isinstance(child, str) or not child.startswith("#")
                ):
                    raise ValueError("Only local JSON Schema references are supported")
                check_references(child)
        elif isinstance(value, list):
            for child in value:
                check_references(child)
    check_references(schema)
    validator = validators.validator_for(schema)
    validator.check_schema(schema)
    if not check_only:
        validator(schema).validate(instance)


class MCPClient:
    def __init__(self, name: str, config: ServerConfig, *, credentials: dict[str, str] | None = None):
        self.name, self.config = name, config
        self.credentials = credentials or {}
        self.session_id: str | None = None
        self.protocol_version = PROTOCOL_VERSION
        self.initialized = False
        self.next_id = 0
        self.tools: dict[str, dict] | None = None
        self.secrets: list[str] = []

    def redact(self, value):
        if isinstance(value, str):
            for secret in self.secrets:
                if secret:
                    value = value.replace(secret, "[REDACTED]")
            return value
        if isinstance(value, list):
            return [self.redact(item) for item in value]
        if isinstance(value, dict):
            return {self.redact(str(key)): self.redact(item) for key, item in value.items()}
        return value

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"}
        for header, variable in self.config.headersEnv.items():
            value = self.credentials.get(variable) or os.environ.get(variable)
            if not value:
                raise MCPError(f"MCP server '{self.name}' requires environment variable '{variable}'")
            if "\r" in value or "\n" in value:
                raise MCPError("MCP authentication environment value contains a newline")
            headers[header] = value
            self.secrets.append(value)
            # Also redact the token portion of standard Authorization values.
            if header.lower() == "authorization" and " " in value:
                self.secrets.append(value.split(" ", 1)[1])
        if self.session_id:
            headers["Mcp-Session-Id"] = self.session_id
        if self.initialized:
            headers["MCP-Protocol-Version"] = self.protocol_version
        return headers

    def _rpc(self, method: str, params: dict | None = None, *, notification=False) -> dict:
        self.next_id += 1
        request_id = self.next_id
        body = {"jsonrpc": "2.0", "method": method}
        if not notification:
            body["id"] = request_id
        if params is not None:
            body["params"] = params
        started = time.monotonic()
        try:
            with httpx.Client(timeout=self.config.timeoutSeconds, follow_redirects=False, trust_env=False) as client:
                with client.stream("POST", self.config.url, json=body, headers=self._headers()) as response:
                    if response.status_code == 404 and self.session_id:
                        self.session_id, self.initialized, self.tools = None, False, None
                        # Retrying an external write could execute it twice.
                        raise MCPError("MCP session expired; reconnect before retrying (call was not replayed)")
                    if response.status_code >= 300:
                        raise MCPError(f"MCP server '{self.name}' returned HTTP {response.status_code}")
                    if notification:
                        return {}
                    session = response.headers.get("Mcp-Session-Id")
                    if method == "initialize" and session:
                        if len(session) > 1024 or any(not 0x21 <= ord(c) <= 0x7e for c in session):
                            raise MCPError("MCP server returned an invalid session ID")
                        self.session_id = session
                    content_type = response.headers.get("Content-Type", "").split(";", 1)[0].lower()
                    if content_type == "text/event-stream":
                        packet = self._read_sse(response, request_id, started)
                    elif content_type == "application/json":
                        data = bytearray()
                        for chunk in response.iter_bytes():
                            data.extend(chunk)
                            self._check_limits(len(data), started)
                        packet = json.loads(data)
                    else:
                        raise MCPError("MCP response must be JSON or an SSE stream")
        except httpx.TimeoutException:
            raise MCPError(f"MCP server '{self.name}' timed out; call was not replayed") from None
        except httpx.HTTPError:
            raise MCPError(f"MCP server '{self.name}' connection failed") from None
        except (json.JSONDecodeError, UnicodeError):
            raise MCPError("MCP server returned invalid JSON") from None
        if not isinstance(packet, dict) or packet.get("jsonrpc") != "2.0" or packet.get("id") != request_id:
            raise MCPError("MCP response ID or JSON-RPC version did not match")
        if "error" in packet:
            raise MCPError("MCP protocol error: " + str(self.redact(packet["error"]))[:1000])
        if not isinstance(packet.get("result"), dict):
            raise MCPError("MCP response has no result object")
        return packet["result"]

    def _check_limits(self, size: int, started: float):
        if size > MAX_RESPONSE_BYTES:
            raise MCPError("MCP response exceeded 1 MB")
        if time.monotonic() - started > self.config.timeoutSeconds:
            raise MCPError("MCP response exceeded its total time limit")

    def _read_sse(self, response, request_id: int, started: float) -> dict:
        total, data, pending = 0, [], bytearray()
        for chunk in response.iter_bytes():
            total += len(chunk)
            self._check_limits(total, started)
            pending.extend(chunk)
            # Bound bytes before looking for newlines: an untrusted server
            # cannot make an unbounded line accumulate inside iter_lines().
            while b"\n" in pending:
                raw, _, rest = pending.partition(b"\n")
                pending = bytearray(rest)
                line = raw.rstrip(b"\r").decode("utf-8")
                if line.startswith("data:"):
                    data.append(line[5:].lstrip(" "))
                elif line == "" and data:
                    packet = json.loads("\n".join(data))
                    data = []
                    if isinstance(packet, dict) and packet.get("id") == request_id:
                        return packet
        raise MCPError("MCP SSE stream ended before the requested response")

    def initialize(self):
        if self.initialized:
            return
        result = self._rpc("initialize", {
            "protocolVersion": PROTOCOL_VERSION, "capabilities": {},
            "clientInfo": {"name": "stock-coding-agent", "version": "0.2.0"},
        })
        version = result.get("protocolVersion")
        if version not in ("2025-03-26", "2025-06-18", "2025-11-25"):
            raise MCPError("MCP server selected an unsupported protocol version")
        if "tools" not in result.get("capabilities", {}):
            raise MCPError("MCP server does not advertise tool capability")
        self.protocol_version = version
        self.initialized = True
        self._rpc("notifications/initialized", notification=True)

    def list_tools(self) -> list[dict]:
        if self.tools is not None:
            return list(self.tools.values())
        self.initialize()
        found, cursor, seen = {}, None, set()
        for _ in range(20):
            result = self._rpc("tools/list", {"cursor": cursor} if cursor else {})
            raw_tools = result.get("tools")
            if not isinstance(raw_tools, list):
                raise MCPError("MCP tools/list did not return an array")
            for tool in raw_tools:
                if not isinstance(tool, dict) or not isinstance(tool.get("name"), str):
                    raise MCPError("MCP returned an invalid tool definition")
                name = tool["name"]
                if self.config.allowedTools is not None and name not in self.config.allowedTools:
                    continue
                schema = tool.get("inputSchema")
                if not isinstance(schema, dict) or schema.get("type") != "object":
                    raise MCPError("MCP inputSchema must describe an object")
                validate_schema(schema, check_only=True)
                if tool.get("outputSchema") is not None:
                    validate_schema(tool["outputSchema"], check_only=True)
                found[name] = tool
                if len(found) > 500:
                    raise MCPError("MCP tool catalog exceeds 500 tools")
            cursor = result.get("nextCursor")
            if not cursor:
                self.tools = found
                return list(found.values())
            if not isinstance(cursor, str) or cursor in seen:
                raise MCPError("MCP tools/list returned an invalid pagination cursor")
            seen.add(cursor)
        raise MCPError("MCP tool pagination exceeds 20 pages")

    def call_tool(self, name: str, arguments: dict) -> dict:
        return self._rpc("tools/call", {"name": name, "arguments": arguments})
