#!/usr/bin/env python3
"""
RFQ Desk: the server's status for the platform admin's Dev tools. Run every minute by
kebo-status.timer (installed by deploy/server/install.sh, as root). Standard library only.

Writes into <KEBO_STATUS_DIR> (default /opt/kebo-desk/backups/status, mounted read-only into the
API and the worker as /server-status):
  server.json      CPU, memory, disk, each container (state, restarts, CPU, memory), open ports,
                   firewall, security updates, certificates: what Dev tools shows
  history.jsonl    one line a minute (CPU, memory, disk, the API answering), the last 7 days
  disk-days.jsonl  one line a day (disk used), the last 120 days
  events.jsonl     a container restarted or stopped (with why), the last 2000
The app is never given the Docker socket: this script reads Docker and writes plain files.
"""
import datetime as dt
import glob
import json
import os
import re
import shutil
import socket
import ssl
import subprocess
import time
import urllib.request

APP_DIR = os.environ.get("KEBO_DESK_DIR", "/opt/kebo-desk")
OUT = os.environ.get("KEBO_STATUS_DIR", os.path.join(APP_DIR, "backups", "status"))
PROXY = os.environ.get("KEBO_PROXY_CONTAINER", "global-caddy")
STATE = os.path.join(OUT, ".status-state.json")
NOW = time.time()


