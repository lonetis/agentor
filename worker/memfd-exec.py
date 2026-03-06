#!/usr/bin/env python3
"""Execute a script from stdin via memfd_create (no temp files on disk).

Supports any shebang (#!/bin/bash, #!/usr/bin/env python3, etc.) — the kernel
reads the shebang from the memfd. Scripts without a shebang default to bash.
Empty/whitespace-only input exits 0 (no-op).
"""
import sys, os, ctypes

libc = ctypes.CDLL("libc.so.6")
fd = libc.memfd_create(b"script", 0)
if fd < 0:
    sys.exit(1)

script = sys.stdin.buffer.read()
if not script.strip():
    sys.exit(0)

os.write(fd, script)
path = f"/proc/self/fd/{fd}"
os.chmod(path, 0o700)

# Restore stdin to the real terminal so interactive programs (CLIs) work.
# stdin was consumed by the pipe; reopen /dev/tty as fd 0.
try:
    tty_fd = os.open("/dev/tty", os.O_RDWR)
    os.dup2(tty_fd, 0)
    os.close(tty_fd)
except OSError:
    pass  # no TTY available (non-interactive context)

if script.startswith(b"#!"):
    os.execv(path, [path] + sys.argv[1:])
else:
    os.execv("/bin/bash", ["bash", path] + sys.argv[1:])
