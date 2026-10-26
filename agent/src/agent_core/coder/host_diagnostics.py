"""Fixed, read-only observations of the operator's local app, outside the sandbox.

Never accept model-selected addresses, commands, files or request headers. Host
observations describe the main checkout and cannot verify a sandbox candidate.
"""
from __future__ import annotations

import base64
import ipaddress
import json
import os
import shutil
import socket
import subprocess
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from dotenv import dotenv_values

from .checkpoints.paths import reject_link_ancestors
from .checkpoints.errors import UnsafePathError

API_PATHS = {
    "holdings": "/api/portfolio/holdings",
    "dashboard": "/api/portfolio/dashboard/overview",
}
MAX_RESPONSE_BYTES = 1_000_000
ENV_FIELDS = {
    "database": "SUDA_DATABASE_URL", "localIdentity": "LOCAL_DEV_USER_ID",
    "platformIdentity": "SUDA_WEBUSER", "platformBase": "MIAODA_DEV_PLATFORM_BASE",
    "skipDatabaseInitialization": "DEPRECATED_SKIP_INIT_DB_CONNECTION",
    "disableDatapass": "FORCE_FRAMEWORK_DISABLE_DATAPASS",
}


def _loopback_host(host: str) -> str:
    if host.lower() == "localhost":
        return "127.0.0.1"  # Pin the target; never resolve a configurable DNS name.
    try:
        address = ipaddress.ip_address(host)
        if address.is_loopback:
            return str(address)
    except ValueError:
        pass
    raise ValueError("Host inspection targets must be loopback addresses")


def _origin(value: str) -> tuple[str, str, int]:
    try:
        parsed = urlsplit(value)
        if (parsed.scheme not in ("http", "https") or parsed.username is not None
                or parsed.password is not None or parsed.query or parsed.fragment
                or parsed.path not in ("", "/")):
            raise ValueError()
        host = _loopback_host(parsed.hostname or "")
        port = parsed.port if parsed.port is not None else (443 if parsed.scheme == "https" else 80)
        if not 1 <= port <= 65535:
            raise ValueError()
        authority = f"[{host}]" if ":" in host else host
        return f"{parsed.scheme}://{authority}:{port}", host, port
    except (ValueError, TypeError, AttributeError):
        raise ValueError("Host inspection requires credential-free loopback HTTP(S) origins") from None


def environment_summary(project_root: Path) -> dict:
    values, sources, files = {}, {}, {}
    for name, label in ((".env", "project_env"), (".env.local", "project_env_local")):
        path = Path(project_root) / name
        files[label] = "missing"
        try:
            if not path.exists():
                continue
            reject_link_ancestors(path)
            if not path.is_file() or path.stat().st_size > MAX_RESPONSE_BYTES:
                files[label] = "not_read"
                continue
            parsed = dotenv_values(path, interpolate=False)
            files[label] = "loaded"
            for key in ENV_FIELDS.values():
                if key in parsed:
                    values[key], sources[key] = parsed[key] or "", label
        except (OSError, ValueError, UnsafePathError):
            files[label] = "not_read"
    for key in ENV_FIELDS.values():
        if key in os.environ:
            values[key], sources[key] = os.environ[key], "process"
    result = {"files": files}
    for label, key in ENV_FIELDS.items():
        value = values.get(key, "")
        item = {"configured": bool(value), "source": sources.get(key, "unset")}
        if label == "database":
            item["targetKind"] = "unset"
            if value:
                try:
                    host = urlsplit(value).hostname
                    if not host:
                        raise ValueError()
                    try:
                        _loopback_host(host)
                        item["targetKind"] = "loopback"
                    except ValueError:
                        item["targetKind"] = "remote"
                except ValueError:
                    item["targetKind"] = "invalid"
        elif label in ("skipDatabaseInitialization", "disableDatapass"):
            item["enabled"] = value.strip().lower() in ("1", "true", "yes")
        result[label] = item
    result["note"] = "Configuration observed by this inspector; a previously started server may use older values."
    return result


def _tcp(host: str, port: int, timeout: float) -> dict:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return {"listening": True, "errorCategory": None}
    except ConnectionRefusedError:
        return {"listening": False, "errorCategory": "connection_refused"}
    except (TimeoutError, socket.timeout):
        return {"listening": False, "errorCategory": "timeout"}
    except OSError:
        return {"listening": False, "errorCategory": "connection_error"}


def _error_category(status: int, body: bytes) -> str | None:
    if 300 <= status < 400:
        return "redirect_blocked"
    if status in (401, 403):
        return "authentication_or_authorization"
    if status < 400:
        return None
    text = body.lower()
    if b"econnrefused" in text or b"connection refused" in text:
        return "connection_refused"
    if b"timeout" in text or b"timed out" in text:
        return "timeout"
    if b"does not exist" in text or b"undefined_table" in text:
        return "schema_or_relation_missing"
    return "server_error" if status >= 500 else "request_error"


