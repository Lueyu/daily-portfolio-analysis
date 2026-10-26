"""Task-owned Docker containers with recoverable terminal sessions."""
from __future__ import annotations

import hashlib
import json
import os
import queue
import re
import shutil
import subprocess
import threading
import time
import uuid
from pathlib import Path, PurePosixPath
from typing import Any

from ..task_store import TaskStore
from .network import NetworkPolicy


class RuntimeUnavailable(RuntimeError):
    """Required isolation infrastructure is unavailable; fail closed."""


class ContainerRuntime:
    def __init__(
        self, task_id: str, workspace: Path, state_dir: Path,
        image: str = "coding-agent-runtime:local", docker_prefix: list[str] | None = None,
        worker_path: Path | None = None,
        network_policy: NetworkPolicy | None = None,
    ):
        self.task_id = task_id
        self.workspace = Path(workspace).resolve()
        self.state_dir = Path(state_dir).resolve()
        self.image = image
        self.network_policy = network_policy or NetworkPolicy()
        self.docker_prefix = docker_prefix or (
            ["docker"] if shutil.which("docker") else
            ["wsl", "-d", "Ubuntu", "--exec", "docker"] if os.name == "nt" else ["docker"])
        if self.docker_prefix[0].lower().endswith(("wsl", "wsl.exe")):
            self.docker_prefix = ["--exec" if item == "--" else item for item in self.docker_prefix]
        identity = hashlib.sha256((task_id + str(self.state_dir)).encode()).hexdigest()[:16]
        self.owner = "coder-" + identity
        self.network = self.owner + "-net"
        self.egress_network = self.owner + "-egress"
        self.proxy_container = self.owner + "-proxy"
        self.dependencies = self.owner + "-deps"
        self.worker_path = worker_path or Path(__file__).resolve().parents[5] / "scripts/coder-browser/worker.mjs"
        self.proxy_path = Path(__file__).resolve().parents[5] / "scripts/coder-runtime/egress_proxy.py"
        self._ready = False
        self._browser_process: subprocess.Popen | None = None
        self._browser_queue: queue.Queue = queue.Queue()
        self._browser_lock = threading.Lock()
        self._browser_origins: tuple[str, ...] = ()

    def _run(self, arguments: list[str], *, input: bytes | None = None,
             check: bool = True, timeout: float = 45) -> subprocess.CompletedProcess:
        try:
            result = subprocess.run(
                [*self.docker_prefix, *arguments], input=input, capture_output=True,
                timeout=timeout, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise RuntimeUnavailable("Container engine unavailable or unresponsive") from exc
        if check and result.returncode:
            detail = result.stderr.decode("utf-8", "replace")[-800:]
            detail = detail.replace(str(self.workspace), "<workspace>").replace(str(self.state_dir), "<state>")
            raise RuntimeUnavailable(f"Container operation failed: {detail}")
        return result

    def _mount_path(self, path: Path) -> str:
        value = str(path.resolve())
        if self.docker_prefix[0].lower().endswith(("wsl", "wsl.exe")):
            match = re.match(r"^([A-Za-z]):[\\/](.*)$", value)
            if match:
                return "/mnt/" + match[1].lower() + "/" + match[2].replace("\\", "/")
        return value

    def _validate_workspace(self) -> None:
        if not self.workspace.is_dir():
            raise ValueError("Task workspace does not exist")
        if self.state_dir == self.workspace or self.workspace in self.state_dir.parents:
            raise ValueError("Runtime state must be outside the task workspace")
        from ..checkpoints.paths import validate_runtime_tree
        from ..checkpoints.errors import UnsafePathError
        try:
            validate_runtime_tree(self.workspace)
        except UnsafePathError as exc:
            raise ValueError(str(exc)) from exc

    def ensure(self) -> None:
        if self._ready:
            return
        self._validate_workspace()
        self._run(["info", "--format", "{{.ServerVersion}}"])
        if self._run(["image", "inspect", self.image], check=False).returncode:
            raise RuntimeUnavailable("Runtime image is missing; run scripts/coder-runtime/prepare.ps1")
        self.state_dir.mkdir(parents=True, exist_ok=True)
        (self.state_dir / "sessions").mkdir(exist_ok=True)
        (self.state_dir / "services").mkdir(exist_ok=True)
        (self.state_dir / "artifacts").mkdir(exist_ok=True)
        if self._run(["network", "inspect", self.network], check=False).returncode:
            self._run([
                "network", "create", "--internal", "--label", f"coding-agent.owner={self.owner}",
                "--opt", "com.docker.network.bridge.gateway_mode_ipv4=isolated",
                "--opt", "com.docker.network.bridge.inhibit_ipv4=true", self.network])
        self._run(["volume", "create", "--label", f"coding-agent.owner={self.owner}", self.dependencies])
        if self.network_policy.mode == "allowlist":
            self._ensure_egress_proxy()
        # Mountpoints must exist before runc overlays a read-only source mount.
        # These empty task-private directories are not source-file changes.
        for name in ("node_modules", "dist", ".cache"):
            (self.workspace / name).mkdir(exist_ok=True)
        self._run([
            "run", "--rm", "--network", "none", "--read-only", "--cap-drop", "ALL",
            "--cap-add", "CHOWN",
            "--security-opt", "no-new-privileges:true", "--user", "0:0",
            "--label", f"coding-agent.owner={self.owner}", "--mount",
            f"type=volume,source={self.dependencies},target=/workspace/node_modules",
            self.image, "chown", "-R", "--no-dereference", "1000:1000", "/workspace/node_modules"], timeout=120)
        self._run([
            "run", "--rm", "--network", "none", "--read-only", "--cap-drop", "ALL",
            "--security-opt", "no-new-privileges:true", "--user", "1000:1000",
            "--label", f"coding-agent.owner={self.owner}", "--mount",
            f"type=volume,source={self.dependencies},target=/workspace/node_modules",
            self.image, "mkdir", "-p", "/workspace/node_modules/.vite",
            "/workspace/node_modules/.vite-temp", "/workspace/node_modules/.cache"], timeout=30)
        self._ready = True

    def _ensure_egress_proxy(self) -> None:
        if not self.proxy_path.is_file():
            raise RuntimeUnavailable("Egress proxy entrypoint is missing")
        policy_json = json.dumps(self.network_policy.allowed_hosts)
        policy_hash = hashlib.sha256(policy_json.encode()).hexdigest()
        existing = self._inspect_optional(self.proxy_container)
        if existing:
            if existing["Config"].get("Labels", {}).get("coding-agent.network-policy") != policy_hash:
                raise RuntimeUnavailable("Network policy changed; stop the task runtime before resuming")
            if not existing["State"]["Running"]:
                self._run(["start", self.proxy_container])
            return
        if self._run(["network", "inspect", self.egress_network], check=False).returncode:
            self._run(["network", "create", "--label", f"coding-agent.owner={self.owner}", self.egress_network])
        # Unlike the task containers, the proxy has no source, dependency or
        # secret mounts. Its only externally reachable sockets are policy checked.
        self._run([
            "create", "--name", self.proxy_container, "--label", f"coding-agent.owner={self.owner}",
            "--label", f"coding-agent.network-policy={policy_hash}", "--init", "--read-only",
            "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true", "--user", "1000:1000",
            "--pids-limit", "128", "--memory", "256m", "--cpus", "0.5", "--network", self.network,
            "--network-alias", "egress-proxy", "--log-driver", "json-file", "--log-opt", "max-size=1m",
            "--log-opt", "max-file=1", "--env", "AGENT_EGRESS_ALLOWED_HOSTS=" + policy_json,
            "--mount", f"type=bind,source={self._mount_path(self.proxy_path)},target=/opt/egress_proxy.py,readonly",
            self.image, "python3", "-B", "/opt/egress_proxy.py"])
        self._run(["network", "connect", self.egress_network, self.proxy_container])
        self._run(["start", self.proxy_container])

    def _container_args(self, name: str, *, writable: bool, network: str) -> list[str]:
        args = [
            "--name", name, "--label", f"coding-agent.owner={self.owner}",
            "--init", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
            "--pids-limit", "256", "--memory", "4g", "--cpus", "2", "--user", "1000:1000",
            "--network", network, "--log-driver", "json-file", "--log-opt", "max-size=2m",
            "--log-opt", "max-file=1", "--tmpfs", "/tmp:rw,nosuid,nodev,size=536870912,mode=1777",
            "--tmpfs", "/home/pwuser:rw,nosuid,nodev,size=67108864,mode=1777",
            "--mount", f"type=bind,source={self._mount_path(self.workspace)},target=/workspace" +
            ("" if writable else ",readonly"),
            "--mount", f"type=volume,source={self.dependencies},target=/workspace/node_modules" +
            ("" if writable else ",readonly"),
        ]
        if not writable:
            args += ["--tmpfs", "/workspace/.cache:rw,nosuid,nodev,size=268435456,mode=1777",
                     "--tmpfs", "/workspace/node_modules/.vite:rw,nosuid,nodev,size=268435456,mode=1777",
                     "--tmpfs", "/workspace/node_modules/.vite-temp:rw,nosuid,nodev,size=67108864,mode=1777",
                     "--tmpfs", "/workspace/node_modules/.cache:rw,nosuid,nodev,size=268435456,mode=1777"]
        if self.network_policy.mode == "allowlist" and network == self.network:
            for key in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"):
                args += ["--env", key + "=http://egress-proxy:3128"]
            # Ignore inherited image proxy bypasses. Task previews are explicitly
            # handled by the browser worker; external destinations use the proxy.
            args += ["--env", "NO_PROXY=", "--env", "no_proxy="]
        return args

    @staticmethod
    def _cwd(cwd: str) -> str:
        path = PurePosixPath(cwd.replace("\\", "/"))
        if path.is_absolute() or ".." in path.parts or ":" in str(path):
            raise ValueError("cwd must be relative to the task workspace")
        return str(PurePosixPath("/workspace") / path)

    def _record_path(self, kind: str, identity: str) -> Path:
        if not re.fullmatch(r"[a-f0-9]{24}", identity):
            raise ValueError("Invalid runtime session ID")
        return self.state_dir / kind / (identity + ".json")

    def _save(self, kind: str, identity: str, record: dict) -> None:
        path = self._record_path(kind, identity)
        TaskStore._atomic_write(path, json.dumps(record))

    def _load(self, kind: str, identity: str) -> dict:
        path = self._record_path(kind, identity)
        if not path.is_file():
            raise ValueError("Unknown runtime session")
        return json.loads(path.read_text(encoding="utf-8"))

    def _inspect_optional(self, container: str) -> dict | None:
        result = self._run(["inspect", container], check=False)
        if result.returncode:
            error = result.stderr.lower()
            if b"no such object" in error or b"no such container" in error:
                return None
            raise RuntimeUnavailable("Container state cannot be verified")
        record = json.loads(result.stdout)[0]
        if record.get("Config", {}).get("Labels", {}).get("coding-agent.owner") != self.owner:
            raise RuntimeUnavailable("Container ownership check failed")
        return record

    def _inspect(self, container: str) -> dict:
        record = self._inspect_optional(container)
        if record is None:
            raise RuntimeUnavailable("Owned runtime container is missing")
        return record

    def terminal_start(self, command: str, cwd: str = ".", timeout_seconds: float = 300) -> dict:
        workdir = self._cwd(cwd)
        if not isinstance(command, str) or not command.strip() or len(command) > 131072:
            raise ValueError("command must be a non-empty bounded string")
        if not 0 < float(timeout_seconds) <= 86400:
            raise ValueError("timeout_seconds must be between 0 and 86400")
        self.ensure()
        session = uuid.uuid4().hex[:24]
        container = self.owner + "-job-" + session
        record = {"container": container, "status": "running", "created_at": time.time()}
        network = self.network if self.network_policy.mode == "allowlist" else "none"
        self._run(["create", *self._container_args(container, writable=True, network=network),
                   "--workdir", workdir, self.image, "python3", "/opt/runtime/supervisor.py",
                   command, str(timeout_seconds)])
        self._save("sessions", session, record)
        self._run(["start", container])
        return self.terminal_poll(session, wait_ms=100)

    def terminal_poll(self, session_id: str, cursor: int = 0, wait_ms: int = 0) -> dict:
        if not isinstance(cursor, int) or cursor < 0:
            raise ValueError("cursor must be a non-negative byte offset")
        record = self._load("sessions", session_id)
        artifact = self.state_dir / "artifacts" / (session_id + ".log")
        deadline = time.monotonic() + min(max(wait_ms, 0), 10000) / 1000
        while True:
            inspected = self._inspect_optional(record["container"])
            if inspected is None:
                state = {"Running": False, "ExitCode": record.get("exit_code")}
                raw = artifact.read_bytes() if artifact.exists() else b""
                if record["status"] == "running":
                    record["status"] = "cancelled"
                    self._save("sessions", session_id, record)
                break
            state = inspected["State"]
            raw = self._run(["logs", record["container"]]).stdout[:1024 * 1024 + 256]
            if len(raw) > cursor or not state["Running"] or time.monotonic() >= deadline:
                break
            time.sleep(0.05)
        artifact.write_bytes(raw)
        status = record["status"]
        if status == "running" and not state["Running"]:
            status = "timed_out" if state["ExitCode"] == 124 else "completed"
            record["status"] = status
            record["exit_code"] = state["ExitCode"]
            self._save("sessions", session_id, record)
        fragment = raw[cursor:cursor + 32768]
        return {"session_id": session_id, "status": status,
                "exit_code": None if state["Running"] else state["ExitCode"],
                "output": fragment.decode("utf-8", "replace"), "cursor": cursor + len(fragment),
                "artifact_path": str(artifact), "output_truncated": len(raw) > cursor + len(fragment)}

    def terminal_write(self, session_id: str, data: str) -> dict:
        if len(data.encode("utf-8")) > 65536:
            raise ValueError("terminal input exceeds 64 KiB")
        record = self._load("sessions", session_id)
        if not self._inspect(record["container"])["State"]["Running"]:
            raise ValueError("Terminal session is no longer running")
        self._run(["exec", "-i", record["container"], "python3", "-c",
                   "import os,sys; f=os.open('/tmp/agent-stdin',os.O_WRONLY|os.O_NONBLOCK); "
                   "os.write(f,sys.stdin.buffer.read()); os.close(f)"], input=data.encode("utf-8"))
        return self.terminal_poll(session_id)

    def terminal_cancel(self, session_id: str) -> dict:
        record = self._load("sessions", session_id)
        inspected = self._inspect_optional(record["container"])
        if inspected is not None and inspected["State"]["Running"]:
            self._run(["kill", record["container"]])
            self._run(["wait", record["container"]])
            record["status"] = "cancelled"
            self._save("sessions", session_id, record)
        return self.terminal_poll(session_id)

    def active_writers(self) -> list[str]:
        active = []
        for path in (self.state_dir / "sessions").glob("*.json"):
            record = self._load("sessions", path.stem)
            inspected = self._inspect_optional(record["container"])
            if inspected is not None and inspected["State"]["Running"]:
                active.append(path.stem)
            elif inspected is None and record["status"] == "running":
                record["status"] = "cancelled"
                self._save("sessions", path.stem, record)
        return active

    def service_start(self, command: str, port: int = 8080, cwd: str = ".") -> dict:
        workdir = self._cwd(cwd)
        if not 1 <= port <= 65535:
            raise ValueError("Invalid service port")
        self.ensure()
        service = uuid.uuid4().hex[:24]
        alias = "service-" + service
        container = self.owner + "-" + alias
        self._run(["create", *self._container_args(container, writable=False, network=self.network),
                   "--network-alias", alias, "--workdir", workdir, self.image,
                   "python3", "/opt/runtime/supervisor.py", command, "86400"])
        result = {"service_id": service, "container": container, "url": f"http://{alias}:{port}",
                  "status": "running", "port": port}
        self._save("services", service, result)
        self._run(["start", container])
        return self.service_poll(service)

    def service_poll(self, service_id: str, cursor: int = 0) -> dict:
        if not isinstance(cursor, int) or cursor < 0:
            raise ValueError("cursor must be a non-negative byte offset")
        record = self._load("services", service_id)
        inspected = self._inspect_optional(record["container"])
        artifact = self.state_dir / "artifacts" / (service_id + ".log")
        if inspected is None:
            raw = artifact.read_bytes() if artifact.exists() else b""
            record["status"] = "stopped"
        else:
            state = inspected["State"]
            raw = self._run(["logs", record["container"]]).stdout[:1024 * 1024 + 256]
            if not state["Running"]:
                record["status"] = "stopped"
                record["exit_code"] = state["ExitCode"]
        artifact.write_bytes(raw)
        self._save("services", service_id, record)
        fragment = raw[cursor:cursor + 32768]
        return {"service_id": service_id, "status": record["status"], "url": record["url"],
                "port": record["port"], "exit_code": record.get("exit_code"),
                "output": fragment.decode("utf-8", "replace"), "cursor": cursor + len(fragment),
                "artifact_path": str(artifact), "output_truncated": len(raw) > cursor + len(fragment)}

    def service_stop(self, service_id: str) -> dict:
        record = self._load("services", service_id)
        inspected = self._inspect_optional(record["container"])
        if inspected is not None and inspected["State"]["Running"]:
            self._run(["kill", record["container"]])
            self._run(["wait", record["container"]])
        record["status"] = "stopped"
        self._save("services", service_id, record)
        return self.service_poll(service_id)

    def _close_browser(self) -> None:
        if self._browser_process:
            self._run(["rm", "-f", self.owner + "-browser"], check=False)
            try:
                self._browser_process.communicate(timeout=5)
            except subprocess.TimeoutExpired:
                self._browser_process.kill()
                self._browser_process.wait(timeout=5)
            self._browser_process = None

    def _start_browser(self) -> None:
        self.ensure()
        origins = tuple(sorted(
            json.loads(path.read_text(encoding="utf-8"))["url"]
            for path in (self.state_dir / "services").glob("*.json")
            if json.loads(path.read_text(encoding="utf-8"))["status"] == "running"))
        if not origins and self.network_policy.mode == "offline":
            raise ValueError("Start a task preview service before opening the browser")
        if self._browser_process and self._browser_process.poll() is None and origins == self._browser_origins:
            return
        self._close_browser()
        if not self.worker_path.is_file():
            raise RuntimeUnavailable("Browser worker entrypoint is missing")
        policy_path = self.worker_path.with_name("network-policy.mjs")
        if not policy_path.is_file():
            raise RuntimeUnavailable("Browser network policy module is missing")
        container = self.owner + "-browser"
        self._run(["rm", "-f", container], check=False)
        command = [*self.docker_prefix, "run", "--rm", "-i",
                   *self._container_args(container, writable=False, network=self.network),
                   "--shm-size", "256m", "--mount",
                   f"type=bind,source={self._mount_path(self.worker_path)},target=/opt/browser/worker.mjs,readonly",
                   "--mount", f"type=bind,source={self._mount_path(policy_path)},target=/opt/browser/network-policy.mjs,readonly",
                   "--env", "AGENT_BROWSER_ALLOWED_ORIGINS=" + json.dumps(origins),
                   "--env", "AGENT_BROWSER_ALLOWED_HOSTS=" + json.dumps(self.network_policy.as_dict()["allowed_hosts"]),
                   "--env", "AGENT_BROWSER_EGRESS_PROXY=" + (
                       "http://egress-proxy:3128" if self.network_policy.mode == "allowlist" else ""), self.image,
                   "node", "/opt/browser/worker.mjs"]
        self._browser_queue = queue.Queue()
        self._browser_process = subprocess.Popen(
            command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        process = self._browser_process
        responses = self._browser_queue

        def read_responses():
            assert process.stdout is not None
            for line in process.stdout:
                try:
                    responses.put(json.loads(line))
                except (ValueError, UnicodeDecodeError):
                    responses.put({"ok": False, "error": "Browser worker returned invalid JSON"})
            responses.put({"ok": False, "error": "Browser worker stopped"})

        threading.Thread(target=read_responses, daemon=True).start()
        self._browser_origins = origins

    def browser(self, payload: dict[str, Any]) -> dict:
        with self._browser_lock:
            self._start_browser()
            assert self._browser_process is not None and self._browser_process.stdin is not None
            identity = uuid.uuid4().hex
            request = {**payload, "id": identity}
            self._browser_process.stdin.write((json.dumps(request) + "\n").encode("utf-8"))
            self._browser_process.stdin.flush()
            try:
                response = self._browser_queue.get(timeout=45)
            except queue.Empty as exc:
                self._close_browser()
                raise RuntimeUnavailable("Browser operation timed out") from exc
            if response.get("id") not in (identity, None):
                self._close_browser()
                raise RuntimeUnavailable("Browser response sequence mismatch")
            return response

    def stop_all(self) -> None:
        self._ready = False
        try:
            self._close_browser()
            for path in (self.state_dir / "sessions").glob("*.json"):
                record = self._load("sessions", path.stem)
                if record["status"] == "running":
                    self.terminal_cancel(path.stem)
            for path in (self.state_dir / "services").glob("*.json"):
                record = self._load("services", path.stem)
                if record["status"] == "running":
                    self.service_stop(path.stem)
        finally:
            # A cancelled job's record may still be locked on Windows. Always
            # stop every owned container, including any without saved metadata.
            # Keep engine failures visible: callers must not seal live writers.
            result = self._run(["ps", "-aq", "--filter", f"label=coding-agent.owner={self.owner}"])
            containers = result.stdout.decode().split()
            if containers:
                self._run(["rm", "-f", *containers])
        for path in (self.state_dir / "sessions").glob("*.json"):
            record = self._load("sessions", path.stem)
            if record["status"] == "running":
                record["status"] = "cancelled"
                self._save("sessions", path.stem, record)
        for path in (self.state_dir / "services").glob("*.json"):
            record = self._load("services", path.stem)
            record["status"] = "stopped"
            self._save("services", path.stem, record)
        self._run(["network", "rm", self.network], check=False)
        self._run(["network", "rm", self.egress_network], check=False)
        self._run(["volume", "rm", self.dependencies], check=False)
