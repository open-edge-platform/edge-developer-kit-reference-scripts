#!/usr/bin/env python3
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""Builds the .venv of a worker that wraps an OEP microservice from upstream's own dependency file.

The worker's entry in oep-services.json says how upstream installs it ("install": its
requirements.txt, or its Poetry pyproject.toml with poetry.lock as constraints), so bumping the tag
needs no dependency change here: upstream owns the pins. <worker>/overrides.txt, when present,
replaces only what would not install or run on our platforms. The wrapper's shared library
(workers/common) is installed editable beside upstream's packages.

The environment is rebuilt from scratch when any of that changes, and only checked otherwise.

Usage: oep_env.py --uv <uv executable> <worker>   (e.g. services/speech-to-text/oep)
"""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import json
import os
import re
import subprocess  # nosec B404 - runs the given uv with fixed argument lists, no shell
import sys
import time
import tomllib
from collections.abc import Iterator
from pathlib import Path

WORKERS = Path(__file__).resolve().parent.parent
CATALOG = WORKERS / "oep-services.json"
# Bump to rebuild every environment after a change to how they are built.
RECIPE_VERSION = 1
STAMP = ".oep-env"
LOCK_TIMEOUT_S = 3600
# What --uv may be called: only these names are ever executed, never the argument itself.
UV_NAMES = ("uv", "uv.exe")
# Printable characters (the BMP, ASCII first) a uv path may be made of.
PATH_CHARS = "".join(c for c in map(chr, range(0x20, 0x10000)) if c.isprintable())


def _normalize(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def _requirement_name(line: str) -> str | None:
    """The package a requirements-file line names; None for comments, blank lines and options."""
    line = line.split("#", 1)[0].strip()
    if not line or line.startswith("-"):
        return None
    match = re.match(r"[A-Za-z0-9][A-Za-z0-9._-]*", line)
    return _normalize(match.group(0)) if match else None


def _entry(worker: str) -> dict:
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    for entry in catalog.get("services", []):
        if entry["worker"] == worker and "install" in entry:
            return entry
    sys.exit(f'{worker}: no "services" entry with an "install" recipe in {CATALOG}')


def _upstream_dir(worker_dir: Path, entry: dict) -> Path:
    """Where oep-setup fetched the microservice: $<home_env>, else <worker>/<dir>."""
    home = os.environ.get(entry["home_env"], "") if entry.get("home_env") else ""
    if home:
        return Path(home)
    name = entry.get("name") or entry["subdir"].rstrip("/").rsplit("/", 1)[-1]
    return worker_dir / entry.get("dir", f"thirdparty/{name}")


def _poetry_lock(lock: Path, skip: set[str]) -> tuple[list[str], list[str]]:
    """poetry.lock as constraints, plus overrides that hold its git packages at the locked commit.

    A git dependency on a branch (optimum at HEAD) would otherwise resolve to today's commit.
    """
    constraints: list[str] = []
    git: list[str] = []
    for package in tomllib.loads(lock.read_text(encoding="utf-8")).get("package", []):
        if _normalize(package["name"]) in skip:
            continue
        source = package.get("source") or {}
        kind = source.get("type")
        if kind == "git":
            commit = source.get("resolved_reference") or source.get("reference")
            subdirectory = f"#subdirectory={source['subdirectory']}" if source.get("subdirectory") else ""
            git.append(f"{package['name']} @ git+{source['url']}@{commit}{subdirectory}")
        elif kind in (None, "legacy"):
            constraints.append(f"{package['name']}=={package['version']}")
    return constraints, git


def _poetry_indexes(pyproject: Path) -> list[str]:
    """The package sources a Poetry project declares (the CPU PyTorch index), as extra indexes."""
    poetry = tomllib.loads(pyproject.read_text(encoding="utf-8")).get("tool", {}).get("poetry", {})
    return [source["url"] for source in poetry.get("source", []) if source.get("url")]


@contextlib.contextmanager
def _exclusive(path: Path) -> Iterator[None]:
    """One install per worker at a time: instances of a worker share its .venv."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a+b") as handle:
        deadline = time.monotonic() + LOCK_TIMEOUT_S
        waiting = False
        while True:
            try:
                if os.name == "nt":
                    import msvcrt

                    handle.seek(0)
                    msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl

                    fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except OSError:
                if time.monotonic() > deadline:
                    sys.exit(f"Timed out waiting for another start to finish installing ({path})")
                if not waiting:
                    print("Waiting for another start of this worker to finish installing...", flush=True)
                    waiting = True
                time.sleep(2)
        try:
            yield
        finally:
            if os.name == "nt":
                import msvcrt

                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)


