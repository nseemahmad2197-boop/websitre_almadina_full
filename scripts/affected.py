#!/usr/bin/env python3
"""Select independent app builds; shared changes or unknown history build all."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
APPS = ("web", "android", "ios")


def affected_paths(paths):
    affected = set()
    for path in paths:
        parts = Path(path).parts
        if len(parts) >= 3 and parts[0] == "apps" and parts[1] in APPS:
            affected.add(parts[1])
        elif path == "render.yaml":
            affected.add("web")
        elif (path.startswith("docs/") or "/" not in path) and path.endswith(".md"):
            continue
        else:
            # Includes shared/, generator/tests, workflow edits, manifest,
            # file moves out of a known app, and newly introduced root config.
            affected.update(APPS)
    return {app: app in affected for app in APPS}


def changed_files(base, cwd=ROOT):
    if not re.fullmatch(r"[0-9a-fA-F]{40,64}", base or "") or set(base) == {"0"}:
        return None
    result = subprocess.run(["git", "diff", "--name-only", "--no-renames", "-z", base, "HEAD", "--"],
                            cwd=cwd, capture_output=True, check=False)
    if result.returncode:
        return None
    return [name.decode("utf-8", errors="surrogateescape") for name in result.stdout.split(b"\0") if name]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default=os.environ.get("BASE_SHA", ""))
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--github-output", action="store_true")
    args = parser.parse_args()
    paths = None if args.all or os.environ.get("GITHUB_EVENT_NAME") == "workflow_dispatch" else changed_files(args.base)
    result = {app: True for app in APPS} if paths is None else affected_paths(paths)
    print(json.dumps(result, sort_keys=True))
    if args.github_output:
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as handle:
            for app, affected in result.items():
                handle.write(f"{app}={str(affected).lower()}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
