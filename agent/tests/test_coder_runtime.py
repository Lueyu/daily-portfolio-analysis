"""Container boundaries, durable jobs, and owned-process lifecycle."""
import importlib.util
import os
import subprocess
import time
from pathlib import Path

import pytest


def runtime_class():
    assert importlib.util.find_spec("agent_core.coder.runtime"), "container runtime is missing"
    from agent_core.coder.runtime import ContainerRuntime
    return ContainerRuntime


def test_runtime_rejects_unsafe_workspace_and_cwd(tmp_path):
    cls = runtime_class()
    workspace = tmp_path / "source"
    workspace.mkdir()
    runtime = cls("test", workspace, tmp_path / "state", docker_prefix=["docker"])
    with pytest.raises(ValueError, match="cwd"):
        runtime.terminal_start("true", cwd="../../outside")
    (workspace / ".git").mkdir()
    with pytest.raises(ValueError, match="git"):
        runtime.ensure()


def test_runtime_mounts_only_task_workspace_and_private_deps(tmp_path):
    cls = runtime_class()
    workspace = tmp_path / "source"
    workspace.mkdir()
    runtime = cls("test", workspace, tmp_path / "state", docker_prefix=["docker"])
    terminal = runtime._container_args("job", writable=True, network="none")
    service = runtime._container_args("preview", writable=False, network=runtime.network)
    assert "--read-only" in terminal
    assert "no-new-privileges:true" in terminal
    assert "ALL" in terminal
    assert "--privileged" not in terminal
    assert "docker.sock" not in " ".join(terminal)
    assert "--network" in terminal and "none" in terminal
    assert any("target=/workspace,readonly" in arg for arg in service)
    assert any("target=/workspace/node_modules,readonly" in arg for arg in service)
    assert any(arg.startswith("/workspace/node_modules/.vite-temp:rw") for arg in service)
    assert not any("target=/workspace,readonly" in arg for arg in terminal)


def test_runtime_requires_container_engine_no_host_shell_fallback(tmp_path, monkeypatch):
    cls = runtime_class()
    workspace = tmp_path / "source"
    workspace.mkdir()
    calls = []

    def missing_engine(argv, **kwargs):
        calls.append(argv)
        raise FileNotFoundError("docker unavailable")

    monkeypatch.setattr(subprocess, "run", missing_engine)
    runtime = cls("test", workspace, tmp_path / "state", docker_prefix=["missing-docker"])
    from agent_core.coder.runtime import RuntimeUnavailable
    with pytest.raises(RuntimeUnavailable):
        runtime.terminal_start("touch escaped")
    assert all(argv[0] == "missing-docker" for argv in calls)
    assert not (workspace / "escaped").exists()


@pytest.fixture
def saved_runtime(tmp_path):
    workspace = tmp_path / "source"
    workspace.mkdir()
    runtime = runtime_class()("saved", workspace, tmp_path / "state", docker_prefix=["docker"])
    (runtime.state_dir / "sessions").mkdir(parents=True)
    (runtime.state_dir / "artifacts").mkdir()
    return runtime


def test_session_save_retries_transient_atomic_replace(saved_runtime, monkeypatch):
    replace = os.replace
    attempts = []

    def busy_reader(source, destination):
        attempts.append(destination)
        if len(attempts) == 1:
            error = PermissionError("session record is in use")
            error.winerror = 32
            raise error
        return replace(source, destination)

    monkeypatch.setattr(os, "replace", busy_reader)
    monkeypatch.setattr(time, "sleep", lambda _: None)
    saved_runtime._save("sessions", "1" * 24, {"container": "owned-job", "status": "running"})
    assert len(attempts) == 2
    assert saved_runtime._load("sessions", "1" * 24)["status"] == "running"
    assert not list((saved_runtime.state_dir / "sessions").glob("*.tmp"))


