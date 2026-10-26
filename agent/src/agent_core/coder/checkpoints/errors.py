"""Failures callers can report without silently changing the workspace."""


class CheckpointError(RuntimeError):
    """Base checkpoint failure."""


class BusyError(CheckpointError):
    """Another mutation owns the workspace, or recovery is required."""


class ConflictError(CheckpointError):
    """The current workspace no longer satisfies an operation's preconditions."""


class IntegrityError(CheckpointError):
    """Stored checkpoint data is missing, malformed, or corrupted."""


class UnsafePathError(CheckpointError):
    """A path cannot safely be represented or traversed."""
