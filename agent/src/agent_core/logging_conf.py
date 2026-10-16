"""Tiny logging setup; replaced by structured/tracing logging in M5/M6."""

import logging

# Third-party libraries that log one line per request at INFO; keep them at
# WARNING so CLI output stays readable. Set them to DEBUG to inspect wire-level
# details when troubleshooting.
_NOISY_LOGGERS = ("httpx", "httpcore")


def setup_logging(level: str = "INFO") -> None:
    root_level = getattr(logging, level.upper(), logging.INFO)
    logging.basicConfig(
        level=root_level,
        format="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
    )
    for name in _NOISY_LOGGERS:
        logging.getLogger(name).setLevel(logging.WARNING)
    # Keep our own package at the explicitly requested level.
    logging.getLogger("agent_core").setLevel(root_level)

