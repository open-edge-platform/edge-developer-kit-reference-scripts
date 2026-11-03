# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Command-line front end, mainly for setup scripts and smoke tests.

    python -m model_downloader info
    python -m model_downloader snapshot hexgrad/Kokoro-82M models/tts/kokoro --allow config.json
    python -m model_downloader file TensorForger/RIFE-safetensors flownet.safetensors models/rife
    python -m model_downloader url https://example.com/model.onnx models/x/model.onnx
    python -m model_downloader omz noise-suppression-poconetlike-0001 models/stt/intel --precision FP16
    python -m model_downloader ovms-pull OpenVINO/whisper-base-fp16-ov models/ovms --task speech2text
    python -m model_downloader ovms-export-env Qwen/Qwen3-ASR-1.7B-hf
"""

from __future__ import annotations

import argparse
import json
import logging
import sys

from . import (
    ModelDownloadError,
    OvmsNotFoundError,
    UpstreamMissingError,
    fetch_file,
    fetch_omz_ir,
    fetch_snapshot,
    fetch_url,
    ovms_env,
    ovms_pull,
    registry,
    upstream_info,
)
from .ovms import export_profile_for, has_optimum_cli


def _add_source(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--source", default="huggingface", help="huggingface (default) or modelscope")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="model_downloader", description=__doc__.strip().splitlines()[0])
    parser.add_argument("-v", "--verbose", action="store_true")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("info", help="show the pinned OEP release, registered plugins and where OVMS is")

    p = sub.add_parser("snapshot", help="mirror a hub repository into a directory")
    p.add_argument("repo_id")
    p.add_argument("local_dir")
    p.add_argument("--allow", action="append", default=None, metavar="PATTERN")
    p.add_argument("--ignore", action="append", default=None, metavar="PATTERN")
    p.add_argument("--revision", default=None)
    _add_source(p)

    p = sub.add_parser("file", help="fetch one file from a hub repository")
    p.add_argument("repo_id")
    p.add_argument("filename")
    p.add_argument("local_dir")
    p.add_argument("--revision", default=None)
    _add_source(p)

    p = sub.add_parser("url", help="fetch one https URL")
    p.add_argument("url")
    p.add_argument("dest")
    p.add_argument("--sha256", default=None)

    p = sub.add_parser("omz", help="fetch an Open Model Zoo IR pair")
    p.add_argument("model_name")
    p.add_argument("root")
    p.add_argument("--precision", default="FP32")

    p = sub.add_parser("ovms-pull", help="ovms --pull: download and convert a model for OVMS")
    p.add_argument("source_model")
    p.add_argument("model_repository_path")
    p.add_argument("--task", required=True, help="text_generation, embeddings, rerank, image_generation, speech2text, ...")
    p.add_argument("--target-device", default=None)
    p.add_argument("--pipeline-type", default=None)
    p.add_argument("--weight-format", default=None)
    p.add_argument("--log-level", default=None)
    p.add_argument("extra_args", nargs="*", help="passed to ovms unchanged (after --)")
    _add_source(p)

    p = sub.add_parser(
        "ovms-export-env",
        help="print the conversion environment a model needs if it is not the shared one "
        "(`<project under workers/> <ready|missing> <venv>`; nothing for the shared one)",
    )
    p.add_argument("source_model")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    try:
        if args.command == "info":
            info: dict = {"oep": dict(upstream_info())}
            reg = registry()  # bootstraps (and fetches on demand) first
            info["oep"]["plugins"] = {kind: sorted(names) for kind, names in reg.plugins.items()}
            info["oep"]["hubs"] = reg.supported_hubs()
            try:
                env = ovms_env()
                info["ovms"] = {"home": str(env.home), "executable": str(env.executable), "present": "yes"}
            except OvmsNotFoundError as exc:
                info["ovms"] = {"present": "no", "error": str(exc)}
            print(json.dumps(info, indent=2))
            return 0
        if args.command == "ovms-export-env":
            profile = export_profile_for(args.source_model)
            venv = profile.venv() if profile is not None else None
            if profile is not None and venv is not None:
                state = "ready" if has_optimum_cli(venv) else "missing"
                print(f"{profile.project} {state} {venv}")
            return 0
        if args.command == "snapshot":
            path = fetch_snapshot(
                args.repo_id, args.local_dir, source=args.source,
                allow_patterns=args.allow, ignore_patterns=args.ignore, revision=args.revision,
            )
        elif args.command == "file":
            path = fetch_file(args.repo_id, args.filename, args.local_dir, source=args.source, revision=args.revision)
        elif args.command == "url":
            path = fetch_url(args.url, args.dest, sha256=args.sha256)
        elif args.command == "omz":
            path = fetch_omz_ir(args.root, model_name=args.model_name, precision=args.precision)
        else:
            path = ovms_pull(
                args.source_model, args.model_repository_path, task=args.task, source=args.source,
                target_device=args.target_device, pipeline_type=args.pipeline_type,
                weight_format=args.weight_format, log_level=args.log_level, extra_args=args.extra_args,
            )
        print(path)
        return 0
    except (ModelDownloadError, UpstreamMissingError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
