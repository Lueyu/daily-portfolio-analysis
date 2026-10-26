"""Controlled egress must not turn an isolated task into a host-network shell."""
import importlib.util
import os
import socket
import subprocess
import threading
import time
from pathlib import Path
from types import SimpleNamespace

import pytest


def policy_class():
    from agent_core.coder import runtime
    assert hasattr(runtime, "NetworkPolicy"), "runtime needs an explicit egress policy"
    return runtime.NetworkPolicy


def proxy_module():
    path = Path(__file__).resolve().parents[2] / "scripts/coder-runtime/egress_proxy.py"
    assert path.is_file(), "isolated egress proxy is missing"
    spec = importlib.util.spec_from_file_location("coder_egress_proxy", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_network_policy_defaults_offline_and_matches_domain_boundaries():
    cls = policy_class()
    assert cls().mode == "offline"
    assert not cls().allows_host("registry.npmjs.org")
    policy = cls(mode="allowlist", allowed_hosts=("example.com", "*.docs.example.org"))
    assert policy.allows_host("EXAMPLE.com")
    assert policy.allows_host("api.docs.example.org")
    assert not policy.allows_host("notexample.com")
    assert not policy.allows_host("example.com.attacker.org")
    assert not policy.allows_host("docs.example.org")
    assert policy.as_dict() == {"mode": "allowlist", "allowed_hosts": ["example.com", "*.docs.example.org"]}


@pytest.mark.parametrize("host", ["*", "127.0.0.1", "localhost", "*.localhost", "169.254.169.254",
                                  "http://example.com", "example.com:443", "user@example.com"])
def test_network_policy_rejects_private_literals_and_malformed_allowlist(host):
    with pytest.raises(ValueError):
        policy_class()(mode="allowlist", allowed_hosts=(host,))


@pytest.mark.parametrize("ip", ["127.0.0.1", "10.0.0.1", "172.17.0.1", "192.168.1.1", "169.254.169.254",
                                "0.0.0.0", "224.0.0.1", "::1", "fe80::1", "fc00::1", "::ffff:127.0.0.1"])
def test_proxy_rejects_nonpublic_dns_answers_even_for_allowlisted_hosts(ip, monkeypatch):
    proxy = proxy_module()
    family = socket.AF_INET6 if ":" in ip else socket.AF_INET
    monkeypatch.setattr(proxy.socket, "getaddrinfo", lambda *args, **kwargs: [
        (family, socket.SOCK_STREAM, 6, "", (ip, 443))])
    with pytest.raises(ValueError, match="public"):
        proxy.resolve_public("docs.example.com", 443, ("docs.example.com",))


def test_proxy_pins_validated_dns_and_rejects_mixed_public_private_answers(monkeypatch):
    proxy = proxy_module()
    public = (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443))
    private = (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.0.0.1", 443))
    monkeypatch.setattr(proxy.socket, "getaddrinfo", lambda *args, **kwargs: [public])
    assert proxy.resolve_public("example.com", 443, ("example.com",)) == [public]
    monkeypatch.setattr(proxy.socket, "getaddrinfo", lambda *args, **kwargs: [public, private])
    with pytest.raises(ValueError, match="public"):
        proxy.resolve_public("example.com", 443, ("example.com",))
    with pytest.raises(ValueError, match="allowlist"):
        proxy.resolve_public("attacker.org", 443, ("example.com",))
    with pytest.raises(ValueError, match="port"):
        proxy.resolve_public("example.com", 22, ("example.com",))


def test_allowlisted_runtime_uses_only_internal_network_and_source_free_proxy(tmp_path, monkeypatch):
    from agent_core.coder.runtime import ContainerRuntime
    policy = policy_class()(mode="allowlist", allowed_hosts=("example.com",))
    workspace = tmp_path / "source"
    workspace.mkdir()
    runtime = ContainerRuntime("net", workspace, tmp_path / "state", network_policy=policy)
    calls = []

    def docker(arguments, **kwargs):
        calls.append(arguments)
        missing = arguments[:2] in (["network", "inspect"], ["inspect", runtime.proxy_container])
        return subprocess.CompletedProcess(arguments, int(missing), b"", b"No such container" if missing else b"")

    monkeypatch.setattr(runtime, "_run", docker)
    runtime.ensure()
    proxy = next(call for call in calls if call[:1] == ["create"] and runtime.proxy_container in call)
    assert not any("target=/workspace" in arg or "docker.sock" in arg for arg in proxy)
    assert "--read-only" in proxy and "ALL" in proxy
    assert ["network", "connect", runtime.egress_network, runtime.proxy_container] in calls
    monkeypatch.setattr(runtime, "terminal_poll", lambda *args, **kwargs: {})
    runtime.terminal_start("npm view react version")
    terminal = calls[-2]
    assert terminal[terminal.index("--network") + 1] == runtime.network
    assert "HTTP_PROXY=http://egress-proxy:3128" in terminal
    assert "HTTPS_PROXY=http://egress-proxy:3128" in terminal
    assert runtime.egress_network not in terminal
    assert "host" not in terminal


def test_offline_runtime_does_not_create_proxy_or_proxy_environment(tmp_path):
    from agent_core.coder.runtime import ContainerRuntime
    workspace = tmp_path / "source"
    workspace.mkdir()
    runtime = ContainerRuntime("net", workspace, tmp_path / "state")
    assert runtime.network_policy.mode == "offline"
    args = runtime._container_args("job", writable=True, network="none")
    assert not any("PROXY=" in value for value in args)


def test_live_proxy_rejects_private_dns_and_unlisted_connect_requests(monkeypatch):
    proxy = proxy_module()
    monkeypatch.setattr(proxy.socket, "getaddrinfo", lambda *args, **kwargs: [
        (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 80))])
    with proxy.ProxyServer(("127.0.0.1", 0), proxy.ProxyHandler) as server:
        server.allowed_hosts = ("docs.example.com",)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            for request in (b"GET http://docs.example.com/ HTTP/1.1\r\nHost: docs.example.com\r\n\r\n",
                            b"CONNECT private.example.org:443 HTTP/1.1\r\n\r\n"):
                with socket.socket() as client:
                    client.settimeout(3)
                    client.connect(server.server_address)
                    client.sendall(request)
                    response = client.recv(4096)
                    assert response.startswith(b"HTTP/1.1 403 Forbidden"), response
        finally:
            server.shutdown()
            thread.join(timeout=3)