@pytest.mark.parametrize("cleanup_failure", [None, "ps", "rm"])
def test_stop_removes_owned_containers_even_when_cancel_record_save_fails(
    saved_runtime, monkeypatch, cleanup_failure,
):
    from agent_core.coder.runtime import RuntimeUnavailable
    session = "1" * 24
    saved_runtime._save("sessions", session, {"container": "owned-job", "status": "running"})
    saved_runtime._ready = True
    calls = []

    def engine(arguments, **kwargs):
        calls.append(arguments)
        if arguments[0] == cleanup_failure:
            raise RuntimeUnavailable("owned cleanup failed")
        output = b"owned-job\nunknown-owned-job\n" if arguments[0] == "ps" else b""
        return subprocess.CompletedProcess(arguments, 0, output, b"")

    def locked_record(*args):
        raise PermissionError("session record is in use")

    monkeypatch.setattr(saved_runtime, "_run", engine)
    monkeypatch.setattr(saved_runtime, "_inspect_optional", lambda _: {"State": {"Running": True}})
    monkeypatch.setattr(saved_runtime, "_save", locked_record)
    expected = RuntimeUnavailable if cleanup_failure else PermissionError
    with pytest.raises(expected):
        saved_runtime.stop_all()
    assert ["kill", "owned-job"] in calls
    assert ["ps", "-aq", "--filter", f"label=coding-agent.owner={saved_runtime.owner}"] in calls
    if cleanup_failure != "ps":
        assert ["rm", "-f", "owned-job", "unknown-owned-job"] in calls
    assert not saved_runtime._ready


def test_browser_close_failure_still_attempts_owned_cleanup(saved_runtime, monkeypatch):
    from agent_core.coder.runtime import RuntimeUnavailable
    calls = []

    def failed_browser():
        raise RuntimeUnavailable("browser cleanup failed")

    def engine(arguments, **kwargs):
        calls.append(arguments)
        return subprocess.CompletedProcess(arguments, 0, b"owned-job" if arguments[0] == "ps" else b"", b"")

    monkeypatch.setattr(saved_runtime, "_close_browser", failed_browser)
    monkeypatch.setattr(saved_runtime, "_run", engine)
    with pytest.raises(RuntimeUnavailable, match="browser cleanup failed"):
        saved_runtime.stop_all()
    assert ["rm", "-f", "owned-job"] in calls


@pytest.fixture
def real_runtime(tmp_path):
    if os.environ.get("CODER_RUNTIME_INTEGRATION") != "1":
        pytest.skip("set CODER_RUNTIME_INTEGRATION=1 with prepared Docker image")
    cls = runtime_class()
    workspace = tmp_path / "source"
    workspace.mkdir()
    runtime = cls("test-" + tmp_path.name, workspace, tmp_path / "state")
    runtime.ensure()
    try:
        yield runtime
    finally:
        runtime.stop_all()


def finish(runtime, result, timeout=15):
    deadline = time.monotonic() + timeout
    output = result["output"]
    while result["status"] == "running" and time.monotonic() < deadline:
        result = runtime.terminal_poll(result["session_id"], result["cursor"], wait_ms=300)
        output += result["output"]
    assert result["status"] != "running", result
    return result, output


def test_real_isolation_and_incremental_output(real_runtime, tmp_path):
    outside = tmp_path / "outside-secret"
    outside.write_text("private", encoding="utf-8")
    command = (
        "test ! -e /var/run/docker.sock && test ! -e /mnt/d/stock && "
        "test ! -e /workspace/.git && "
        "printf 'first\\n'; sleep 0.2; printf 'second\\n'; "
        "printf done > /workspace/result.txt"
    )
    result, output = finish(real_runtime, real_runtime.terminal_start(command))
    assert result["exit_code"] == 0
    assert output == "first\nsecond\n"
    assert (real_runtime.workspace / "result.txt").read_text() == "done"
    assert outside.read_text() == "private"
    assert real_runtime.terminal_poll(result["session_id"], result["cursor"])["output"] == ""


def test_real_output_is_bounded_and_host_environment_is_not_inherited(real_runtime, monkeypatch):
    monkeypatch.setenv("CODER_HOST_ONLY_SECRET", "never-pass-to-container")
    result, output = finish(real_runtime, real_runtime.terminal_start(
        "test -z \"$CODER_HOST_ONLY_SECRET\" && python3 -c 'print(\"x\" * 2000000)'"))
    assert result["exit_code"] == 0
    artifact = Path(result["artifact_path"]).read_bytes()
    assert len(artifact) < 1024 * 1024 + 256
    assert b"output capped" in artifact
    assert b"never-pass-to-container" not in artifact


def test_real_resume_cancel_kills_background_descendants(real_runtime):
    result = real_runtime.terminal_start("(sleep 2; echo escaped > late.txt) & wait")
    resumed = runtime_class()(
        real_runtime.task_id, real_runtime.workspace, real_runtime.state_dir)
    assert resumed.active_writers() == [result["session_id"]]
    cancelled = resumed.terminal_cancel(result["session_id"])
    assert cancelled["status"] == "cancelled"
    time.sleep(2.2)
    assert not (real_runtime.workspace / "late.txt").exists()
    assert resumed.active_writers() == []
    resumed.stop_all()
    assert resumed.active_writers() == []
    assert resumed.terminal_poll(result["session_id"])["status"] == "cancelled"


