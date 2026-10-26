"""Operator-owned public HTTP(S) allowlist; task code cannot widen it."""
from __future__ import annotations

import ipaddress
import re
from dataclasses import dataclass

DEFAULT_ALLOWED_HOSTS = (
    "registry.npmjs.org", "pypi.org", "files.pythonhosted.org", "github.com", "api.github.com",
    "raw.githubusercontent.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com",
    "nodejs.org", "docs.python.org", "developer.mozilla.org", "react.dev", "vite.dev",
    "typescriptlang.org", "www.typescriptlang.org", "docs.npmjs.com", "developer.chrome.com", "playwright.dev",
)


@dataclass(frozen=True)
class NetworkPolicy:
    mode: str = "offline"
    allowed_hosts: tuple[str, ...] = DEFAULT_ALLOWED_HOSTS

    def __post_init__(self) -> None:
        if self.mode not in ("offline", "allowlist"):
            raise ValueError("Network mode must be offline or allowlist")
        if isinstance(self.allowed_hosts, str) or len(self.allowed_hosts) > 200:
            raise ValueError("allowed_hosts must contain at most 200 domain patterns")
        normalized = []
        for value in self.allowed_hosts:
            if not isinstance(value, str):
                raise ValueError("Network allowlist entries must be domain names")
            pattern = value.lower().strip().rstrip(".")
            host = pattern[2:] if pattern.startswith("*.") else pattern
            if (len(host) > 253 or "." not in host or not re.fullmatch(
                    r"[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+", host)
                    or any(len(label) > 63 for label in host.split("."))
                    or host.endswith((".localhost", ".local", ".internal", ".test", ".invalid"))):
                raise ValueError("Network allowlist entries must be public domain names")
            try:
                ipaddress.ip_address(host)
            except ValueError:
                pass
            else:
                raise ValueError("Network allowlist cannot contain IP literals")
            normalized.append(pattern)
        object.__setattr__(self, "allowed_hosts", tuple(dict.fromkeys(normalized)))

    def allows_host(self, hostname: str) -> bool:
        host = hostname.lower().rstrip(".")
        return self.mode == "allowlist" and any(
            host.endswith(pattern[1:]) if pattern.startswith("*.") else host == pattern
            for pattern in self.allowed_hosts)

    def as_dict(self) -> dict:
        return {"mode": self.mode, "allowed_hosts": list(self.allowed_hosts) if self.mode == "allowlist" else []}
