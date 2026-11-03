"""python3 -m gen           write lib/generated, lib/ds/tokens.g.dart, test/generated
python3 -m gen --check   exit 1 when the generated code is not what the spec gives (CI)

Run from apps/app-v2. Needs `dart` on PATH (the output is run through `dart format`).
"""
from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

from .spec import ROOT, SpecError, load
from .targets import all_files

OWNED = ["lib/generated", "test/generated"]  # everything in these folders is generated
SINGLE = ["lib/ds/tokens.g.dart"]


def render() -> dict[str, str]:
    files = all_files(load())
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)
        for rel, text in files.items():
            p = base / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(text)
        res = subprocess.run(["dart", "format", "--page-width", "120", str(base)], capture_output=True, text=True)
        if res.returncode != 0:
            # Bad Dart from a template: show where, so the generator gets fixed.
            raise SpecError("dart format could not read the generated code:\n" + res.stderr[-3000:])
        return {rel: (base / rel).read_text() for rel in files}


def current() -> dict[str, str]:
    out = {}
    for folder in OWNED:
        for p in (ROOT / folder).rglob("*.dart"):
            out[str(p.relative_to(ROOT))] = p.read_text()
    for rel in SINGLE:
        if (ROOT / rel).exists():
            out[rel] = (ROOT / rel).read_text()
    return out


def main() -> int:
    check = "--check" in sys.argv
    try:
        want = render()
    except SpecError as e:
        print(f"spec error: {e}", file=sys.stderr)
        return 2
    have = current()
    changed = sorted(k for k in want if have.get(k) != want[k])
    stale = sorted(k for k in have if k not in want)
    if check:
        if changed or stale:
            print("Generated code is out of date. Run `python3 -m gen` in apps/app-v2 and commit:", file=sys.stderr)
            for k in changed + stale:
                print(f"  {k}", file=sys.stderr)
            return 1
        print(f"generated code is current ({len(want)} files)")
        return 0
    for k in changed:
        p = ROOT / k
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(want[k])
    for k in stale:
        (ROOT / k).unlink()
    print(f"{len(want)} files: {len(changed)} written, {len(stale)} removed, {len(want) - len(changed)} unchanged")
    return 0


if __name__ == "__main__":
    sys.exit(main())
