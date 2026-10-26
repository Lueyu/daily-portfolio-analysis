"""Integration contract tests use a real local HTTP MCP endpoint, no credentials."""

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from agent_core.config import Settings


@pytest.fixture
def mcp_server():
    calls = []
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass
        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            calls.append((body, dict(self.headers)))
            method = body["method"]
            if method == "notifications/initialized":
                self.send_response(202)
                self.end_headers()
                return
            if method == "initialize":
                result = {"protocolVersion": "2025-06-18", "capabilities": {"tools": {}},
                          "serverInfo": {"name": "fake", "version": "1"}}
            elif method == "tools/list":
                schema = {"type": "object", "properties": {"value": {"type": "string"}},
                          "required": ["value"], "additionalProperties": False}
                result = {"tools": [{"name": name, "inputSchema": schema,
                                     "annotations": {"readOnlyHint": True}}
                                    for name in ["lookup", "send"]]}
            else:
                result = {"content": [{"type": "text", "text": body["params"]["arguments"]["value"]}],
                          "structuredContent": {"received": True}, "isError": False}
            payload = json.dumps({"jsonrpc": "2.0", "id": body["id"], "result": result}).encode()
            self.send_response(200)
            if self.path == "/sse":
                payload = b": keepalive\n\ndata: " + payload + b"\n\n"
            if self.path == "/oversize-sse":
                payload = b"data: " + b"x" * 1_000_001
            self.send_header("Content-Type", "text/event-stream" if self.path in ("/sse", "/oversize-sse") else "application/json")
            self.send_header("Mcp-Session-Id", "test-session")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_port}/mcp", calls
    server.shutdown()
    thread.join(timeout=3)
    server.server_close()


def manager(tmp_path, endpoint, monkeypatch):
    from agent_core.coder.integrations import IntegrationManager
    config = tmp_path / "mcp.json"
    config.write_text(json.dumps({"servers": {"example": {
        "url": endpoint, "headersEnv": {"Authorization": "TEST_MCP_AUTH"},
        "readOnlyTools": ["lookup"], "allowedTools": ["lookup", "send"],
    }}}), encoding="utf-8")
    monkeypatch.setenv("TEST_MCP_AUTH", "Bearer secret-test")
    project = tmp_path / "project"
    project.mkdir()
    return IntegrationManager(Settings(_env_file=None, coder_mcp_config=str(config)), project)


def test_mcp_initializes_validates_and_propagates_session(tmp_path, mcp_server, monkeypatch):
    endpoint, calls = mcp_server
    client = manager(tmp_path, endpoint, monkeypatch)
    result = client.list_tools()
    assert result["ok"] and len(result["tools"]) == 2
    result = client.call_tool("example", "lookup", {"value": "hello"})
    assert result["ok"] and result["result"]["structuredContent"] == {"received": True}
    methods = [call[0]["method"] for call in calls]
    assert methods == ["initialize", "notifications/initialized", "tools/list", "tools/call"]
    assert calls[-1][1]["Mcp-Session-Id"] == "test-session"
    assert calls[-1][1]["MCP-Protocol-Version"] == "2025-06-18"
    assert calls[-1][1]["Authorization"] == "Bearer secret-test"
    invalid = client.call_tool("example", "lookup", {"value": 7})
    assert not invalid["ok"] and invalid["status"] == "invalid_arguments"
    assert len(calls) == 4


def test_server_readonly_annotation_does_not_bypass_operator_policy(tmp_path, mcp_server, monkeypatch):
    endpoint, calls = mcp_server
    client = manager(tmp_path, endpoint, monkeypatch)
    pending = client.call_tool("example", "send", {"value": "message"})
    assert pending["approvalRequired"] and pending["status"] == "approval_required"
    assert pending["request"] == {"server": "example", "tool": "send", "arguments": {"value": "message"}}
    assert not any(call[0]["method"] == "tools/call" for call in calls)
    approved = client.call_tool("example", "send", {"value": "message"}, approved=True)
    assert approved["ok"]


def test_mcp_result_and_errors_redact_configured_credentials(tmp_path, mcp_server, monkeypatch):
    endpoint, _ = mcp_server
    client = manager(tmp_path, endpoint, monkeypatch)
    result = client.call_tool("example", "lookup", {"value": "Bearer secret-test"})
    assert "secret-test" not in json.dumps(result)


def test_missing_config_and_skills_are_explicit(tmp_path):
    from agent_core.coder.integrations import IntegrationManager
    client = IntegrationManager(Settings(_env_file=None), tmp_path)
    assert client.list_tools() == {"ok": True, "tools": [], "servers": [], "errors": []}
    assert client.call_tool("missing", "tool", {})["status"] == "not_configured"
    assert client.list_skills()["skills"] == []


