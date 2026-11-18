# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Convert a Physical AI training checkpoint into an OpenVINO policy package.

Physical AI training (``physicalai fit``, the training bundle's ``physicalai_train_*.sh``) writes
Lightning checkpoints (``.ckpt``). The OpenVINO evaluators load an exported policy package
instead: a directory with ``manifest.json`` and OpenVINO IR (``act.xml``/``.bin``, or
``pi05.xml``/``.bin`` plus ``tokenizer.xml``/``.bin``). This module loads the checkpoint with the
Physical AI policy class that trained it and writes that package.

Requires the ``openvino`` extra (``physicalai-train`` provides the policy classes and export).
"""

from __future__ import annotations

import argparse
import contextlib
import importlib
import io
import json
import os
import re
import shlex
import shutil
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterator, Literal, Mapping, Sequence

PolicyType = Literal['act', 'pi05']

POLICY_TYPES: tuple[PolicyType, ...] = ('act', 'pi05')
POLICY_LABELS: Mapping[PolicyType, str] = {'act': 'ACT', 'pi05': 'Pi0.5'}
_POLICY_CLASSES: Mapping[PolicyType, tuple[str, str]] = {
    'act': ('physicalai.policies.act', 'ACT'),
    'pi05': ('physicalai.policies.pi05', 'Pi05'),
}
# Constructor arguments only one policy family has; Lightning stores them in the checkpoint's
# ``hyper_parameters``, so the family is known without loading any weights.
_POLICY_MARKERS: Mapping[PolicyType, tuple[str, ...]] = {
    'pi05': ('paligemma_variant', 'action_expert_variant'),
    'act': ('vision_backbone', 'use_vae', 'kl_weight'),
}
_EVALUATE_SCRIPTS: Mapping[PolicyType, str] = {
    'act': 'physicalai_evaluate_act.py',
    'pi05': 'physicalai_evaluate_pi05.py',
}
_VERSION_DIRECTORY = re.compile(r'^version_(\d+)$')
# transformers prints these docstring lint lines on stdout while Physical AI imports every policy
# family; they are not about the user's checkpoint.
_IMPORT_NOISE = re.compile(r'^\[ERROR\] `[^`]+` is part of .* but not documented\.')


class PhysicalAIExportError(RuntimeError):
    """The checkpoint cannot be converted (not found, unknown policy, unsafe output, ...)."""


class PhysicalAIExportDependencyError(ImportError):
    """``physicalai-train`` (the ``openvino`` extra) is not installed."""


@dataclass(frozen=True)
class PolicyPackageSummary:
    """What an exported package declares, read from its ``manifest.json``."""

    directory: Path
    policy_type: str
    state_shape: tuple[int, ...]
    action_shape: tuple[int, ...]
    cameras: tuple[str, ...]
    requires_task: bool
    files: tuple[Path, ...]

    @property
    def size_bytes(self) -> int:
        return sum(path.stat().st_size for path in self.files)


def resolve_checkpoint(path: str | Path) -> Path:
    """Find the ``.ckpt`` to convert.

    Accepts a ``.ckpt`` file, or a directory: a ``checkpoints/`` or ``version_N/`` directory, or a
    parent of ``lightning_logs/`` (the training bundle root or its ``experiments/``). Directories
    resolve to ``last.ckpt`` of the newest ``version_N`` run, or the only checkpoint present.
    """
    candidate = Path(path).expanduser()
    if candidate.is_file():
        if candidate.suffix != '.ckpt':
            raise PhysicalAIExportError(
                f'{str(candidate)!r} is not a Lightning checkpoint (.ckpt). Pass a checkpoint '
                "from Physical AI training, e.g. 'experiments/lightning_logs/version_0/"
                "checkpoints/last.ckpt'."
            )
        return candidate
    if not candidate.is_dir():
        raise PhysicalAIExportError(f'Checkpoint path {str(candidate)!r} does not exist.')

    for directory in (candidate, candidate / 'checkpoints'):
        last = directory / 'last.ckpt'
        if last.is_file():
            return last

    for logs in (candidate, candidate / 'lightning_logs', candidate / 'experiments' / 'lightning_logs'):
        versions = _version_directories(logs)
        if versions:
            return resolve_checkpoint(versions[-1])

    checkpoints = sorted(
        {*candidate.glob('*.ckpt'), *(candidate / 'checkpoints').glob('*.ckpt')},
        key=lambda item: item.name,
    )
    checkpoints = [item for item in checkpoints if item.is_file()]
    if len(checkpoints) == 1:
        return checkpoints[0]
    if checkpoints:
        names = '\n  '.join(str(item) for item in checkpoints)
        raise PhysicalAIExportError(
            f'{str(candidate)!r} contains several checkpoints and no last.ckpt; pass one of:\n  {names}'
        )
    raise PhysicalAIExportError(
        f'No Physical AI checkpoint (.ckpt) found under {str(candidate)!r}. Training writes them to '
        "'experiments/lightning_logs/version_N/checkpoints/'."
    )


def _version_directories(directory: Path) -> list[Path]:
    if not directory.is_dir():
        return []
    versions = [
        (int(match.group(1)), child)
        for child in directory.iterdir()
        if child.is_dir() and (match := _VERSION_DIRECTORY.match(child.name))
    ]
    return [child for _, child in sorted(versions)]


def detect_policy_type(hyperparameters: Mapping[str, Any]) -> PolicyType:
    """Tell ACT and Pi0.5 checkpoints apart from their saved constructor arguments."""
    matches = [
        policy_type
        for policy_type, markers in _POLICY_MARKERS.items()
        if any(marker in hyperparameters for marker in markers)
    ]
    if len(matches) == 1:
        return matches[0]
    raise PhysicalAIExportError(
        'Could not tell which Physical AI policy wrote this checkpoint. Only ACT and Pi0.5 '
        'checkpoints are supported; pass --policy act or --policy pi05 if it is one of them.'
    )


def read_hyperparameters(checkpoint: Path) -> dict[str, Any]:
    """Read a checkpoint's ``hyper_parameters`` without pulling its weights into memory."""
    torch = _import_dependency('torch')
    try:
        # mmap keeps multi-GB Pi0.5 checkpoints on disk; only the metadata is materialized here.
        state = torch.load(str(checkpoint), map_location='cpu', mmap=True, weights_only=False)
    except RuntimeError:
        state = torch.load(str(checkpoint), map_location='cpu', weights_only=False)
    if not isinstance(state, Mapping) or 'state_dict' not in state:
        raise PhysicalAIExportError(f'{str(checkpoint)!r} is not a Lightning training checkpoint.')
    hyperparameters = state.get('hyper_parameters')
    return dict(hyperparameters) if isinstance(hyperparameters, Mapping) else {}


def default_output_directory(checkpoint: Path) -> Path:
    """``version_N/openvino/<checkpoint name>``, so exports of different epochs never collide.

    ``last.ckpt`` is a link to the newest epoch, so it is named after the file it points to.
    """
    resolved = checkpoint.resolve()
    parent = checkpoint.absolute().parent
    run_directory = parent.parent if parent.name == 'checkpoints' else parent
    return run_directory / 'openvino' / resolved.stem


def summarize_package(directory: str | Path) -> PolicyPackageSummary:
    """Check an exported package is complete and report what it expects."""
    root = Path(directory)
    manifest_path = root / 'manifest.json'
    try:
        manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError) as error:
        raise PhysicalAIExportError(f'{str(manifest_path)!r} is missing or unreadable: {error}') from error

    model = manifest.get('model') or {}
    files = [manifest_path]
    for artifact in _referenced_artifacts(model):
        xml = root / artifact
        for path in (xml, xml.with_suffix('.bin')):
            if not path.is_file():
                raise PhysicalAIExportError(f'Exported package is missing {path.name} (in {str(root)!r}).')
            files.append(path)

    inputs = [_feature(item) for item in model.get('input_features') or []]
    outputs = [_feature(item) for item in model.get('output_features') or []]
    state = next((item for item in inputs if item['ftype'] == 'STATE'), None)
    action = next((item for item in outputs if item['ftype'] == 'ACTION'), None)
    cameras = tuple(_camera_name(item['name']) for item in inputs if item['ftype'] == 'VISUAL')
    if state is None or action is None or not cameras:
        raise PhysicalAIExportError(
            f'Exported manifest in {str(root)!r} does not declare a state input, camera input, and '
            'action output; the evaluators cannot run it.'
        )
    return PolicyPackageSummary(
        directory=root,
        policy_type=str((manifest.get('policy') or {}).get('name', '')),
        state_shape=tuple(state['shape']),
        action_shape=tuple(action['shape']),
        cameras=cameras,
        requires_task=any(item['ftype'] == 'LANGUAGE' for item in inputs),
        files=tuple(files),
    )


