# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import argparse
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, Mapping, Sequence

import numpy as np

from .environment import Observation
from .evaluation_loop import PolicyRunnerMixin

PHYSICALAI_OPENVINO_POLICY_TYPE = 'physicalai-openvino'
DEFAULT_DEVICE = 'AUTO'

_logger = logging.getLogger(__name__)


class PhysicalAIDependencyError(ImportError):
    """Physical AI and OpenVINO are not installed in the worker environment."""


class PhysicalAICompatibilityError(RuntimeError):
    """A Physical AI package does not match the active Studio environment."""

    def __init__(
        self,
        message: str,
        report: OpenVINOCompatibilityReport | None = None,
    ) -> None:
        super().__init__(message)
        self.report = report


@dataclass(frozen=True)
class OpenVINOCompatibilityReport:
    policy_type: str
    expected_state_shape: tuple[int, ...]
    actual_state_shape: tuple[int, ...]
    expected_action_shape: tuple[int, ...]
    actual_action_shape: tuple[int, ...]
    camera_map: Mapping[str, str]
    missing_cameras: tuple[str, ...]
    mismatched_cameras: Mapping[str, str]

    @property
    def compatible(self) -> bool:
        return (
            self.expected_state_shape == self.actual_state_shape
            and self.expected_action_shape == self.actual_action_shape
            and not self.missing_cameras
        )


def _require_physicalai() -> Any:
    try:
        import openvino_tokenizers  # noqa: F401, PLC0415
        from physicalai.inference import InferenceModel
    except ModuleNotFoundError as error:
        missing = error.name or 'physicalai'
        raise PhysicalAIDependencyError(
            "Physical AI OpenVINO evaluation requires the 'physicalai' package. "
            "Install it with `pip install -e 'integrations/python[openvino]'`. "
            f'Missing dependency: {missing}.'
        ) from error
    return InferenceModel


def _package_directory(package_path: str | Path) -> Path:
    """Accept the package directory or a file inside it (``manifest.json``, ``act.xml``)."""
    path = Path(package_path).expanduser()
    if path.is_file():
        path = path.parent
    if not (path / 'manifest.json').is_file():
        raise FileNotFoundError(
            f'Physical AI package directory {str(path)!r} has no manifest.json; '
            'pass the extracted package directory.'
        )
    return path


def _feature_type(feature: Any) -> str:
    value = getattr(feature, 'ftype', '')
    return str(getattr(value, 'value', value)).upper()


def _feature_name(feature: Any) -> str:
    return str(getattr(feature, 'name', '')).strip()


def _feature_shape(feature: Any) -> tuple[int, ...]:
    shape = getattr(feature, 'shape', ())
    return tuple(int(dimension) for dimension in shape)


def _find_feature(features: Sequence[Any], feature_type: str, name: str | None = None) -> Any | None:
    for feature in features:
        if _feature_type(feature) != feature_type:
            continue
        if name is None or _feature_name(feature) == name:
            return feature
    return None


def _camera_key(feature_name: str) -> str:
    return feature_name.removeprefix('images.')


def _image_height_width(shape: Sequence[int]) -> tuple[int, int] | None:
    if len(shape) != 3:
        return None
    if shape[0] in (1, 3, 4):
        return shape[1], shape[2]
    if shape[2] in (1, 3, 4):
        return shape[0], shape[1]
    return None


def _action_dimension(shape: Sequence[int]) -> int:
    if not shape or any(dimension < 1 for dimension in shape):
        raise ValueError(f'Physical AI action feature has an invalid shape {tuple(shape)}.')
    return shape[-1]


def _as_numpy_action(action: Any) -> np.ndarray:
    values = np.asarray(action, dtype=np.float32)
    if values.ndim == 2:
        values = values[0]
    elif values.ndim == 3:
        if values.shape[0] != 1:
            raise PhysicalAICompatibilityError(
                f'Physical AI returned an unsupported action shape {values.shape}.'
            )
        values = values[0, 0]
    if values.ndim != 1:
        raise PhysicalAICompatibilityError(
            f'Physical AI action must have shape (action_dim,), got {values.shape}.'
        )
    if not np.isfinite(values).all():
        raise PhysicalAICompatibilityError('Physical AI returned a non-finite action.')
    return values.copy()