def test_skill_discovery_and_read_stay_inside_trusted_roots(tmp_path):
    from agent_core.coder.integrations import IntegrationManager
    skill = tmp_path / ".agents" / "skills" / "testing" / "SKILL.md"
    skill.parent.mkdir(parents=True)
    skill.write_text('---\nname: testing\ndescription: "Run checks before completion"\n---\n# Testing\nUse pytest.\n', encoding="utf-8")
    client = IntegrationManager(Settings(_env_file=None), tmp_path)
    listed = client.list_skills()["skills"]
    assert listed[0]["id"] == "project/testing"
    assert listed[0]["description"] == "Run checks before completion"
    result = client.read_skill("project/testing")
    assert result["ok"] and "Use pytest" in result["content"]
    assert result["instructionPriority"] == "subordinate_to_system_and_user"
    assert not client.read_skill("../../.env")["ok"]


def test_mcp_config_cannot_be_loaded_from_editable_workspace(tmp_path):
    from agent_core.coder.integrations import IntegrationManager
    config = tmp_path / "task" / "mcp.json"
    config.parent.mkdir()
    config.write_text('{"servers":{}}', encoding="utf-8")
    client = IntegrationManager(Settings(_env_file=None, coder_mcp_config=str(config)), tmp_path,
                                forbidden_roots=[config.parent])
    assert not client.list_tools()["ok"]
    assert "editable" in client.list_tools()["errors"][0]["error"]


def test_mcp_accepts_sse_responses(tmp_path, mcp_server, monkeypatch):
    endpoint, calls = mcp_server
    client = manager(tmp_path, endpoint.replace("/mcp", "/sse"), monkeypatch)
    result = client.call_tool("example", "lookup", {"value": "sse response"})
    assert result["ok"]
    assert result["result"]["content"][0]["text"] == "sse response"


def test_mcp_rejects_oversized_sse_without_waiting_for_a_line_end(tmp_path, mcp_server, monkeypatch):
    endpoint, _ = mcp_server
    client = manager(tmp_path, endpoint.replace("/mcp", "/oversize-sse"), monkeypatch)
    result = client.list_tools()
    assert not result["ok"] and "1 MB" in result["errors"][0]["error"]


def test_large_result_is_bounded_and_binary_is_not_put_in_context(tmp_path, mcp_server, monkeypatch):
    endpoint, _ = mcp_server
    client = manager(tmp_path, endpoint, monkeypatch)
    result = client.call_tool("example", "lookup", {"value": "x" * 30000})
    assert result["ok"] and result["result"]["truncated"]
    assert len(json.dumps(result)) < 25000
    bounded = client._bounded_result(client.clients["example"], {
        "content": [{"type": "image", "mimeType": "image/png", "data": "PRIVATE_BASE64"}],
    })
    assert "PRIVATE_BASE64" not in json.dumps(bounded)


@pytest.mark.parametrize("config", [
    {"url": "https://user:pass@example.com/mcp"},
    {"url": "https://example.com/mcp?token=SECRET"},
    {"command": "python", "args": ["malicious.py"]},
    {"url": "http://localhost/mcp", "headersEnv": {"Host": "OVERRIDE"}},
])
def test_config_rejects_host_execution_and_credential_urls_without_echoing_values(tmp_path, config):
    from agent_core.coder.integrations import IntegrationManager
    path = tmp_path / "mcp.json"
    path.write_text(json.dumps({"servers": {"test": config}}), encoding="utf-8")
    client = IntegrationManager(Settings(_env_file=None, coder_mcp_config=str(path)), tmp_path)
    status = client.list_tools()
    assert not status["ok"]
    assert "SECRET" not in json.dumps(status) and "user:pass" not in json.dumps(status)


def test_schema_remote_references_never_fetch_host_urls():
    from agent_core.coder.integrations.mcp import validate_schema
    with pytest.raises(ValueError, match="local JSON Schema"):
        validate_schema({"type": "object", "properties": {"x": {"$ref": "http://localhost/private"}}}, {})


def test_approval_binding_tracks_endpoint_and_schema_without_credentials(tmp_path, mcp_server, monkeypatch):
    endpoint, _ = mcp_server
    client = manager(tmp_path, endpoint, monkeypatch)
    first = client.approval_binding("example", "send")
    assert first["endpoint"] == endpoint
    assert len(first["fingerprint"]) == 64
    assert "secret-test" not in json.dumps(first)
    client.clients["example"].config.url = endpoint + "/new-account"
    assert client.approval_binding("example", "send")["fingerprint"] != first["fingerprint"]
    client.clients["example"].config.url = endpoint
    client.clients["example"].tools["send"]["inputSchema"]["description"] = "different semantics"
    assert client.approval_binding("example", "send")["fingerprint"] != first["fingerprint"]


def test_skill_symlink_escape_is_not_discovered(tmp_path):
    from agent_core.coder.integrations import IntegrationManager
    outside = tmp_path / "private.md"
    outside.write_text("secret", encoding="utf-8")
    root = tmp_path / ".agents" / "skills" / "escape"
    root.mkdir(parents=True)
    try:
        (root / "SKILL.md").symlink_to(outside)
    except OSError:
        pytest.skip("Symlink creation not available on this Windows host")
    assert IntegrationManager(Settings(_env_file=None), tmp_path).list_skills()["skills"] == []