def _referenced_artifacts(model: Mapping[str, Any]) -> list[str]:
    artifacts = [str(value) for value in (model.get('artifacts') or {}).values()]
    for component in [*(model.get('preprocessors') or []), *(model.get('postprocessors') or [])]:
        if isinstance(component, Mapping) and isinstance(component.get('artifact'), str):
            artifacts.append(component['artifact'])
    return [artifact for artifact in artifacts if artifact.lower().endswith('.xml')]


def _feature(item: Mapping[str, Any]) -> dict[str, Any]:
    args = item.get('init_args', item) if isinstance(item, Mapping) else {}
    return {
        'ftype': str(args.get('ftype', '')).upper(),
        'name': str(args.get('name', '')),
        'shape': [int(value) for value in args.get('shape') or []],
    }


def _camera_name(feature_name: str) -> str:
    return feature_name.split('.', 1)[1] if feature_name.startswith('images.') else feature_name


def export_checkpoint(
    checkpoint: str | Path,
    output: str | Path | None = None,
    *,
    policy: PolicyType | Literal['auto'] = 'auto',
    int8: bool = False,
    overwrite: bool = False,
    log: Callable[[str], None] = print,
) -> PolicyPackageSummary:
    """Convert ``checkpoint`` into an OpenVINO policy package at ``output``.

    The package is written to a staging directory next to ``output`` and moved into place only
    once it is complete, so a failed or interrupted export never leaves a half-written package.
    """
    checkpoint_path = resolve_checkpoint(checkpoint)
    hyperparameters = read_hyperparameters(checkpoint_path)
    policy_type = _choose_policy_type(hyperparameters, policy)
    if not hyperparameters.get('dataset_stats'):
        raise PhysicalAIExportError(
            f'{str(checkpoint_path)!r} has no dataset statistics, which export needs for '
            'normalization. Use a checkpoint saved after training started (any epoch checkpoint).'
        )

    output_path = Path(output).expanduser() if output is not None else default_output_directory(checkpoint_path)
    _check_output_directory(output_path, overwrite=overwrite)
    policy_class = _policy_class(policy_type)
    hooks = [_int8_weight_compression()] if int8 else None

    label = POLICY_LABELS[policy_type]
    log(f'Loading {label} checkpoint {checkpoint_path} ...')
    output_path.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=f'.{output_path.name}.', dir=output_path.parent))
    try:
        trained = _load_policy(policy_class, checkpoint_path, label)
        trained.eval()
        slow = ' This takes several minutes and a lot of memory for Pi0.5.' if policy_type == 'pi05' else ''
        log(f'Exporting to OpenVINO{" with INT8 weights" if int8 else ""} ...{slow}')
        trained.export(staging, backend='openvino', post_export_hooks=hooks)
        del trained
        summarize_package(staging)
        staging.chmod(0o755)  # mkdtemp creates it owner-only; packages are shared like any output.
        if output_path.exists():
            shutil.rmtree(output_path)
        staging.rename(output_path)
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise
    return summarize_package(output_path)