def _api(client: httpx.Client, origin: str, path: str) -> dict:
    try:
        with client.stream("GET", origin + path, headers={"Accept": "application/json"}) as response:
            result = {"path": path, "status": response.status_code}
            body = bytearray()
            if 300 <= response.status_code < 400:
                return {**result, "errorCategory": "redirect_blocked"}
            for chunk in response.iter_bytes():
                body.extend(chunk)
                if len(body) > MAX_RESPONSE_BYTES:
                    return {**result, "errorCategory": "response_too_large", "dataShape": "not_inspected"}
            result["errorCategory"] = _error_category(response.status_code, body)
            try:
                data = json.loads(body)
                result["dataShape"] = "array" if isinstance(data, list) else "object" if isinstance(data, dict) else "scalar"
                items = data if isinstance(data, list) else data.get("items") if isinstance(data, dict) else None
                if isinstance(items, list):
                    result["itemCount"] = len(items)
            except (ValueError, UnicodeDecodeError):
                result["dataShape"] = "not_json"
            return result
    except httpx.TimeoutException:
        return {"path": path, "status": None, "errorCategory": "timeout"}
    except httpx.HTTPError:
        return {"path": path, "status": None, "errorCategory": "connection_error"}


def _browser(origin: str, artifacts_dir: Path) -> dict:
    node = shutil.which("node")
    helper = Path(__file__).resolve().parents[4] / "scripts" / "coder-browser" / "host-inspect.cjs"
    if not node or not helper.is_file():
        return {"ok": False, "errorCategory": "browser_unavailable"}
    # Do not leak service credentials or allow NODE_OPTIONS/NODE_PATH injection.
    allowed = {"path", "systemroot", "windir", "temp", "tmp", "userprofile", "home",
               "localappdata", "appdata", "playwright_browsers_path"}
    env = {key: value for key, value in os.environ.items() if key.lower() in allowed}
    try:
        process = subprocess.run([node, str(helper)], input=json.dumps({"origin": origin}),
            text=True, encoding="utf-8", capture_output=True, timeout=40, cwd=helper.parent,
            env=env, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        if process.returncode or len(process.stdout) > 12_000_000:
            return {"ok": False, "errorCategory": "browser_failed"}
        result = json.loads(process.stdout)
        encoded = result.pop("base64", None)
        if encoded:
            data = base64.b64decode(encoded, validate=True)
            if not data.startswith(b"\x89PNG\r\n\x1a\n") or len(data) > 8_000_000:
                raise ValueError()
            reject_link_ancestors(artifacts_dir)
            artifacts_dir.mkdir(parents=True, exist_ok=True)
            identity = uuid.uuid4().hex
            (artifacts_dir / (identity + ".png")).write_bytes(data)
            result["artifact_id"] = identity
            result["image_sent_to_model"] = False
        return result
    except subprocess.TimeoutExpired:
        return {"ok": False, "errorCategory": "browser_timeout"}
    except (OSError, ValueError, TypeError, UnsafePathError):
        return {"ok": False, "errorCategory": "browser_failed"}


def inspect_local_app(settings, project_root: Path, artifacts_dir: Path, *, capture_browser=True) -> dict:
    """Observe only configured loopback targets. No supplied auth, writes or SQL."""
    if settings is None:
        raise ValueError("Host inspection requires operator settings")
    backend, backend_host, backend_port = _origin(settings.probe_backend_url)
    frontend, frontend_host, frontend_port = _origin(settings.probe_frontend_url)
    pg_host = _loopback_host(settings.probe_pg_host)
    pg_port = int(settings.probe_pg_port)
    if not 1 <= pg_port <= 65535:
        raise ValueError("Host inspection port is outside the valid range")
    timeout = min(5.0, max(0.2, float(settings.probe_timeout_seconds)))
    result = {
        "scope": "host_main", "countsAsVerification": False,
        "observedAt": datetime.now(timezone.utc).isoformat(),
        "notice": "只读观察本机主项目，未运行沙箱候选修改；不能作为候选版本验收通过的证据。",
        "environment": environment_summary(project_root),
        "tcp": {"postgres": _tcp(pg_host, pg_port, timeout),
                "backend": _tcp(backend_host, backend_port, timeout),
                "frontend": _tcp(frontend_host, frontend_port, timeout)},
    }
    with httpx.Client(timeout=timeout, trust_env=False, follow_redirects=False) as client:
        result["api"] = {name: _api(client, backend, path) for name, path in API_PATHS.items()}
    result["browser"] = (_browser(frontend, artifacts_dir) if capture_browser else {"requested": False})
    if result["browser"].get("artifact_id"):
        result["artifact_id"] = result["browser"]["artifact_id"]
    return result
