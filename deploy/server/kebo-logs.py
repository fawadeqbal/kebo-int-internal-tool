#!/usr/bin/env python3
"""
RFQ Desk: the live logs for the platform admin's Dev tools. Runs all the time (kebo-logs.service,
installed by deploy/server/install.sh, as root). Standard library only.

Follows the log of every RFQ Desk container (and the address server, Caddy) and writes each
service's lines to <KEBO_LOGS_DIR>/<service>.log (default /opt/kebo-desk/logs/live, mounted
read-only into the API as /server-logs). A file over 5 MB moves to <service>.log.1 (one kept).
New containers (after a deploy) are picked up within 5 seconds, from where the file ends.
"""
import os
import re
import subprocess
import threading
import time

APP_DIR = os.environ.get("KEBO_DESK_DIR", "/opt/kebo-desk")
OUT = os.environ.get("KEBO_LOGS_DIR", os.path.join(APP_DIR, "logs", "live"))
PROXY = os.environ.get("KEBO_PROXY_CONTAINER", "global-caddy")
MAX_BYTES = 5 * 1024 * 1024
TS = re.compile(r"^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z) ")

locks = {}
followed = {}
started = time.time()


def run(cmd):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=20).stdout
    except Exception:
        return ""


def containers():
    """{container id: service name} for this app's containers and the address server."""
    out = {}
    fmt = '{{.ID}} {{.Label "com.docker.compose.service"}} {{.Label "com.docker.compose.oneoff"}}'
    for line in run(["docker", "ps", "--filter", f"label=com.docker.compose.project.working_dir={APP_DIR}", "--format", fmt]).splitlines():
        parts = line.split()
        if len(parts) >= 2 and (len(parts) < 3 or parts[2] != "True"):
            out[parts[0]] = parts[1]
    for line in run(["docker", "ps", "-q", "--filter", f"name=^{PROXY}$"]).split():
        out[line] = "proxy"
    return out


def last_time(path):
    """The time of the last line already written, so a restart of this relay does not repeat lines."""
    try:
        with open(path, "rb") as f:
            f.seek(max(0, os.path.getsize(path) - 4096))
            for line in reversed(f.read().decode("utf-8", "replace").splitlines()):
                m = TS.match(line)
                if m:
                    return m.group(1)
    except OSError:
        pass
    return None


def write(service, line):
    path = os.path.join(OUT, f"{service}.log")
    lock = locks.setdefault(service, threading.Lock())
    with lock:
        try:
            if os.path.getsize(path) > MAX_BYTES:
                os.replace(path, path + ".1")
        except OSError:
            pass
        with open(path, "a", encoding="utf-8") as f:
            f.write(line if line.endswith("\n") else line + "\n")


def follow(cid, service, first):
    path = os.path.join(OUT, f"{service}.log")
    since = last_time(path)
    cmd = ["docker", "logs", "-f", "--timestamps"]
    if since:
        cmd += ["--since", since]  # from where the file ends (a new container after a deploy, or this relay restarted)
    elif first:
        cmd += ["--tail", "300"]  # the first run: the last lines only
    cmd.append(cid)
    try:
        p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors="replace", bufsize=1)
        for line in p.stdout:
            m = TS.match(line)
            if since and m and m.group(1) <= since:
                continue
            write(service, line)
        p.wait()
    finally:
        followed.pop(cid, None)


def main():
    os.makedirs(OUT, exist_ok=True)
    os.chmod(OUT, 0o755)
    first = True
    while True:
        for cid, service in containers().items():
            if cid in followed or not re.match(r"^[A-Za-z0-9_.-]{1,40}$", service):
                continue
            followed[cid] = service
            threading.Thread(target=follow, args=(cid, service, first), daemon=True).start()
        first = False
        time.sleep(5)


if __name__ == "__main__":
    main()