def _as_numpy_actions(action: Any, batch_size: int) -> np.ndarray:
    """Batched counterpart of ``_as_numpy_action``: ``(B, A)`` as is, ``(B, T, A)`` chunks use step 0."""
    values = np.asarray(action, dtype=np.float32)
    if values.ndim == 1 and batch_size == 1:
        values = values[np.newaxis, :]
    elif values.ndim == 3:
        values = values[:, 0]
    if values.ndim != 2 or values.shape[0] != batch_size:
        raise PhysicalAICompatibilityError(
            f'Physical AI actions must have shape ({batch_size}, action_dim), got {values.shape}.'
        )
    if not np.isfinite(values).all():
        raise PhysicalAICompatibilityError('Physical AI returned a non-finite action.')
    return values.copy()


class ChunkExecutor:
    """Turns predicted action chunks into one action per step.

    By default a chunk is executed to the end before the policy sees the cameras again (ACT's
    100-step chunk is 3.3 s at 30 Hz, the whole reach and grasp). ``action_steps`` re-plans after
    that many actions; ``temporal_ensemble`` predicts at every step and averages the overlapping
    chunks with weights ``exp(-coefficient * i)``, oldest prediction first, as in the ACT paper.
    """

    def __init__(self, *, action_steps: int | None = None, temporal_ensemble: float | None = None) -> None:
        if action_steps is not None and action_steps < 1:
            raise ValueError('action_steps must be at least 1.')
        if temporal_ensemble is not None and temporal_ensemble < 0:
            raise ValueError('temporal_ensemble must be zero or positive.')
        if action_steps is not None and temporal_ensemble is not None:
            raise ValueError('Use either action_steps or temporal_ensemble, not both.')
        self.action_steps = action_steps
        self.temporal_ensemble = temporal_ensemble
        self._queue: list[np.ndarray] = []
        self._chunks: list[np.ndarray] = []

    @property
    def active(self) -> bool:
        return self.action_steps is not None or self.temporal_ensemble is not None

    def reset(self) -> None:
        self._queue.clear()
        self._chunks.clear()

    def needs_prediction(self) -> bool:
        return self.temporal_ensemble is not None or not self._queue

    def next_action(self, chunk: np.ndarray | None) -> np.ndarray:
        """Return this step's action; ``chunk`` is the new prediction when one was needed."""
        if chunk is not None:
            chunk = np.asarray(chunk, dtype=np.float64)
            if chunk.ndim == 3 and chunk.shape[0] == 1:
                chunk = chunk[0]
            if chunk.ndim != 2 or not len(chunk):
                raise PhysicalAICompatibilityError(
                    f'Physical AI returned an action chunk of shape {chunk.shape}; expected (T, A).'
                )
            if self.temporal_ensemble is None:
                self._queue = list(chunk[: self.action_steps or len(chunk)])
            else:
                self._chunks.append(chunk)
        if self.temporal_ensemble is None:
            return self._queue.pop(0)
        # Oldest first: chunk k was predicted len(chunks) - 1 - k steps ago.
        candidates = [
            chunk[len(self._chunks) - 1 - index]
            for index, chunk in enumerate(self._chunks)
            if len(self._chunks) - 1 - index < len(chunk)
        ]
        self._chunks = [
            chunk
            for index, chunk in enumerate(self._chunks)
            if len(self._chunks) - 1 - index < len(chunk) - 1
        ]
        weights = np.exp(-self.temporal_ensemble * np.arange(len(candidates)))
        return np.average(np.stack(candidates), axis=0, weights=weights)

    def describe(self) -> dict[str, Any]:
        if self.temporal_ensemble is not None:
            return {'actionExecution': 'temporal-ensemble', 'temporalEnsemble': self.temporal_ensemble}
        if self.action_steps is not None:
            return {'actionExecution': 'action-steps', 'actionSteps': self.action_steps}
        return {'actionExecution': 'full-chunk'}


def add_action_execution_arguments(
    parser: argparse.ArgumentParser, *, default_action_steps: int | None = None
) -> None:
    """``--action-steps`` / ``--temporal-ensemble`` for chunked policies such as ACT."""
    whole = 'run the whole predicted chunk'
    group = parser.add_mutually_exclusive_group()
    group.add_argument(
        '--action-steps',
        type=int,
        metavar='N',
        default=default_action_steps,
        help='Re-plan from the cameras after N actions of each predicted chunk '
        f'(default: {default_action_steps or whole}; pass the chunk size, 100 for ACT, to {whole}).',
    )
    group.add_argument(
        '--temporal-ensemble',
        type=float,
        metavar='COEFF',
        help='Predict a chunk at every step and average the overlapping chunks, weighting older '
        'predictions by exp(-COEFF * age) (ACT paper: 0.01). Slower: one inference per step.',
    )


