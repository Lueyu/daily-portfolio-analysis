"""Unprivileged container entrypoint; hold the job until all descendants exit."""
import ctypes
import os
import selectors
import signal
import subprocess
import sys
import time

OUTPUT_LIMIT = 1024 * 1024
FIFO = "/tmp/agent-stdin"


def children():
    result = []
    for name in os.listdir("/proc"):
        if not name.isdigit() or int(name) in (1, os.getpid()):
            continue
        try:
            # Zombies cannot write; still reap adopted children below.
            if open(f"/proc/{name}/stat").read().rsplit(")", 1)[1].split()[0] != "Z":
                result.append(int(name))
        except (OSError, IndexError):
            pass
    return result


def main():
    ctypes.CDLL(None).prctl(36, 1, 0, 0, 0)  # PR_SET_CHILD_SUBREAPER
    os.makedirs(os.environ["HOME"], exist_ok=True)
    os.mkfifo(FIFO, 0o600)
    fifo = os.open(FIFO, os.O_RDWR | os.O_NONBLOCK)
    # The child's reads must block while docker exec supplies later input.
    os.set_blocking(fifo, True)
    child = subprocess.Popen(
        ["/bin/sh", "-lc", sys.argv[1]], stdin=fifo,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)
    assert child.stdout is not None
    os.set_blocking(child.stdout.fileno(), False)
    selector = selectors.DefaultSelector()
    selector.register(child.stdout, selectors.EVENT_READ)
    deadline = time.monotonic() + float(sys.argv[2])
    written = 0
    timed_out = False
    while True:
        for key, _ in selector.select(0.05):
            data = os.read(key.fileobj.fileno(), 65536)
            if not data:
                selector.unregister(key.fileobj)
                continue
            if written < OUTPUT_LIMIT:
                fragment = data[:OUTPUT_LIMIT - written]
                sys.stdout.buffer.write(fragment)
                sys.stdout.buffer.flush()
                written += len(fragment)
                if written == OUTPUT_LIMIT:
                    print("\n[output capped at 1 MiB; process continues]", flush=True)
        returncode = child.poll()
        if returncode is not None:
            while True:
                try:
                    pid, _ = os.waitpid(-1, os.WNOHANG)
                    if pid == 0:
                        break
                except ChildProcessError:
                    break
        remaining = children()
        if returncode is not None and not remaining and not selector.get_map():
            break
        if time.monotonic() >= deadline:
            timed_out = True
            for pid in remaining:
                try:
                    os.kill(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
        if timed_out and returncode is not None and not remaining:
            break
    os.close(fifo)
    return 124 if timed_out else (child.returncode or 0)


if __name__ == "__main__":
    raise SystemExit(main())
