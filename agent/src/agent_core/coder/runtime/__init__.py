"""Actual container execution; never falls back to a host shell."""
from .container import ContainerRuntime, RuntimeUnavailable
from .network import DEFAULT_ALLOWED_HOSTS, NetworkPolicy

__all__ = ["ContainerRuntime", "RuntimeUnavailable", "NetworkPolicy", "DEFAULT_ALLOWED_HOSTS"]