class PhysicalAIOpenVINORunner(PolicyRunnerMixin):
    """Evaluate a Physical AI policy package through its OpenVINO manifest.

    Physical AI owns manifest-driven preprocessing, tokenization, model
    execution, postprocessing, and action chunking. Studio owns the episode
    reset, authored-camera capture, and one-action-per-physics-step protocol.
    """

    compatibility_error = PhysicalAICompatibilityError

    def __init__(
        self,
        package_path: str | Path,
        *,
        device: str = DEFAULT_DEVICE,
        action_steps: int | None = None,
        temporal_ensemble: float | None = None,
    ) -> None:
        self.chunks = ChunkExecutor(action_steps=action_steps, temporal_ensemble=temporal_ensemble)
        inference_model = _require_physicalai()
        self.package_path = str(_package_directory(package_path))
        self.device = device
        self.policy_type: Literal['physicalai-openvino'] = PHYSICALAI_OPENVINO_POLICY_TYPE
        # The constructor is the stable entry point: physicalai 0.1.x also exposed
        # ``InferenceModel.load``, but 0.2.0 removed it.
        self.policy = inference_model(
            self.package_path,
            backend='openvino',
            device=device,
        )

        input_features = list(getattr(self.policy, 'input_features', ()))
        output_features = list(getattr(self.policy, 'output_features', ()))
        self._state_feature = _find_feature(input_features, 'STATE')
        self._action_feature = _find_feature(output_features, 'ACTION')
        self._camera_features = {
            _camera_key(_feature_name(feature)): feature
            for feature in input_features
            if _feature_type(feature) == 'VISUAL'
        }
        self._task_feature = _find_feature(input_features, 'LANGUAGE')
        if self._state_feature is None:
            raise ValueError("Physical AI package does not declare a STATE input feature.")
        if self._action_feature is None:
            raise ValueError("Physical AI package does not declare an ACTION output feature.")
        if not self._camera_features:
            raise ValueError("Physical AI package does not declare a VISUAL input feature.")

        self._state_shape = _feature_shape(self._state_feature)
        self._action_shape = _feature_shape(self._action_feature)
        self._action_dimension = _action_dimension(self._action_shape)
        self._camera_map: dict[str, str] = {}
        self._camera_target_hw: dict[str, tuple[int, int]] = {}
        self._description: Mapping[str, Any] | None = None
        self._task_text = ''

    @property
    def requires_task_text(self) -> bool:
        return self._task_feature is not None

    @property
    def expected_state_shape(self) -> tuple[int, ...]:
        return self._state_shape

    @property
    def expected_action_shape(self) -> tuple[int, ...]:
        return self._action_shape

    @property
    def expected_action_dimension(self) -> int:
        return self._action_dimension

    @property
    def expected_camera_keys(self) -> tuple[str, ...]:
        return tuple(self._camera_features)

    def validate_description(self, description: Mapping[str, Any]) -> OpenVINOCompatibilityReport:
        actual_state_shape = (len(description.get('state', [])),)
        actual_action_shape = (len(description.get('actions', [])),)
        camera_descriptions = {
            str(camera.get('outputName')): camera
            for camera in description.get('cameras', [])
            if isinstance(camera, Mapping) and camera.get('outputName')
        }
        camera_map = self._resolve_camera_map(tuple(camera_descriptions))
        mismatched: dict[str, str] = {}
        camera_target_hw: dict[str, tuple[int, int]] = {}
        for studio_name, feature_key in camera_map.items():
            camera = camera_descriptions[studio_name]
            expected_shape = _feature_shape(self._camera_features[feature_key])
            expected_hw = _image_height_width(expected_shape)
            actual_hw = (int(camera.get('height', 0)), int(camera.get('width', 0)))
            if expected_hw is None:
                mismatched[feature_key] = (
                    f'checkpoint shape {expected_shape or "unknown"}; '
                    f"Studio camera {studio_name!r} provides HWC {actual_hw + (3,)}"
                )
                continue
            camera_target_hw[feature_key] = expected_hw
            if expected_hw != actual_hw:
                mismatched[feature_key] = (
                    f'checkpoint shape {expected_shape or "unknown"}; '
                    f"Studio camera {studio_name!r} provides HWC {actual_hw + (3,)}"
                )
                _logger.warning(
                    "Studio camera %r will be resized from %s to %s to match the checkpoint; "
                    "consider matching Evaluate's camera resolution to your training run for "
                    "best fidelity.",
                    studio_name,
                    actual_hw,
                    expected_hw,
                )

        report = OpenVINOCompatibilityReport(
            policy_type=self.policy_type,
            expected_state_shape=(self._state_shape[-1],) if self._state_shape else (),
            actual_state_shape=actual_state_shape,
            expected_action_shape=(self._action_dimension,),
            actual_action_shape=actual_action_shape,
            camera_map=dict(camera_map),
            missing_cameras=tuple(
                key for key in self.expected_camera_keys if key not in camera_map.values()
            ),
            mismatched_cameras=mismatched,
        )
        self._description = description
        self._camera_map = dict(camera_map)
        self._camera_target_hw = camera_target_hw
        if not report.compatible:
            raise PhysicalAICompatibilityError(self._format_compatibility_error(report), report)
        return report

    def set_task(self, task: str) -> None:
        task = task.strip()
        if self.requires_task_text and not task:
            raise ValueError('This Physical AI package requires the task text used during training.')
        self._task_text = task

    def reset_policy(self, task: str | None = None) -> None:
        if task is not None:
            self.set_task(task)
        elif self.requires_task_text and not self._task_text:
            raise ValueError('This Physical AI package requires task text before reset.')
        reset = getattr(self.policy, 'reset', None)
        if callable(reset):
            reset()
        self.chunks.reset()

    def _make_policy_instance(self) -> PhysicalAIOpenVINORunner:
        """Load an independent package instance for one ``per-env`` vector row."""
        policy = type(self)(
            self.package_path,
            device=str(self.device),
            action_steps=self.chunks.action_steps,
            temporal_ensemble=self.chunks.temporal_ensemble,
        )
        if self._description is not None:
            policy.validate_description(self._description)
        policy._task_text = self._task_text
        return policy

    def observation_batch(
        self,
        observation: Observation,
        task: str | None = None,
    ) -> dict[str, Any]:
        if self._description is None:
            raise PhysicalAICompatibilityError(
                'Call validate_description() before building policy inputs.'
            )
        if task is not None:
            self.set_task(task)
        if self.requires_task_text and not self._task_text:
            raise ValueError('This Physical AI package requires task text.')

        batch: dict[str, Any] = {
            'state': np.asarray(observation.state, dtype=np.float32)[np.newaxis, :],
        }
        for studio_name, feature_key in self._camera_map.items():
            image = observation.images.get(studio_name)
            if image is None:
                raise PhysicalAICompatibilityError(
                    f"Studio observation is missing camera output {studio_name!r}."
                )
            image_array = np.asarray(image)
            target_hw = self._camera_target_hw.get(feature_key)
            if (
                target_hw is not None
                and image_array.ndim == 3
                and image_array.shape[:2] != target_hw
            ):
                from PIL import Image

                target_height, target_width = target_hw
                image_array = np.array(
                    Image.fromarray(image_array.astype(np.uint8), mode='RGB').resize(
                        (target_width, target_height), Image.BILINEAR
                    ),
                    dtype=np.uint8,
                )
            batch[f'images.{feature_key}'] = image_array[np.newaxis, ...]
        if self._task_feature is not None:
            batch['task'] = [self._task_text]
        return batch

    def select_action(self, observation: Observation, task: str | None = None) -> np.ndarray:
        batch = self.observation_batch(observation, task)
        if self.chunks.active:
            chunk = self.policy.predict_action_chunk(batch) if self.chunks.needs_prediction() else None
            values = _as_numpy_action(self.chunks.next_action(chunk))
        else:
            values = _as_numpy_action(self.policy.select_action(batch))
        if values.shape != (self._action_dimension,):
            raise PhysicalAICompatibilityError(
                f'Physical AI returned {values.shape}; '
                f'Studio expects {(self._action_dimension,)}.'
            )
        return values

    def infer_action_batch(self, states: np.ndarray, images: Mapping[str, np.ndarray], task: str | None = None) -> np.ndarray:
        if self._description is None:
            raise PhysicalAICompatibilityError('Call validate_description() before batched inference.')
        if task is not None:
            self.set_task(task)
        if self.requires_task_text and not self._task_text:
            raise ValueError('This Physical AI package requires task text.')
        if self.chunks.active:
            raise PhysicalAICompatibilityError(
                '--action-steps and --temporal-ensemble need --policy-batching per-env with --num-envs.'
            )
        state_batch = np.asarray(states, dtype=np.float32)
        if state_batch.ndim != 2 or (self._state_shape and state_batch.shape[1] != self._state_shape[-1]):
            raise PhysicalAICompatibilityError('Vector state batch has an incompatible shape.')
        batch: dict[str, Any] = {'state': state_batch}
        for studio_name, feature_key in self._camera_map.items():
            images_array = np.asarray(images[studio_name])
            if images_array.ndim != 4 or images_array.dtype != np.uint8:
                raise PhysicalAICompatibilityError(f'Camera {studio_name!r} must have NHWC uint8 layout.')
            target_hw = self._camera_target_hw.get(feature_key)
            if target_hw is not None and images_array.shape[1:3] != target_hw:
                from PIL import Image

                height, width = target_hw
                images_array = np.stack([
                    np.asarray(Image.fromarray(image).resize((width, height), Image.BILINEAR), dtype=np.uint8)
                    for image in images_array
                ])
            batch[f'images.{feature_key}'] = images_array
        if self._task_feature is not None:
            batch['task'] = [self._task_text] * len(state_batch)
        values = _as_numpy_actions(self.policy.select_action(batch), len(state_batch))
        if values.shape != (len(state_batch), self._action_dimension):
            raise PhysicalAICompatibilityError(
                f'Physical AI returned {values.shape}; '
                f'Studio expects {(len(state_batch), self._action_dimension)}.'
            )
        return values

    def infer_action_one(self, state: np.ndarray, images: Mapping[str, np.ndarray], task: str | None = None) -> np.ndarray:
        return self.select_action(Observation(
            state=np.asarray(state, dtype=np.float32),
            images={name: np.asarray(value, dtype=np.uint8) for name, value in images.items()},
            episode_id='vector-policy',
            step_id=0,
            simulation_time=0.0,
            physics_steps=1,
        ), task)

    def _format_compatibility_error(self, report: OpenVINOCompatibilityReport) -> str:
        problems: list[str] = []
        if report.expected_state_shape != report.actual_state_shape:
            problems.append(
                f'Physical AI state {report.expected_state_shape} vs '
                f'Studio {report.actual_state_shape}'
            )
        if report.expected_action_shape != report.actual_action_shape:
            problems.append(
                f'Physical AI action {report.expected_action_shape} vs '
                f'Studio {report.actual_action_shape}'
            )
        if report.missing_cameras:
            problems.append(f'missing Studio camera mappings: {", ".join(report.missing_cameras)}')
        problems.extend(
            f'camera {name}: {message}' for name, message in report.mismatched_cameras.items()
        )
        return 'Physical AI OpenVINO package is incompatible with the Studio profile: ' + '; '.join(
            problems
        )


