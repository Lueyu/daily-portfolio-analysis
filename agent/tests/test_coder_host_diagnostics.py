"""Read-only host inspection must not become a second, unsandboxed executor."""
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace

import pytest

from agent_core.config import Settings
from agent_core.coder.general_tools import build_general_registry


def test_host_tool_accepts_only_capture_option():
    registry = build_general_registry()
    assert "inspect_local_app" in registry.names()
    from agent_core.coder.extension_tools import InspectLocalApp
    for extra in ({"url": "http://localhost/private"}, {"command": "rm -rf /"},
                  {"port": 22}, {"headers": {"Authorization": "secret"}}):
        with pytest.raises(ValueError):
            InspectLocalApp.model_validate(extra)


@pytest.fixture
def app_server():
    calls = []
    responses = {}
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            calls.append((self.path, dict(self.headers)))
            status, data, headers = responses.get(self.path, (404, {}, {}))
            body = json.dumps(data).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            for key, value in headers.items():
                self.send_header(key, value)
            self.end_headers()
            self.wfile.write(body)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield server.server_port, calls, responses
    server.shutdown()
    thread.join(timeout=3)
    server.server_close()


def run_inspection(tmp_path, port, **overrides):
    from agent_core.coder.host_diagnostics import inspect_local_app
    settings = Settings(_env_file=None, probe_pg_port=port,
                        probe_backend_url=f"http://127.0.0.1:{port}",
                        probe_frontend_url=f"http://127.0.0.1:{port}", **overrides)
    return inspect_local_app(settings, tmp_path, tmp_path / "artifacts", capture_browser=False)


def test_fixed_get_probes_return_counts_and_never_credentials_or_rows(tmp_path, app_server, monkeypatch):
    port, calls, responses = app_server
    responses["/api/portfolio/holdings"] = (200, {"items": [{"private": "HOLDING_SECRET"}], "total": 1}, {})
    responses["/api/portfolio/dashboard/overview"] = (500, {"error": "ECONNREFUSED password=SECRET"}, {})
    (tmp_path / ".env.local").write_text(
        'SUDA_DATABASE_URL=postgres://user:DB_SECRET@127.0.0.1:5432/private?schema=private\n'
        'LOCAL_DEV_USER_ID=PRIVATE_USER\nOTHER_SECRET=UNRELATED_SECRET\n', encoding="utf-8")
    for name in ("SUDA_DATABASE_URL", "LOCAL_DEV_USER_ID"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("HTTP_PROXY", "http://127.0.0.1:1")
    result = run_inspection(tmp_path, port)
    serialized = json.dumps(result)
    assert not any(secret in serialized for secret in
                   ["HOLDING_SECRET", "DB_SECRET", "PRIVATE_USER", "UNRELATED_SECRET", "password="])
    assert result["environment"]["database"] == {
        "configured": True, "source": "project_env_local", "targetKind": "loopback"}
    assert result["api"]["holdings"]["itemCount"] == 1
    assert result["api"]["dashboard"]["errorCategory"] == "connection_refused"
    assert {path for path, _ in calls} == {"/api/portfolio/holdings", "/api/portfolio/dashboard/overview"}
    assert all("Authorization" not in headers and "Cookie" not in headers for _, headers in calls)
    assert result["scope"] == "host_main" and result["countsAsVerification"] is False


def test_redirect_is_reported_without_following_it(tmp_path, app_server):
    port, calls, responses = app_server
    responses["/api/portfolio/holdings"] = (302, {}, {"Location": f"http://127.0.0.1:{port}/private"})
    result = run_inspection(tmp_path, port)
    assert result["api"]["holdings"]["errorCategory"] == "redirect_blocked"
    assert all(path != "/private" for path, _ in calls)


@pytest.mark.parametrize("changes", [
    {"probe_backend_url": "https://example.com"},
    {"probe_frontend_url": "http://127.0.0.1:3000/private"},
    {"probe_backend_url": "http://user:SECRET@localhost:3000"},
    {"probe_frontend_url": "http://localhost:3000?secret=SECRET"},
    {"probe_backend_url": "http://127.0.0.1:0"},
    {"probe_pg_host": "192.168.1.5"},
    {"probe_pg_host": "localhost.example.com"},
    {"probe_pg_port": 0},
])
def test_operator_probe_config_cannot_target_external_or_credential_urls(tmp_path, changes):
    from agent_core.coder.host_diagnostics import inspect_local_app
    settings = Settings(_env_file=None, **changes)
    with pytest.raises(ValueError) as failure:
        inspect_local_app(settings, tmp_path, tmp_path / "artifacts", capture_browser=False)
    assert "SECRET" not in str(failure.value)


def test_subagents_cannot_use_host_inspection(tmp_path):
    from agent_core.coder.extension_tools import InspectLocalApp
    from agent_core.coder.extensions import AgentExtensions
    harness = SimpleNamespace(state_dir=tmp_path)
    extension = AgentExtensions(harness, Settings(_env_file=None), worker_depth=1)
    with pytest.raises(ValueError, match="parent|worker|subagent"):
        extension.execute(InspectLocalApp())


def test_env_precedence_and_missing_files_are_explicit(tmp_path, monkeypatch):
    from agent_core.coder.host_diagnostics import environment_summary
    (tmp_path / ".env.local").write_text('SUDA_DATABASE_URL=postgres://localhost/local\n', encoding="utf-8")
    monkeypatch.setenv("SUDA_DATABASE_URL", "postgres://user:TOP_SECRET@database.example.com/remote")
    summary = environment_summary(tmp_path)
    assert summary["database"] == {"configured": True, "source": "process", "targetKind": "remote"}
    assert "TOP_SECRET" not in json.dumps(summary)
    assert summary["files"] == {"project_env": "missing", "project_env_local": "loaded"}


def test_host_observation_is_persisted_without_satisfying_candidate_checks(tmp_path, app_server):
    from agent_core.coder.extension_tools import InspectLocalApp
    from agent_core.coder.extensions import AgentExtensions
    port, _, _ = app_server
    settings = Settings(_env_file=None, probe_pg_port=port,
        probe_backend_url=f"http://127.0.0.1:{port}", probe_frontend_url=f"http://127.0.0.1:{port}")
    events = []
    harness = SimpleNamespace(state_dir=tmp_path, trusted_project_root=tmp_path,
        state={"verification": [], "revision": "candidate"}, _save=lambda: None,
        evidence=SimpleNamespace(event=lambda *args: events.append(args)))
    extension = AgentExtensions(harness, settings)
    result = extension.execute(InspectLocalApp(capture_browser=False))
    assert harness.state["verification"] == []
    assert "browser_verification" not in harness.state
    assert harness.state["host_observation"]["countsAsVerification"] is False
    assert events[0][0] == "InspectLocalApp"
    assert not result.images and not result.made_progress


def test_response_bounds_and_no_json_are_reported_without_content(tmp_path, app_server):
    port, _, responses = app_server
    responses["/api/portfolio/holdings"] = (200, {"secret": "x" * 1_000_100}, {})
    result = run_inspection(tmp_path, port)
    assert result["api"]["holdings"]["errorCategory"] == "response_too_large"
    assert len(json.dumps(result)) < 5000
