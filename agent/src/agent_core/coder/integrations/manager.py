"""Tool-facing integration API; approval decisions remain in the task harness."""

from __future__ import annotations

import json
from hashlib import sha256
from pathlib import Path

from jsonschema.exceptions import ValidationError

from .config import ServerConfig, load_servers
from .mcp import MCPClient, validate_schema
from .skills import SkillCatalog


class IntegrationManager:
    def __init__(self, settings, trusted_project_root: str | Path, *, forbidden_roots=()):
        self.clients: dict[str, MCPClient] = {}
        self.config_error: str | None = None
        try:
            inline = getattr(settings, 'coder_mcp_servers', None)
            servers = ({name: ServerConfig.model_validate(config) for name, config in inline.items()}
                       if inline is not None else load_servers(getattr(settings, "coder_mcp_config", None), list(forbidden_roots)))
            self.clients = {name: MCPClient(name, config, credentials=getattr(settings, 'coder_mcp_credentials', {}))
                            for name, config in servers.items()}
        except Exception as exc:
            self.config_error = ("Invalid inline MCP configuration" if getattr(settings, 'coder_mcp_servers', None) is not None
                                 else str(exc) if isinstance(exc, (ValueError, FileNotFoundError))
                                 else "Cannot load MCP configuration")
        self.skills = SkillCatalog(Path(trusted_project_root), getattr(settings, "coder_skills_dir", None), forbidden_roots)

    def list_tools(self, server: str | None = None) -> dict:
        if self.config_error:
            return {"ok": False, "tools": [], "servers": [], "errors": [{"error": self.config_error}]}
        tools, errors = [], []
        selected = {server: self.clients[server]} if server in self.clients else self.clients if server is None else {}
        if server and not selected:
            return {"ok": False, "status": "not_configured", "tools": [], "servers": [],
                    "errors": [{"server": server, "error": "MCP server is not configured"}]}
        for name, client in selected.items():
            try:
                for tool in client.list_tools():
                    readonly = tool["name"] in client.config.readOnlyTools
                    tools.append(client.redact({
                        "server": name, "name": tool["name"], "description": tool.get("description", "")[:4000],
                        "inputSchema": tool["inputSchema"], "readOnly": readonly, "approvalRequired": not readonly,
                        "effect": "read_only" if readonly else "external_effect",
                    }))
            except Exception as exc:
                errors.append({"server": name, "error": client.redact(str(exc))[:2000]})
        return {"ok": not errors, "tools": tools, "servers": list(selected), "errors": errors}

    def call_tool(self, server: str, tool: str, arguments: dict, *, approved: bool = False) -> dict:
        client = self.clients.get(server)
        if not client:
            return {"ok": False, "status": "not_configured", "error": "MCP server is not configured"}
        try:
            client.list_tools()
            schema = (client.tools or {}).get(tool)
            if schema is None:
                return {"ok": False, "status": "tool_not_allowed", "error": "Tool is absent or excluded by operator policy"}
            try:
                validate_schema(schema["inputSchema"], arguments)
            except ValidationError as exc:
                # A validation message may repeat secrets from the arguments.
                return {"ok": False, "status": "invalid_arguments", "error": client.redact(exc.message)[:2000]}
            if tool not in client.config.readOnlyTools and not approved:
                return client.redact({"ok": False, "status": "approval_required", "approvalRequired": True,
                                      "effect": "external_effect", "request": {
                                          "server": server, "tool": tool, "arguments": arguments,
                                      }})
            result = client.call_tool(tool, arguments)
            if schema.get("outputSchema") is not None and not result.get("isError"):
                validate_schema(schema["outputSchema"], result.get("structuredContent"))
            result = self._bounded_result(client, result)
            return {"ok": not result.get("isError", False), "status": "completed", "server": server,
                    "tool": tool, "result": result, "untrustedContent": True}
        except Exception as exc:
            return {"ok": False, "status": "integration_error", "error": client.redact(str(exc))[:2000]}

    def approval_binding(self, server: str, tool: str) -> dict:
        """Bind grants to a public endpoint/schema/policy, never credential values."""
        client = self.clients.get(server)
        if client is None:
            raise ValueError("MCP server is not configured")
        client.list_tools()
        definition = (client.tools or {}).get(tool)
        if definition is None:
            raise ValueError("MCP tool is absent or excluded by operator policy")
        public = {
            "server": server, "endpoint": client.config.url, "tool": tool,
            "definition": definition,
            "allowedTools": sorted(client.config.allowedTools) if client.config.allowedTools is not None else None,
            "readOnlyTools": sorted(client.config.readOnlyTools),
            "headerEnvironmentNames": client.config.headersEnv,
        }
        fingerprint = sha256(json.dumps(public, sort_keys=True, ensure_ascii=False,
                                        separators=(",", ":"), allow_nan=False).encode()).hexdigest()
        return {"server": server, "tool": tool, "endpoint": client.config.url, "fingerprint": fingerprint}

    @staticmethod
    def _bounded_result(client: MCPClient, result: dict) -> dict:
        result = client.redact(result)
        # Do not put opaque binary payloads into the model context or history.
        content = result.get("content", [])
        if isinstance(content, list):
            result["content"] = [
                {"type": item.get("type"), "mimeType": item.get("mimeType"), "omitted": "binary content"}
                if isinstance(item, dict) and item.get("type") in ("image", "audio") else item for item in content
            ]
        serialized = json.dumps(result, ensure_ascii=False)
        if len(serialized) <= client.config.maxResultChars:
            return result
        return {"isError": bool(result.get("isError")), "truncated": True,
                "content": [{"type": "text", "text": serialized[:client.config.maxResultChars]}]}

    def list_skills(self) -> dict:
        return self.skills.discover()

    def read_skill(self, skill_id: str) -> dict:
        return self.skills.read(skill_id)

    def capabilities(self) -> dict:
        """No network calls and no credential values: safe to display in /dev."""
        return {"mcpServers": list(self.clients), "mcpConfigured": bool(self.clients),
                "mcpError": self.config_error, "skillCount": len(self.list_skills()["skills"])}
