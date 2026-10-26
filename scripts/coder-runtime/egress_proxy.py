"""Source-free container proxy: public DNS pinning, explicit host/port allowlist.

Task containers only join an internal Docker network. Only this process joins an
egress network. Connect to validated sockaddr values, never resolve a second time
after validation: this closes DNS rebinding between policy and socket creation.
"""
from __future__ import annotations

import ipaddress
import json
import os
import select
import socket
import socketserver
import time
from urllib.parse import urlsplit

MAX_HEADER_BYTES = 65536
IDLE_TIMEOUT = 60
MAX_CONNECTION_SECONDS = 600


def resolve_public(hostname: str, port: int, allowed_hosts: tuple[str, ...]) -> list[tuple]:
    host = hostname.lower().rstrip(".")
    if not any(host.endswith(pattern[1:]) if pattern.startswith("*.") else host == pattern
               for pattern in allowed_hosts):
        raise ValueError("Destination is outside the network allowlist")
    if port not in (80, 443):
        raise ValueError("Destination port must be 80 or 443")
    addresses = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    if not addresses:
        raise ValueError("Destination has no public address")
    for _, _, _, _, address in addresses:
        ip = ipaddress.ip_address(address[0])
        if not ip.is_global or ip.is_multicast or ip.is_unspecified or ip.is_reserved:
            raise ValueError("Destination must resolve exclusively to public addresses")
        if isinstance(ip, ipaddress.IPv6Address) and (ip.ipv4_mapped or ip.sixtofour or ip.teredo):
            raise ValueError("IPv6 transition addresses are not public egress targets")
    return addresses


def connect_public(hostname: str, port: int, allowed_hosts: tuple[str, ...]) -> socket.socket:
    addresses = resolve_public(hostname, port, allowed_hosts)
    for family, kind, protocol, _, address in addresses:
        upstream = socket.socket(family, kind, protocol)
        upstream.settimeout(15)
        try:
            upstream.connect(address)
            return upstream
        except OSError:
            upstream.close()
    raise OSError("Public destination is unavailable")


class ProxyHandler(socketserver.BaseRequestHandler):
    def handle(self) -> None:
        upstream = None
        self.request.settimeout(15)
        try:
            header, remainder = self.read_header()
            method, target, version = header[0].split(" ")
            if version not in ("HTTP/1.0", "HTTP/1.1"):
                raise ValueError("Unsupported proxy protocol")
            if method == "CONNECT":
                parsed = urlsplit("https://" + target)
                if parsed.path or parsed.query or parsed.fragment or parsed.port != 443:
                    raise ValueError("CONNECT requires a host and port 443")
            else:
                parsed = urlsplit(target)
                if parsed.scheme != "http" or parsed.fragment or parsed.port not in (None, 80):
                    raise ValueError("HTTP proxy requests require an absolute HTTP URL on port 80")
            if not parsed.hostname or parsed.username or parsed.password:
                raise ValueError("Destination must not contain credentials")
            port = 443 if method == "CONNECT" else 80
            upstream = connect_public(parsed.hostname, port, self.server.allowed_hosts)
            if method == "CONNECT":
                self.request.sendall(b"HTTP/1.1 200 Connection Established\r\n\r\n")
            else:
                path = parsed.path or "/"
                if parsed.query:
                    path += "?" + parsed.query
                fields = []
                for line in header[1:]:
                    name, separator, value = line.partition(":")
                    if not separator or name[:1].isspace():
                        raise ValueError("Invalid HTTP header")
                    if name.lower() not in ("host", "proxy-connection", "proxy-authorization", "connection"):
                        fields.append(name + ":" + value)
                fields += ["Host: " + parsed.netloc, "Connection: close"]
                upstream.sendall((f"{method} {path} HTTP/1.1\r\n" + "\r\n".join(fields)
                                  + "\r\n\r\n").encode("iso-8859-1"))
            if remainder:
                upstream.sendall(remainder)
            self.relay(upstream)
        except (ValueError, UnicodeError, OSError) as exc:
            # No URL paths, headers, response bodies or credentials enter logs.
            try:
                message = str(exc).encode("utf-8")[:200]
                self.request.sendall(b"HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: "
                                     + str(len(message)).encode() + b"\r\n\r\n" + message)
            except OSError:
                pass
        finally:
            if upstream is not None:
                upstream.close()

    def read_header(self) -> tuple[list[str], bytes]:
        data = b""
        while b"\r\n\r\n" not in data:
            chunk = self.request.recv(4096)
            if not chunk:
                raise ValueError("Incomplete proxy request")
            data += chunk
            if len(data) > MAX_HEADER_BYTES:
                raise ValueError("Proxy request headers exceed 64 KiB")
        header, remainder = data.split(b"\r\n\r\n", 1)
        return header.decode("iso-8859-1").split("\r\n"), remainder

    def relay(self, upstream: socket.socket) -> None:
        sockets = [self.request, upstream]
        deadline = time.monotonic() + MAX_CONNECTION_SECONDS
        while time.monotonic() < deadline:
            ready, _, _ = select.select(sockets, [], [], IDLE_TIMEOUT)
            if not ready:
                return
            for source in ready:
                data = source.recv(65536)
                if not data:
                    return
                (upstream if source is self.request else self.request).sendall(data)


class ProxyServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True
    request_queue_size = 64


if __name__ == "__main__":
    hosts = json.loads(os.environ.get("AGENT_EGRESS_ALLOWED_HOSTS", "[]"))
    if not isinstance(hosts, list) or any(not isinstance(host, str) for host in hosts):
        raise ValueError("AGENT_EGRESS_ALLOWED_HOSTS must be a JSON string array")
    with ProxyServer(("0.0.0.0", 3128), ProxyHandler) as server:
        server.allowed_hosts = tuple(hosts)
        server.serve_forever()