def iso(t=None):
    return dt.datetime.fromtimestamp(t if t is not None else NOW, dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def run(cmd, timeout=20):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return r.stdout if r.returncode == 0 else ""
    except Exception:
        return ""


def read(path, default=None):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return default


def write(name, value):
    tmp = os.path.join(OUT, f".{name}.tmp")
    with open(tmp, "w") as f:
        json.dump(value, f, separators=(",", ":"))
    os.chmod(tmp, 0o644)
    os.replace(tmp, os.path.join(OUT, name))


def append(name, rows, keep):
    """Adds lines to a .jsonl file and keeps only its last `keep` lines."""
    path = os.path.join(OUT, name)
    lines = []
    try:
        with open(path) as f:
            lines = f.read().splitlines()
    except FileNotFoundError:
        pass
    lines += [json.dumps(r, separators=(",", ":")) for r in rows]
    tmp = os.path.join(OUT, f".{name}.tmp")
    with open(tmp, "w") as f:
        f.write("\n".join(lines[-keep:]) + "\n")
    os.chmod(tmp, 0o644)
    os.replace(tmp, path)


def older_than(name, seconds):
    try:
        return NOW - os.path.getmtime(os.path.join(OUT, name)) > seconds
    except OSError:
        return True


# ---------------------------------------------------------------- the machine


def cpu_percent():
    def sample():
        with open("/proc/stat") as f:
            v = [int(x) for x in f.readline().split()[1:]]
        idle = v[3] + (v[4] if len(v) > 4 else 0)
        return idle, sum(v)

    try:
        i1, t1 = sample()
        time.sleep(1)
        i2, t2 = sample()
        return round(100 * (1 - (i2 - i1) / max(1, t2 - t1)), 1)
    except Exception:
        return None


def memory():
    m = {}
    try:
        with open("/proc/meminfo") as f:
            for line in f:
                k, v = line.split(":", 1)
                m[k] = int(v.split()[0]) // 1024
    except Exception:
        return None
    total, avail = m.get("MemTotal", 0), m.get("MemAvailable", 0)
    return {"totalMb": total, "usedMb": total - avail, "percent": round(100 * (total - avail) / max(1, total), 1)}


def disk():
    u = shutil.disk_usage("/")
    gb = 1024**3
    return {"totalGb": round(u.total / gb, 1), "usedGb": round(u.used / gb, 1), "freeGb": round(u.free / gb, 1), "percent": round(100 * u.used / max(1, u.used + u.free), 1)}  # as df: of what can be used


def host():
    name = ""
    try:
        with open("/etc/os-release") as f:
            name = next((l.split("=", 1)[1].strip().strip('"') for l in f if l.startswith("PRETTY_NAME=")), "")
    except Exception:
        pass
    try:
        with open("/proc/uptime") as f:
            up = int(float(f.read().split()[0]))
    except Exception:
        up = None
    return {"os": name, "uptimeSec": up, "docker": run(["docker", "version", "--format", "{{.Server.Version}}"]).strip() or None, "cores": os.cpu_count()}


# ---------------------------------------------------------------- the containers

ROLE = {"proxy": "proxy"}


def size_mb(text):
    m = re.match(r"([\d.]+)\s*([KMGT]?i?B)", text.strip())
    if not m:
        return None
    n, unit = float(m.group(1)), m.group(2).upper().replace("I", "")
    return round(n * {"B": 1 / 1024**2, "KB": 1 / 1024, "MB": 1, "GB": 1024, "TB": 1024**2}.get(unit, 1), 1)


def containers():
    ids = run(["docker", "ps", "-aq", "--filter", f"label=com.docker.compose.project.working_dir={APP_DIR}", "--filter", "label=com.docker.compose.oneoff=False"]).split()
    ids += run(["docker", "ps", "-aq", "--filter", f"name=^{PROXY}$"]).split()
    if not ids:
        return [], None
    try:
        info = json.loads(run(["docker", "inspect", *ids]) or "[]")
    except ValueError:
        info = []
    stats = {}
    running = [c["Id"][:12] for c in info if c.get("State", {}).get("Running")]
    if running:
        for line in run(["docker", "stats", "--no-stream", "--format", "{{json .}}", *running], timeout=30).splitlines():
            try:
                s = json.loads(line)
            except ValueError:
                continue
            used = (s.get("MemUsage") or "").split("/")[0]
            stats[s.get("ID", "")[:12]] = {"cpu": float((s.get("CPUPerc") or "0").rstrip("%") or 0), "memMb": size_mb(used) if used else None}
    project = None
    out = []
    for c in info:
        labels = c.get("Config", {}).get("Labels") or {}
        name = labels.get("com.docker.compose.service") or ("proxy" if c.get("Name", "").lstrip("/") == PROXY else c.get("Name", "").lstrip("/"))
        project = project or labels.get("com.docker.compose.project")
        st = c.get("State", {})
        s = stats.get(c["Id"][:12], {})
        limit = c.get("HostConfig", {}).get("Memory") or 0
        out.append(
            {
                "name": name,
                "id": c["Id"][:12],
                "state": st.get("Status"),
                "health": (st.get("Health") or {}).get("Status"),
                "startedAt": st.get("StartedAt"),
                "restarts": c.get("RestartCount", 0),
                "oomKilled": bool(st.get("OOMKilled")),
                "exitCode": st.get("ExitCode"),
                "image": c.get("Config", {}).get("Image"),
                "cpu": s.get("cpu"),
                "memMb": s.get("memMb"),
                "memLimitMb": round(limit / 1024**2) if limit else None,
            }
        )
    out.sort(key=lambda x: x["name"])
    return out, project


def events_from(services):
    """What changed since the last minute: a container restarted (same container, new start) or stopped."""
    before = read(STATE, {}) or {}
    now = {}
    events = []
    for s in services:
        now[s["name"]] = {"id": s["id"], "startedAt": s["startedAt"], "state": s["state"]}
        b = before.get(s["name"])
        if not b:
            continue
        if b["id"] == s["id"] and b["startedAt"] != s["startedAt"] and s["state"] == "running":
            why = "out of memory" if s["oomKilled"] else (f"stopped with code {s['exitCode']}" if s["exitCode"] else "restarted")
            events.append({"at": iso(), "service": s["name"], "kind": "restarted", "why": why})
        elif b["id"] != s["id"]:
            events.append({"at": iso(), "service": s["name"], "kind": "replaced", "why": "new version"})
        if b.get("state") == "running" and s["state"] != "running":
            why = "out of memory" if s["oomKilled"] else f"code {s['exitCode']}"
            events.append({"at": iso(), "service": s["name"], "kind": "stopped", "why": why})
    for name, b in before.items():
        if name not in now and b.get("state") == "running":
            events.append({"at": iso(), "service": name, "kind": "stopped", "why": "removed"})
    tmp = STATE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(now, f)
    os.replace(tmp, STATE)
    return events


# ---------------------------------------------------------------- what uses the disk (hourly)


def du_gb(path):
    out = run(["du", "-sb", path], timeout=120).split()
    return round(int(out[0]) / 1024**3, 2) if out else 0


def space(project):
    gb = 1024**3
    rows = {}
    for line in run(["docker", "system", "df", "--format", "{{json .}}"], timeout=120).splitlines():
        try:
            r = json.loads(line)
        except ValueError:
            continue
        mb = size_mb(r.get("Size", "0B")) or 0
        rows[r.get("Type")] = round(mb / 1024, 2)
    vol = lambda name: run(["docker", "volume", "inspect", "-f", "{{.Mountpoint}}", f"{project}_{name}"]).strip() if project else ""
    pg, files = vol("pgdata"), vol("files")
    db_gb = du_gb(pg) if pg else 0
    files_gb = du_gb(files) if files else 0
    logs = sum(os.path.getsize(p) for p in glob.glob("/var/lib/docker/containers/*/*-json.log*") if os.path.isfile(p)) / gb + du_gb("/var/log") + du_gb(os.path.join(APP_DIR, "logs"))
    parts = [
        {"key": "images", "label": "Docker images", "gb": rows.get("Images", 0)},
        {"key": "cache", "label": "Build cache", "gb": rows.get("Build Cache", 0)},
        {"key": "backups", "label": "Backups", "gb": du_gb(os.path.join(APP_DIR, "backups"))},
        {"key": "files", "label": "Uploaded files", "gb": files_gb},
        {"key": "database", "label": "Database", "gb": db_gb},
        {"key": "logs", "label": "Logs", "gb": round(logs, 2)},
    ]
    used = disk()["usedGb"]
    parts.append({"key": "other", "label": "System and other", "gb": round(max(0, used - sum(p["gb"] for p in parts)), 2)})
    return {"at": iso(), "parts": sorted(parts, key=lambda p: -p["gb"])}


# ---------------------------------------------------------------- safety (every 6 hours) and ports


def updates():
    if shutil.which("apt"):
        lines = [l for l in run(["apt", "list", "--upgradable"], timeout=60).splitlines() if "/" in l]
        security = sum(1 for l in lines if "-security" in l)
        reboot = os.path.exists("/var/run/reboot-required")
        return {"all": len(lines), "security": security, "reboot": reboot}
    if shutil.which("dnf"):
        sec = [l for l in run(["dnf", "-q", "--cacheonly", "updateinfo", "list", "--security"], timeout=120).splitlines() if l.strip()]
        allu = [l for l in run(["dnf", "-q", "--cacheonly", "check-update"], timeout=120).splitlines() if l.strip() and not l.startswith(" ")]
        reboot = None
        if shutil.which("needs-restarting"):
            reboot = subprocess.run(["needs-restarting", "-r"], capture_output=True).returncode == 1
        return {"all": len(allu), "security": len(sec), "reboot": reboot}
    return None


def firewall():
    if shutil.which("ufw"):
        out = run(["ufw", "status"])
        return "on" if "Status: active" in out else "off"
    if shutil.which("firewall-cmd"):
        return "on" if run(["firewall-cmd", "--state"]).strip() == "running" else "off"
    return None


def ssh_password():
    out = run(["sshd", "-T"]) if shutil.which("sshd") else ""
    m = re.search(r"^passwordauthentication (\w+)", out, re.M)
    return None if not m else m.group(1) == "yes"


def ports():
    """Ports open to the outside (listening on every address or a public one), not only on this machine."""
    found = set()
    for line in run(["ss", "-Htln"]).splitlines():
        parts = line.split()
        if len(parts) < 4:
            continue
        addr = parts[3]
        host_, _, port = addr.rpartition(":")
        host_ = host_.strip("[]")
        if host_.startswith("127.") or host_ in ("::1", "localhost") or host_.startswith("%"):
            continue
        if port.isdigit():
            found.add(int(port))
    return sorted(found)


# ---------------------------------------------------------------- certificates (hourly)


def env_file():
    vals = {}
    try:
        with open(os.path.join(APP_DIR, ".env")) as f:
            for line in f:
                m = re.match(r"^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$", line)
                if m:
                    vals[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    except Exception:
        pass
    return vals


def certificates():
    env = env_file()
    hosts = []
    app = re.sub(r"^https?://", "", env.get("APP_URL", "")).split("/")[0].split(":")[0]
    if app:
        hosts.append(app)
    base = env.get("BASE_DOMAIN", "").strip()
    if base:
        for h in (base, f"admin.{base}", f"{env['ROOT_COMPANY']}.{base}" if env.get("ROOT_COMPANY") else None):
            if h and h not in hosts:
                hosts.append(h)
    out = []
    ctx = ssl.create_default_context()
    for h in hosts:
        try:
            with socket.create_connection(("127.0.0.1", 443), timeout=5) as raw:
                with ctx.wrap_socket(raw, server_hostname=h) as s:
                    cert = s.getpeercert()
            ends = dt.datetime.strptime(cert["notAfter"], "%b %d %H:%M:%S %Y %Z").replace(tzinfo=dt.timezone.utc)
            out.append({"host": h, "ok": True, "endsAt": ends.strftime("%Y-%m-%dT%H:%M:%SZ")})
        except Exception as e:
            out.append({"host": h, "ok": False, "error": str(e)[:160]})
    return out


# ---------------------------------------------------------------- the API answers (every minute)


def api_health():
    port = env_file().get("API_HOST_PORT") or "3421"
    start = time.time()
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=10) as r:
            ok = r.status == 200
    except Exception:
        ok = False
    return {"ok": ok, "ms": round((time.time() - start) * 1000)}


# ---------------------------------------------------------------- one run


def main():
    os.makedirs(OUT, exist_ok=True)
    cpu = cpu_percent()
    mem = memory()
    dsk = disk()
    services, project = containers()
    events = events_from(services) if services else []

    cached = read(os.path.join(OUT, ".slow.json"), {}) or {}
    if older_than(".slow.json", 3500) or not cached.get("space"):
        cached["space"] = space(project) if services else cached.get("space")
        cached["certificates"] = certificates()
    if NOW - (cached.get("safetyAt") or 0) > 6 * 3600:
        cached["updates"] = updates()
        cached["firewall"] = firewall()
        cached["sshPassword"] = ssh_password()
        cached["safetyAt"] = NOW
    write(".slow.json", cached)

    health = api_health()
    load = os.getloadavg()
    write(
        "server.json",
        {
            "at": iso(),
            "host": host(),
            "cpu": {"percent": cpu, "load1": round(load[0], 2), "load5": round(load[1], 2), "load15": round(load[2], 2)},
            "memory": mem,
            "disk": dsk,
            "services": services,
            "api": health,
            "ports": ports(),
            "firewall": cached.get("firewall"),
            "sshPassword": cached.get("sshPassword"),
            "updates": cached.get("updates"),
            "space": cached.get("space"),
            "certificates": cached.get("certificates"),
        },
    )
    append("history.jsonl", [{"t": iso(), "cpu": cpu, "mem": mem and mem["percent"], "disk": dsk["percent"], "up": health["ok"]}], 7 * 1440)
    today = iso()[:10]
    days = []
    try:
        with open(os.path.join(OUT, "disk-days.jsonl")) as f:
            days = f.read().splitlines()
    except FileNotFoundError:
        pass
    if not days or not days[-1].startswith(f'{{"day":"{today}"'):
        append("disk-days.jsonl", [{"day": today, "usedGb": dsk["usedGb"], "percent": dsk["percent"]}], 120)
    if events:
        append("events.jsonl", events, 2000)


if __name__ == "__main__":
    main()