def main() -> None:
    from .evaluation_report import (
        add_evaluation_arguments,
        evaluation_environment,
        physicalai_checkpoint_files,
        run_policy_evaluation,
        validate_evaluation_arguments,
    )

    parser = argparse.ArgumentParser(
        description='Evaluate a Physical AI OpenVINO policy package in Physical AI Scene Builder.'
    )
    parser.add_argument('--package', required=True, help='Extracted Physical AI policy package.')
    parser.add_argument('--device', default=DEFAULT_DEVICE, choices=('AUTO', 'CPU', 'GPU', 'NPU'))
    parser.add_argument('--task', default='', help='Task text used during policy training.')
    add_action_execution_arguments(parser)
    add_evaluation_arguments(parser)
    args = parser.parse_args()
    try:
        validate_evaluation_arguments(args)
    except ValueError as error:
        parser.error(str(error))

    runner = PhysicalAIOpenVINORunner(
        args.package,
        device=args.device,
        action_steps=args.action_steps,
        temporal_ensemble=args.temporal_ensemble,
    )
    package = Path(args.package).resolve()
    with evaluation_environment(args) as environment:
        run_policy_evaluation(
            runner,
            environment,
            args,
            policy={
                'framework': 'physicalai-openvino',
                'checkpoint': str(package),
                'task': args.task,
                **runner.chunks.describe(),
            },
            checkpoint_files=physicalai_checkpoint_files(package),
            checkpoint_root=package,
            task=args.task,
        )


if __name__ == '__main__':
    main()