@pytest.mark.parametrize("message", [b"Error: No such object: gone", b"error: no such object: gone"])
def test_stopped_runtime_reconciles_removed_containers(tmp_path, monkeypatch, message):
    cls = runtime_class()
    workspace = tmp_path / "source"
    workspace.mkdir()
    runtime = cls("test", workspace, tmp_path / "state", docker_prefix=["docker"])
    (runtime.state_dir / "sessions").mkdir(parents=True)
    (runtime.state_dir / "artifacts").mkdir()
    session = "1" * 24
    runtime._save("sessions", session, {"container": "gone", "status": "running"})

    def removed(arguments, **kwargs):
        assert arguments[:1] == ["inspect"]
        return subprocess.CompletedProcess(arguments, 1, b"", message)

    monkeypatch.setattr(runtime, "_run", removed)
    assert runtime.active_writers() == []
    assert runtime.terminal_poll(session)["status"] == "cancelled"


def test_real_shell_exit_does_not_orphan_source_writer(real_runtime):
    result = real_runtime.terminal_start("(sleep 1; echo done > late.txt) &")
    assert result["status"] == "running"
    assert real_runtime.active_writers() == [result["session_id"]]
    finished, _ = finish(real_runtime, result)
    assert finished["status"] == "completed"
    assert (real_runtime.workspace / "late.txt").read_text().strip() == "done"


def test_real_terminal_input_and_timeout(real_runtime):
    result = real_runtime.terminal_start("read value; printf 'got:%s' \"$value\"")
    real_runtime.terminal_write(result["session_id"], "hello\n")
    finished, output = finish(real_runtime, result)
    assert finished["exit_code"] == 0
    assert output == "got:hello"
    timed, _ = finish(real_runtime, real_runtime.terminal_start("sleep 10", timeout_seconds=1))
    assert timed["status"] == "timed_out"


def test_real_service_has_readonly_source(real_runtime):
    (real_runtime.workspace / "index.html").write_text("preview", encoding="utf-8")
    service = real_runtime.service_start(
        "echo forbidden > /workspace/forbidden.txt; python3 -m http.server 8080")
    assert service["url"].startswith("http://service-")
    time.sleep(0.5)
    record = real_runtime._load("services", service["service_id"])
    assert real_runtime._inspect(record["container"])["State"]["Running"]
    assert not (real_runtime.workspace / "forbidden.txt").exists()
    stopped = real_runtime.service_stop(service["service_id"])
    assert stopped["status"] == "stopped"
    assert "Read-only file system" in Path(stopped["artifact_path"]).read_text()


def test_real_browser_is_bound_to_task_service_and_returns_pixels(real_runtime):
    (real_runtime.workspace / "index.html").write_text(
        "<title>Isolated preview</title><label>Name <input></label>"
        "<button onclick=\"this.textContent='Saved'\">Save</button>", encoding="utf-8")
    service = real_runtime.service_start("python3 -m http.server 8080")
    time.sleep(0.5)
    nav = real_runtime.browser({"action": "navigate", "url": service["url"]})
    assert nav["ok"], nav
    assert nav["result"]["title"] == "Isolated preview"
    snapshot = real_runtime.browser({"action": "snapshot"})["result"]
    save = next(item for item in snapshot["elements"] if item["name"] == "Save")
    assert real_runtime.browser({"action": "click", "ref": save["ref"]})["ok"]
    screenshot = real_runtime.browser({"action": "screenshot"})
    assert screenshot["ok"], screenshot
    assert screenshot["result"]["mimeType"] == "image/png"
    assert screenshot["result"]["base64"].startswith("iVBOR")
    blocked = real_runtime.browser({"action": "navigate", "url": "http://127.0.0.1:80"})
    assert not blocked["ok"]


def test_real_service_can_read_previous_terminal_build_output(real_runtime):
    built, _ = finish(real_runtime, real_runtime.terminal_start(
        "mkdir -p dist; printf '<title>Built preview</title><h1>Built output</h1>' > dist/index.html"))
    assert built["exit_code"] == 0
    service = real_runtime.service_start("python3 -m http.server 8080 --directory dist")
    response = real_runtime.browser({"action": "navigate", "url": service["url"]})
    assert response["ok"], response
    assert response["result"]["title"] == "Built preview"
