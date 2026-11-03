# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Extra command-line arguments a model server starts with, as a `/v1/start` request gives them."""

import shlex
from typing import Dict, Iterable, List, Optional, Sequence, Union

ExtraArgs = Union[None, str, Sequence[str], Dict[str, Optional[str]]]

#: llama-server flags the engine owns: where it listens, what it loads, who may call it.
LLAMACPP_RESERVED_FLAGS = frozenset(
    {
        "--host",
        "--port",
        "--model",
        "--model-url",
        "--hf-repo",
        "--hf-file",
        "--hf-repo-draft",
        "--hf-token",
        "--docker-repo",
        "--api-key",
        "--api-key-file",
        "--ssl-key-file",
        "--ssl-cert-file",
    }
)

#: Short spellings of llama-server flags, to their long form.
LLAMACPP_FLAG_ALIASES = {
    "-m": "--model",
    "-mu": "--model-url",
    "-hf": "--hf-repo",
    "-hfr": "--hf-repo",
    "-hff": "--hf-file",
    "-hfd": "--hf-repo-draft",
    "-hft": "--hf-token",
    "-dr": "--docker-repo",
    "-c": "--ctx-size",
    "-ngl": "--gpu-layers",
    "--n-gpu-layers": "--gpu-layers",
    "-fa": "--flash-attn",
    "-ub": "--ubatch-size",
    "-b": "--batch-size",
    "-dev": "--device",
    "-mm": "--mmproj",
    "--embeddings": "--embedding",
    "--rerank": "--reranking",
}

#: `ovms --pull` options the engine owns: the model, where it goes, the device and the server.
OVMS_RESERVED_FLAGS = frozenset(
    {
        "--pull",
        "--source_model",
        "--model_repository_path",
        "--task",
        "--target_device",
        "--model_name",
        "--model_path",
        "--config_path",
        "--overwrite_models",
        "--gguf_filename",
        "--port",
        "--rest_port",
        "--grpc_bind_address",
        "--rest_bind_address",
        "--add_to_config",
        "--remove_from_config",
        "--list_models",
        "--log_level",
        "--log_path",
        "--api_key_file",
    }
)


def normalize_extra_args(value: ExtraArgs) -> List[str]:
    """The arguments as a list: a list as is, a string split like a shell, ``{"name": value}`` as ``--name value``."""
    if not value:
        return []
    if isinstance(value, str):
        return shlex.split(value)
    if isinstance(value, dict):
        args: List[str] = []
        for name, flag_value in value.items():
            args.append(name if name.startswith("-") else f"--{name}")
            if flag_value is not None and flag_value != "":
                args.append(str(flag_value))
        return args
    return [str(arg) for arg in value]


def _flag(token: str, aliases: Dict[str, str], dashes: bool) -> Optional[str]:
    """``token``'s flag in its canonical spelling, or None for a value. ``--a=b`` is flag ``--a``."""
    if not token.startswith("-") or len(token) < 2 or _is_number(token):
        return None
    name = token.split("=", 1)[0]
    if dashes and name.startswith("--"):
        # llama.cpp reads `--reasoning_format` as `--reasoning-format`.
        name = name.replace("_", "-")
    return aliases.get(name, name)


def _is_number(token: str) -> bool:
    try:
        float(token)
        return True
    except ValueError:
        return False


def llamacpp_flag(token: str) -> Optional[str]:
    return _flag(token, LLAMACPP_FLAG_ALIASES, dashes=True)


def ovms_flag(token: str) -> Optional[str]:
    return _flag(token, {}, dashes=False)


def reserved_flags_in(args: Iterable[str], backend: str) -> List[str]:
    """The flags of ``args`` the engine sets itself on ``backend`` ("llamacpp" or "openvino")."""
    if backend == "llamacpp":
        flag, reserved = llamacpp_flag, LLAMACPP_RESERVED_FLAGS
    else:
        flag, reserved = ovms_flag, OVMS_RESERVED_FLAGS
    found = []
    for token in args:
        name = flag(token)
        if name in reserved and name not in found:
            found.append(name)
    return found


def check_extra_args(value: ExtraArgs, backend: str) -> List[str]:
    """``value`` as a list; ``ValueError`` when it cannot be split or sets a flag the engine owns."""
    try:
        args = normalize_extra_args(value)
    except ValueError as e:
        raise ValueError(f"Extra arguments could not be read: {e}") from e
    reserved = reserved_flags_in(args, backend)
    if reserved:
        raise ValueError(
            f"Extra arguments may not set {', '.join(reserved)}: the engine sets "
            f"{'it' if len(reserved) == 1 else 'them'} itself."
        )
    return args


def strip_flags(args: Sequence[str], drop: Iterable[str], flag) -> List[str]:
    """``args`` without the flags in ``drop`` (canonical names) and each one's value."""
    drop = set(drop)
    result: List[str] = []
    skipping = False
    for token in args:
        name = flag(token)
        if name is not None:
            skipping = name in drop and "=" not in token
            if name not in drop:
                result.append(token)
        elif skipping:
            # A flag's value: only the first token after it.
            skipping = False
        else:
            result.append(token)
    return result


def flags_in(args: Iterable[str], flag) -> set:
    return {name for name in (flag(token) for token in args) if name is not None}