def _run(command: list[str]) -> None:
    print("+ " + " ".join(command), flush=True)
    subprocess.run(command, check=True)


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--uv", required=True, help="uv executable")
    parser.add_argument("worker", help="worker directory under workers/, as in oep-services.json")
    args = parser.parse_args()

    # Rebuild the path from allowed characters and exec only the matching UV_NAMES element: the
    # copy stays inline (a helper's result would count as untrusted for the static analysis).
    uv_path = ""
    for char in args.uv:
        allowed_char = ""
        for allowed in PATH_CHARS:
            if allowed == char:
                allowed_char = allowed
                break
        if not allowed_char:
            sys.exit("--uv: unsupported character in the uv path")
        uv_path += allowed_char
    uv_file = Path(uv_path)
    uv_name = next((name for name in UV_NAMES if name == uv_file.name), "")
    if not uv_name or not uv_file.is_file():
        sys.exit(f"--uv must be the path of an existing uv executable ({' or '.join(UV_NAMES)}): {uv_path}")
    uv = str(uv_file.parent / uv_name)

    entry = _entry(args.worker)
    recipe = entry["install"]
    python = recipe.get("python", "3.12")
    worker_dir = WORKERS / args.worker
    upstream = _upstream_dir(worker_dir, entry)
    venv = worker_dir / ".venv"

    requirements = upstream / recipe["requirements"]
    if not requirements.is_file():
        sys.exit(f"{requirements} not found: fetch the worker first (oep-setup fetch {args.worker})")
    constraints_file = upstream / recipe["constraints"] if recipe.get("constraints") else None
    if constraints_file and not constraints_file.is_file():
        sys.exit(f"{constraints_file} not found at this tag; update \"constraints\" in {CATALOG.name}")
    overrides_file = worker_dir / "overrides.txt"
    overrides = overrides_file.read_text(encoding="utf-8").splitlines() if overrides_file.is_file() else []
    overridden = {name for name in map(_requirement_name, overrides) if name}

    inputs = [requirements, WORKERS / "common" / "pyproject.toml"]
    inputs += [p for p in (constraints_file, overrides_file) if p and p.is_file()]
    digest = hashlib.sha256(f"{RECIPE_VERSION}\n{json.dumps(recipe, sort_keys=True)}\n".encode())
    for path in inputs:
        digest.update(path.name.encode() + b"\0" + path.read_bytes() + b"\0")
    stamp = digest.hexdigest()

    with _exclusive(worker_dir / "thirdparty" / ".oep-env.lock"):
        if (venv / STAMP).is_file() and (venv / STAMP).read_text(encoding="utf-8").strip() == stamp:
            print(f"{args.worker}: environment matches {requirements.name} at this tag")
            return 0

        print(f"{args.worker}: installing upstream's {requirements.name} into {venv}", flush=True)
        # --no-config: uv would otherwise apply workers/pyproject.toml's [tool.uv] (the workspace's
        # torch overrides and indexes), found by walking up from here.
        _run([uv, "venv", "--no-config", "--clear", "--python", python, str(venv)])
        venv_python = venv / ("Scripts/python.exe" if os.name == "nt" else "bin/python")

        # pip's handling of the extra indexes upstream's files name (the CPU PyTorch index).
        command = [uv, "pip", "install", "--no-config", "--python", str(venv_python),
                   "--index-strategy", "unsafe-best-match",
                   "-r", str(requirements), "-e", str(WORKERS / "common")]
        if requirements.name == "pyproject.toml":
            for url in _poetry_indexes(requirements):
                command += ["--extra-index-url", url]

        generated_overrides = list(overrides)
        if constraints_file:
            if constraints_file.name == "poetry.lock":
                constraints, git = _poetry_lock(constraints_file, overridden)
                generated_overrides += git
            else:
                lines = constraints_file.read_text(encoding="utf-8").splitlines()
                constraints = [line for line in lines if _requirement_name(line) not in overridden]
            (venv / ".oep-constraints.txt").write_text("\n".join(constraints) + "\n", encoding="utf-8")
            command += ["-c", str(venv / ".oep-constraints.txt")]
        if generated_overrides:
            (venv / ".oep-overrides.txt").write_text("\n".join(generated_overrides) + "\n", encoding="utf-8")
            command += ["--overrides", str(venv / ".oep-overrides.txt")]
        _run(command)

        # As upstream's Dockerfile does after its install (`pip uninstall -y ... || true`).
        for package in recipe.get("uninstall", []):
            subprocess.run([uv, "pip", "uninstall", "--no-config", "--python", str(venv_python), package],
                           check=False)

        (venv / STAMP).write_text(stamp + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except subprocess.CalledProcessError as error:
        sys.exit(f"{error.cmd[0]} exited with {error.returncode}")
