# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Where OpenVINO Model Server lives and the environment it must run in.

In ``--pull`` mode OVMS converts non-IR models with ``optimum-cli`` from the first Python on PATH:
the ``workers/common/ovms-export`` project on Linux, the OVMS-bundled Python on Windows. Serving
needs the same PATH and library setup, so pull and serve both build it with :func:`ovms_env` and
cannot drift. Models in :data:`EXPORT_PROFILES` convert in their own pinned project, chosen by
``source_model``. This module only finds the binary; it installs nothing.
"""

from __future__ import annotations

import fnmatch
import glob
import os
import shutil
from dataclasses import dataclass, field
from pathlib import Path

from ..errors import OvmsNotFoundError

__all__ = [
    "EXPORT_PROFILES",
    "OVMS_EXPORT_VENV_ENV",
    "OVMS_HOME_ENV",
    "ExportProfile",
    "OvmsEnv",
    "default_ovms_home",
    "export_profile_for",
    "has_optimum_cli",
    "optimum_home",
    "ovms_env",
]

#: Names the OVMS install directory instead of ``workers/thirdparty/ovms``. ``OVMS_DIR`` (exported
#: by ``scripts/worker-common.sh``, read by OVMS on Windows) works too.
OVMS_HOME_ENV = "OVMS_HOME"
#: Names the Linux conversion venv (with optimum-cli) instead of ``workers/common/ovms-export/.venv``.
OVMS_EXPORT_VENV_ENV = "OVMS_EXPORT_VENV"
_IS_WINDOWS = os.name == "nt"

# Same sentinel model_downloader.oep uses: present only at workers/.
_WORKERS_SENTINEL = Path("scripts") / "worker-common.sh"


def _workers_root() -> Path | None:
    here = Path(__file__).resolve().parent
    for candidate in (here, *here.parents):
        if (candidate / _WORKERS_SENTINEL).is_file():
            return candidate
    return None


def default_ovms_home() -> Path:
    """``workers/thirdparty/ovms``, or the directory ``OVMS_HOME`` / ``OVMS_DIR`` names."""
    for var in (OVMS_HOME_ENV, "OVMS_DIR"):
        value = os.environ.get(var, "").strip()
        if value:
            return Path(value).expanduser().resolve()
    root = _workers_root()
    if root is None:
        raise OvmsNotFoundError(
            f"cannot locate workers/ above {Path(__file__).resolve().parent}; set {OVMS_HOME_ENV}"
        )
    return root / "thirdparty" / "ovms"


def _executable_in(home: Path) -> Path:
    return home / "ovms.exe" if _IS_WINDOWS else home / "bin" / "ovms"


@dataclass(frozen=True)
class ExportProfile:
    """A conversion environment for models the shared one cannot export.

    Each is its own pinned uv project under ``workers/``, outside the workspace, synced on demand
    by the start script of the worker that serves such a model.
    """

    #: Short name, used in messages.
    name: str
    #: The uv project, relative to ``workers/``; its ``.venv`` is the environment.
    project: str
    #: Environment variable naming another venv to use instead.
    env_var: str
    #: ``fnmatch`` patterns on the source model id, matched case-insensitively.
    model_patterns: tuple[str, ...]

    def matches(self, source_model: str) -> bool:
        model = source_model.strip().lower()
        return any(fnmatch.fnmatchcase(model, pattern.lower()) for pattern in self.model_patterns)

    def venv(self) -> Path | None:
        """``<env_var>`` or ``workers/<project>/.venv`` (``None`` when workers/ is not found)."""
        override = os.environ.get(self.env_var, "").strip()
        if override:
            return Path(override).expanduser().resolve()
        root = _workers_root()
        return None if root is None else (root / self.project / ".venv").resolve()


#: Models whose conversion needs an environment of their own. Everything else
#: converts in ``workers/common/ovms-export``.
EXPORT_PROFILES: tuple[ExportProfile, ...] = (
    # Hugging Face-native Qwen3-ASR needs transformers 5.13 and an
    # optimum-intel fork (openvino-dev-samples, add-qwen3-asr-hf-and-forced-
    # aligner); the released optimum-intel caps transformers below 5.6.
    ExportProfile(
        name="qwen3-asr",
        project="common/ovms-export-qwen3-asr",
        env_var="OVMS_EXPORT_VENV_QWEN3_ASR",
        model_patterns=("Qwen/Qwen3-ASR-*",),
    ),
)


def export_profile_for(source_model: str | None) -> ExportProfile | None:
    """The :class:`ExportProfile` ``source_model`` converts with, or ``None`` for the shared one."""
    if not source_model:
        return None
    for profile in EXPORT_PROFILES:
        if profile.matches(source_model):
            return profile
    return None


def has_optimum_cli(venv: Path) -> bool:
    """Whether ``venv`` holds an ``optimum-cli`` (``bin/`` or, on Windows, ``Scripts/``)."""
    if _IS_WINDOWS:
        return (venv / "Scripts" / "optimum-cli.exe").is_file()
    return (venv / "bin" / "optimum-cli").is_file()


def optimum_home(ovms_home: Path, source_model: str | None = None) -> Path:
    """The optimum-cli environment OVMS converts with (Linux).

    A model in :data:`EXPORT_PROFILES` gets that profile's venv only: falling back to the shared
    one would turn a clear "not provisioned" into a conversion error. Otherwise the first of
    ``OVMS_EXPORT_VENV``, ``workers/common/ovms-export/.venv`` and the legacy
    ``<ovms>/lib/optimum_venv`` holding an ``optimum-cli`` wins; with none, the project path is
    returned so OVMS's error names where setup would have put it.
    """
    profile = export_profile_for(source_model)
    if profile is not None:
        venv = profile.venv()
        if venv is not None:
            return venv
    candidates = []
    override = os.environ.get(OVMS_EXPORT_VENV_ENV, "").strip()
    if override:
        candidates.append(Path(override).expanduser())
    root = _workers_root()
    if root is not None:
        candidates.append(root / "common" / "ovms-export" / ".venv")
    candidates.append(ovms_home / "lib" / "optimum_venv")
    for candidate in candidates:
        if (candidate / "bin" / "optimum-cli").is_file():
            return candidate.resolve()
    return candidates[0].resolve() if override else candidates[-2 if root is not None else -1].resolve()


@dataclass(frozen=True)
class OvmsEnv:
    """The OVMS binary and the environment to run it with (pull and serve)."""

    #: The install directory (``workers/thirdparty/ovms``).
    home: Path
    #: ``<home>/ovms.exe`` on Windows, ``<home>/bin/ovms`` elsewhere.
    executable: Path
    #: The optimum environment OVMS shells out to for conversions.
    optimum_home: Path
    #: ``os.environ`` plus PATH / PYTHONHOME / PYTHONPATH / LD_LIBRARY_PATH /
    #: OVMS_DIR as OVMS and optimum-cli need them. A fresh copy per call.
    env: dict[str, str] = field(repr=False)
    #: The :class:`ExportProfile` the environment was built for, or ``None``
    #: for the shared conversion environment.
    export_profile: ExportProfile | None = None


def ovms_env(
    home: str | os.PathLike[str] | None = None,
    *,
    source_model: str | None = None,
) -> OvmsEnv:
    """Locate OVMS and build its process environment.

    Resolution order: ``home``, ``OVMS_HOME`` / ``OVMS_DIR``, ``workers/thirdparty/ovms``, then an
    ``ovms`` on PATH; raises :class:`OvmsNotFoundError` when none has the binary. The environment
    starts from ``os.environ`` so proxies, ``HF_TOKEN`` and ``HF_ENDPOINT`` survive.
    ``source_model`` picks a model's :data:`EXPORT_PROFILES` environment over the shared one.
    """
    profile = export_profile_for(source_model)
    if home is not None:
        root = Path(home).expanduser().resolve()
    else:
        root = default_ovms_home()

    executable = _executable_in(root)
    if not executable.is_file():
        found = shutil.which("ovms.exe" if _IS_WINDOWS else "ovms")
        if not found:
            raise OvmsNotFoundError(
                f"OVMS executable not found at {executable}. "
                "Run workers/setup.sh (workers\\setup.ps1 on Windows) first, "
                f"or set {OVMS_HOME_ENV} to the OVMS install directory."
            )
        executable = Path(found).resolve()
        root = executable.parent if _IS_WINDOWS else executable.parent.parent

    env = os.environ.copy()
    current_path = env.get("PATH", "")
    if _IS_WINDOWS:
        # OVMS-bundled Python with optimum installed; optimum-cli.exe lives in Scripts.
        ovms_python = root / "python"
        export_home = ovms_python
        path_entries = [str(ovms_python), str(ovms_python / "Scripts"), str(root), current_path]
        profile_venv = profile.venv() if profile is not None else None
        if profile_venv is not None and has_optimum_cli(profile_venv):
            # Let the optimum-cli launcher use its own interpreter. Inheriting
            # OVMS' PYTHONHOME makes it run against the bundled Python instead.
            export_home = profile_venv
            path_entries.insert(0, str(profile_venv / "Scripts"))
        env["OVMS_DIR"] = str(root)
        if profile_venv is None:
            env["PYTHONHOME"] = str(ovms_python)
        else:
            env.pop("PYTHONHOME", None)
        env["PATH"] = os.pathsep.join(path_entries)
    else:
        export_home = optimum_home(root, source_model)
        site_packages = glob.glob(str(export_home / "lib" / "python*" / "site-packages"))
        ovms_python_lib = root / "lib" / "python"
        env["LD_LIBRARY_PATH"] = str(root / "lib")
        env["PATH"] = os.pathsep.join([str(export_home / "bin"), str(root / "bin"), current_path])
        env["PYTHONPATH"] = (
            os.pathsep.join([site_packages[0], str(ovms_python_lib)]) if site_packages else str(ovms_python_lib)
        )

    return OvmsEnv(
        home=root, executable=executable, optimum_home=export_home, env=env, export_profile=profile
    )