def _choose_policy_type(hyperparameters: Mapping[str, Any], requested: str) -> PolicyType:
    if requested == 'auto':
        return detect_policy_type(hyperparameters)
    if requested not in POLICY_TYPES:
        raise PhysicalAIExportError(f'Unsupported policy {requested!r}; choose one of {POLICY_TYPES}.')
    chosen: PolicyType = requested  # type: ignore[assignment]
    try:
        detected = detect_policy_type(hyperparameters)
    except PhysicalAIExportError:
        return chosen
    if detected != chosen:
        raise PhysicalAIExportError(
            f'This checkpoint was trained as {POLICY_LABELS[detected]}, not {POLICY_LABELS[chosen]}; '
            f'drop --policy or pass --policy {detected}.'
        )
    return chosen


_STATE_DICT_MISMATCH = re.compile(r'Error\(s\) in loading state_dict')


def _load_policy(policy_class: Any, checkpoint: Path, label: str) -> Any:
    try:
        return policy_class.load_from_checkpoint(str(checkpoint), map_location='cpu')
    except RuntimeError as error:
        if not _STATE_DICT_MISMATCH.search(str(error)):
            raise
        raise PhysicalAIExportError(
            f"The checkpoint's weights do not match the {label} model in the installed "
            f'physicalai-train ({_installed_version("physicalai-train")}). It was most likely '
            'trained with a different physicalai-train version.'
        ) from None


def _installed_version(distribution: str) -> str:
    from importlib import metadata  # noqa: PLC0415

    try:
        return metadata.version(distribution)
    except metadata.PackageNotFoundError:
        return 'unknown version'