def test_landing_revalidation_inherits_the_task_network_policy(tmp_path):
    from agent_core.coder.general_landing import _runtime
    policy = policy_class()(mode="allowlist", allowed_hosts=("docs.python.org",))
    harness = SimpleNamespace(runtime_factory=None, task=SimpleNamespace(id="dev_network"),
                              runtime_image="coding-agent-runtime:local", docker_prefix=["docker"],
                              network_policy=policy)
    runtime = _runtime(harness, tmp_path / "workspace", tmp_path / "state")
    assert runtime.network_policy == policy


@pytest.fixture
def network_runtime(tmp_path):
    if os.environ.get("CODER_RUNTIME_NETWORK_INTEGRATION") != "1":
        pytest.skip("set CODER_RUNTIME_NETWORK_INTEGRATION=1 with Docker and public internet")
    from agent_core.coder.runtime import ContainerRuntime, NetworkPolicy
    workspace = tmp_path / "source"
    workspace.mkdir()
    runtime = ContainerRuntime("network-" + tmp_path.name, workspace, tmp_path / "state",
                               network_policy=NetworkPolicy(mode="allowlist"))
    try:
        runtime.ensure()
        yield runtime
    finally:
        runtime.stop_all()


def test_real_allowlisted_package_download_and_external_browser(network_runtime):
    result = network_runtime.terminal_start("npm view is-number@7.0.0 version", timeout_seconds=45)
    output = result["output"]
    deadline = time.monotonic() + 50
    while result["status"] == "running" and time.monotonic() < deadline:
        result = network_runtime.terminal_poll(result["session_id"], result["cursor"], wait_ms=1000)
        output += result["output"]
    assert result["exit_code"] == 0, output
    assert "7.0.0" in output
    page = network_runtime.browser({"action": "navigate", "url": "https://docs.python.org/3/"})
    assert page["ok"], page
    assert "Documentation" in page["result"]["title"]
    denied = network_runtime.browser({"action": "navigate", "url": "http://169.254.169.254/latest/meta-data/"})
    assert not denied["ok"]


def test_real_allowlisted_terminal_cannot_bypass_proxy(network_runtime):
    command = (
        "python3 - <<'PY'\n"
        "import socket,urllib.request,urllib.error\n"
        "try:\n socket.create_connection(('1.1.1.1',443),timeout=2); raise AssertionError('direct egress escaped')\n"
        "except OSError: print('direct egress blocked')\n"
        "try:\n urllib.request.urlopen('http://169.254.169.254/latest/meta-data/',timeout=5); "
        "raise AssertionError('metadata escaped')\n"
        "except urllib.error.HTTPError as error:\n assert error.code==403; print('metadata denied')\n"
        "PY"
    )
    result = network_runtime.terminal_start(command, timeout_seconds=15)
    output = result["output"]
    deadline = time.monotonic() + 20
    while result["status"] == "running" and time.monotonic() < deadline:
        result = network_runtime.terminal_poll(result["session_id"], result["cursor"], wait_ms=500)
        output += result["output"]
    assert result["exit_code"] == 0, output
    assert "direct egress blocked" in output and "metadata denied" in output


def test_real_dependencies_are_writable_and_packages_can_be_installed(network_runtime):
    command = (
        "touch /workspace/node_modules/.agent-write-test && "
        "npm install --prefix /tmp/installed --ignore-scripts --no-audit --no-fund is-number@7.0.0 && "
        "node -e \"if (!require('/tmp/installed/node_modules/is-number')(7)) process.exit(1)\""
    )
    result = network_runtime.terminal_start(command, timeout_seconds=45)
    output = result["output"]
    deadline = time.monotonic() + 50
    while result["status"] == "running" and time.monotonic() < deadline:
        result = network_runtime.terminal_poll(result["session_id"], result["cursor"], wait_ms=1000)
        output += result["output"]
    assert result["exit_code"] == 0, output


def test_real_resume_recreates_dependency_caches_as_task_user(network_runtime):
    result = network_runtime.terminal_start(
        "rmdir node_modules/.vite node_modules/.vite-temp node_modules/.cache", timeout_seconds=10)
    deadline = time.monotonic() + 15
    while result["status"] == "running" and time.monotonic() < deadline:
        result = network_runtime.terminal_poll(result["session_id"], result["cursor"], wait_ms=500)
    assert result["exit_code"] == 0, result
    from agent_core.coder.runtime import ContainerRuntime
    resumed = ContainerRuntime(network_runtime.task_id, network_runtime.workspace, network_runtime.state_dir,
                               network_policy=network_runtime.network_policy)
    resumed.ensure()