def _check_output_directory(output: Path, *, overwrite: bool) -> None:
    if not output.exists():
        return
    if not output.is_dir():
        raise PhysicalAIExportError(f'Output {str(output)!r} exists and is not a directory.')
    if not any(output.iterdir()):
        return
    if not (output / 'manifest.json').is_file():
        # Never delete a directory that is not a policy package, even with --overwrite.
        raise PhysicalAIExportError(
            f'Output {str(output)!r} is not empty and is not a policy package; choose another --output.'
        )
    if not overwrite:
        raise PhysicalAIExportError(
            f'Output {str(output)!r} already contains a policy package; pass --overwrite to replace it.'
        )


def _policy_class(policy_type: PolicyType) -> Any:
    module_name, class_name = _POLICY_CLASSES[policy_type]
    with _quiet_import_noise():
        module = _import_dependency(module_name)
    return getattr(module, class_name)


def _int8_weight_compression() -> Callable[[str], None]:
    _import_dependency('nncf')
    from physicalai.export.hooks import compress_weights_openvino_int8_sym  # noqa: PLC0415

    return compress_weights_openvino_int8_sym


def _import_dependency(name: str) -> Any:
    try:
        return importlib.import_module(name)
    except ModuleNotFoundError as error:
        raise PhysicalAIExportDependencyError(
            'Converting a Physical AI checkpoint needs the OpenVINO extra. Install it with '
            f'`uv sync --locked --extra openvino`. Missing module: {error.name or name}.'
        ) from error


@contextlib.contextmanager
def _quiet_import_noise() -> Iterator[None]:
    captured = io.StringIO()
    try:
        with contextlib.redirect_stdout(captured):
            yield
    finally:
        for line in captured.getvalue().splitlines():
            if not _IMPORT_NOISE.match(line):
                print(line)


def _format_size(size: int) -> str:
    if size >= 1024**3:
        return f'{size / 1024**3:.1f} GB'
    return f'{size / 1024**2:.1f} MB'


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog='physicalai_convert_to_openvino.py',
        description=(
            'Convert a Physical AI training checkpoint (.ckpt) into the OpenVINO policy package '
            'that physicalai_evaluate_act.py / physicalai_evaluate_pi05.py load.'
        ),
    )
    parser.add_argument(
        '--checkpoint',
        required=True,
        help=(
            'A .ckpt file, or a directory to search: version_N/, checkpoints/, or the training '
            "folder (uses the newest run's last.ckpt)."
        ),
    )
    parser.add_argument(
        '--output',
        help="Package directory to write. Default: version_N/openvino/<checkpoint name>.",
    )
    parser.add_argument(
        '--policy',
        choices=('auto', *POLICY_TYPES),
        default='auto',
        help='Policy that wrote the checkpoint. Default: auto (read from the checkpoint).',
    )
    parser.add_argument(
        '--int8',
        action='store_true',
        help='Compress weights to INT8 (smaller and faster on CPU; check success rate against FP16).',
    )
    parser.add_argument('--overwrite', action='store_true', help='Replace an existing package at --output.')
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    # Physical AI imports every policy family, and transformers logs deprecation chatter for
    # families this export never uses.
    os.environ.setdefault('TRANSFORMERS_VERBOSITY', 'error')
    try:
        summary = export_checkpoint(
            args.checkpoint,
            args.output,
            policy=args.policy,
            int8=args.int8,
            overwrite=args.overwrite,
        )
    except (PhysicalAIExportError, PhysicalAIExportDependencyError) as error:
        print(f'error: {error}', file=sys.stderr)
        raise SystemExit(2) from None

    policy_type: PolicyType = 'pi05' if summary.policy_type == 'pi05' or summary.requires_task else 'act'
    print()
    print(f'Wrote {POLICY_LABELS[policy_type]} OpenVINO package ({_format_size(summary.size_bytes)}):')
    print(f'  {summary.directory}')
    print(f'  state {summary.state_shape}, action chunk {summary.action_shape}')
    print(f'  cameras: {", ".join(summary.cameras)}')
    print()
    print('Evaluate it (turn on Stream to external app in Simulate > External control first):')
    command = (
        f'  uv run --locked python {_EVALUATE_SCRIPTS[policy_type]} '
        f'--package {shlex.quote(str(summary.directory))}'
    )
    if summary.requires_task:
        command += ' --task "<instruction used in training>"'
    print(f'{command} --episodes 10')


if __name__ == '__main__':
    main()
