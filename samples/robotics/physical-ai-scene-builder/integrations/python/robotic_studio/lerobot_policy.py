# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import argparse
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

import numpy as np

from .environment import Observation
from .evaluation_loop import PolicyRunnerMixin

LEROBOT_MODEL_TYPES = ('act', 'pi05')
DEFAULT_DEVICE = 'auto'

_logger = logging.getLogger(__name__)


class LeRobotDependencyError(ImportError):
    """LeRobot and torch are not installed in the worker environment."""


class LeRobotCompatibilityError(RuntimeError):
    """A LeRobot checkpoint does not match the active Studio environment."""

    def __init__(
        self,
        message: str,
        report: LeRobotCompatibilityReport | None = None,
    ) -> None:
        super().__init__(message)
        self.report = report


@dataclass(frozen=True)
class LeRobotCompatibilityReport:
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


def _require_lerobot() -> Any:
    try:
        from lerobot.configs.policies import PreTrainedConfig
        from lerobot.policies.factory import get_policy_class, make_pre_post_processors
        from lerobot.utils.device_utils import auto_select_torch_device, get_safe_torch_device
    except ModuleNotFoundError as error:
        missing = error.name or 'lerobot'
        raise LeRobotDependencyError(
            "LeRobot evaluation requires the 'lerobot' and 'torch' packages. "
            "Install them with `pip install -e 'integrations/python[lerobot]'`. "
            f'Missing dependency: {missing}.'
        ) from error

    def resolve_device(name: str) -> str:
        return str(auto_select_torch_device() if name == 'auto' else get_safe_torch_device(name))

    return PreTrainedConfig, get_policy_class, make_pre_post_processors, resolve_device


def _to_numpy(action: Any) -> np.ndarray:
    detach = getattr(action, 'detach', None)
    if callable(detach):
        action = detach().to('cpu').numpy()
    return np.asarray(action, dtype=np.float32)


def _as_numpy_action(action: Any) -> np.ndarray:
    values = _to_numpy(action)
    if values.ndim == 2:
        values = values[0]
    if values.ndim != 1:
        raise LeRobotCompatibilityError(
            f'LeRobot policy must return an action shaped (action_dim,), got {values.shape}.'
        )
    if not np.isfinite(values).all():
        raise LeRobotCompatibilityError('LeRobot policy returned a non-finite action.')
    return values.copy()


def _as_numpy_actions(action: Any, batch_size: int) -> np.ndarray:
    """Batched counterpart of ``_as_numpy_action``: one ``(action_dim,)`` row per environment."""
    values = _to_numpy(action)
    if values.ndim == 1 and batch_size == 1:
        values = values[np.newaxis, :]
    if values.ndim != 2 or values.shape[0] != batch_size:
        raise LeRobotCompatibilityError(
            f'LeRobot policy must return actions shaped ({batch_size}, action_dim), got {values.shape}.'
        )
    if not np.isfinite(values).all():
        raise LeRobotCompatibilityError('LeRobot policy returned a non-finite action.')
    return values.copy()


def apply_action_execution(
    config: Any, *, action_steps: int | None = None, temporal_ensemble: float | None = None
) -> None:
    """Set how many actions of each predicted chunk run before re-planning (LeRobot ACT config).

    LeRobot ACT queues ``n_action_steps`` actions per prediction (100 by default: 3.3 s blind).
    ``temporal_ensemble`` uses LeRobot's own ensembler, which needs ``n_action_steps == 1``.
    """
    if action_steps is None and temporal_ensemble is None:
        return
    if action_steps is not None and temporal_ensemble is not None:
        raise ValueError('Use either action_steps or temporal_ensemble, not both.')
    chunk_size = getattr(config, 'chunk_size', None)
    if chunk_size is None or not hasattr(config, 'n_action_steps'):
        raise ValueError(
            f"--action-steps and --temporal-ensemble need a chunked policy such as ACT, not '{config.type}'."
        )
    if temporal_ensemble is not None:
        if temporal_ensemble < 0:
            raise ValueError('temporal_ensemble must be zero or positive.')
        if not hasattr(config, 'temporal_ensemble_coeff'):
            raise ValueError(f"'{config.type}' does not support --temporal-ensemble.")
        config.temporal_ensemble_coeff = temporal_ensemble
        config.n_action_steps = 1
        return
    if not 1 <= action_steps <= chunk_size:
        raise ValueError(f'action_steps must be between 1 and the chunk size ({chunk_size}).')
    if getattr(config, 'temporal_ensemble_coeff', None) is not None:
        config.temporal_ensemble_coeff = None
    config.n_action_steps = action_steps


class LeRobotRunner(PolicyRunnerMixin):
    """Evaluate a LeRobot-native policy checkpoint (config.json + model.safetensors).

    LeRobot owns normalization, tokenization, model execution, and action chunking
    through its own pre/post-processor pipelines. Studio owns the episode reset,
    authored-camera capture, and one-action-per-physics-step protocol.
    """

    compatibility_error = LeRobotCompatibilityError

    def __init__(
        self,
        checkpoint_path: str | Path,
        *,
        device: str = DEFAULT_DEVICE,
        action_steps: int | None = None,
        temporal_ensemble: float | None = None,
    ) -> None:
        PreTrainedConfig, get_policy_class, make_pre_post_processors, resolve_device = (
            _require_lerobot()
        )
        from lerobot.utils.constants import OBS_IMAGES

        self.checkpoint_path = str(checkpoint_path)
        config = PreTrainedConfig.from_pretrained(self.checkpoint_path)
        config.device = resolve_device(device)
        self.action_steps = action_steps
        self.temporal_ensemble = temporal_ensemble
        apply_action_execution(config, action_steps=action_steps, temporal_ensemble=temporal_ensemble)
        self.policy_type = str(config.type)
        self.device = config.device

        policy_cls = get_policy_class(config.type)
        self.policy = policy_cls.from_pretrained(self.checkpoint_path, config=config)
        self.policy.eval()
        self.preprocessor, self.postprocessor = make_pre_post_processors(
            policy_cfg=config,
            pretrained_path=self.checkpoint_path,
            preprocessor_overrides={'device_processor': {'device': self.device}},
        )

        state_feature = config.robot_state_feature
        action_feature = config.action_feature
        if state_feature is None:
            raise ValueError("LeRobot checkpoint does not declare an 'observation.state' input feature.")
        if action_feature is None:
            raise ValueError("LeRobot checkpoint does not declare an 'action' output feature.")

        self._state_shape = tuple(state_feature.shape)
        self._action_shape = tuple(action_feature.shape)
        self._state_names = tuple(str(name) for name in getattr(state_feature, "names", ()) or ())
        self._action_names = tuple(str(name) for name in getattr(action_feature, "names", ()) or ())
        self._action_dimension = self._action_shape[-1]
        image_prefix = f'{OBS_IMAGES}.'
        self._camera_features = {
            key.removeprefix(image_prefix): feature
            for key, feature in config.image_features.items()
        }
        if not self._camera_features:
            raise ValueError("LeRobot checkpoint does not declare an 'observation.images.*' input feature.")

        self._camera_map: dict[str, str] = {}
        self._camera_target_hw: dict[str, tuple[int, int]] = {}
        self._description: Mapping[str, Any] | None = None
        self._scene_fingerprint: str | None = None
        self._task_text = ''

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

    def validate_description(self, description: Mapping[str, Any]) -> LeRobotCompatibilityReport:
        actual_state_shape = (len(description.get('state', [])),)
        actual_action_shape = (len(description.get('actions', [])),)
        camera_descriptions = {
            str(camera.get('outputName')): camera
            for camera in description.get('cameras', [])
            if isinstance(camera, Mapping) and camera.get('outputName')
        }
        state_names = tuple(str(field.get("name", "")) for field in description.get("state", []))
        action_names = tuple(str(field.get("name", "")) for field in description.get("actions", []))
        declared_state_names = tuple(str(name) for name in getattr(self, "_state_names", ()) or ())
        declared_action_names = tuple(str(name) for name in getattr(self, "_action_names", ()) or ())
        name_mismatches: list[str] = []
        if declared_state_names and state_names != declared_state_names:
            name_mismatches.append(
                f"LeRobot state field order {declared_state_names} does not match Studio {state_names}."
            )
        if declared_action_names and action_names != declared_action_names:
            name_mismatches.append(
                f"LeRobot action field order {declared_action_names} does not match Studio {action_names}."
            )
        camera_map = self._resolve_camera_map(tuple(camera_descriptions))
        mismatched: dict[str, str] = {}
        camera_target_hw: dict[str, tuple[int, int]] = {}
        for studio_name, feature_key in camera_map.items():
            camera = camera_descriptions[studio_name]
            expected_shape = tuple(self._camera_features[feature_key].shape)
            expected_hw = expected_shape[-2:]
            actual_hw = (int(camera.get('height', 0)), int(camera.get('width', 0)))
            camera_target_hw[feature_key] = expected_hw
            if expected_hw != actual_hw:
                mismatched[feature_key] = (
                    f'checkpoint shape {expected_shape}; '
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

        report = LeRobotCompatibilityReport(
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
        fingerprint = description.get("sceneFingerprint")
        self._scene_fingerprint = str(fingerprint) if fingerprint else None
        self._camera_map = dict(camera_map)
        self._camera_target_hw = camera_target_hw
        if name_mismatches:
            raise LeRobotCompatibilityError(" ".join(name_mismatches))
        if not report.compatible:
            raise LeRobotCompatibilityError(self._format_compatibility_error(report), report)
        return report

    def reset_policy(self, task: str | None = None) -> None:
        if task is not None:
            self._task_text = task.strip()
        self.policy.reset()

    def describe_action_execution(self) -> dict[str, Any]:
        """Run-record fields for --action-steps / --temporal-ensemble (empty when unset)."""
        if self.temporal_ensemble is not None:
            return {'actionExecution': 'temporal-ensemble', 'temporalEnsemble': self.temporal_ensemble}
        if self.action_steps is not None:
            return {'actionExecution': 'action-steps', 'actionSteps': self.action_steps}
        return {}

    def _make_policy_instance(self) -> LeRobotRunner:
        """Load an independent checkpoint instance for one ``per-env`` vector row."""
        policy = type(self)(
            self.checkpoint_path,
            device=str(self.device),
            action_steps=self.action_steps,
            temporal_ensemble=self.temporal_ensemble,
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
            raise LeRobotCompatibilityError('Call validate_description() before building policy inputs.')
        if task is not None:
            self._task_text = task.strip()

        import torch
        from lerobot.utils.constants import OBS_IMAGES, OBS_STATE

        state = torch.from_numpy(np.asarray(observation.state, dtype=np.float32)).unsqueeze(0)
        batch: dict[str, Any] = {OBS_STATE: state, 'task': [self._task_text]}
        for studio_name, feature_key in self._camera_map.items():
            image = observation.images.get(studio_name)
            if image is None:
                raise LeRobotCompatibilityError(
                    f"Studio observation is missing camera output {studio_name!r}."
                )
            image_array = np.asarray(image)
            if image_array.dtype != np.uint8 or image_array.ndim != 3:
                raise LeRobotCompatibilityError(
                    f"Studio camera {studio_name!r} did not provide an HWC uint8 image."
                )
            target_hw = self._camera_target_hw.get(feature_key)
            if target_hw is not None and image_array.shape[:2] != target_hw:
                from PIL import Image

                target_height, target_width = target_hw
                image_array = np.array(
                    Image.fromarray(image_array, mode='RGB').resize(
                        (target_width, target_height), Image.BILINEAR
                    ),
                    dtype=np.uint8,
                )
            image_tensor = torch.from_numpy(image_array).permute(2, 0, 1).unsqueeze(0)
            batch[f'{OBS_IMAGES}.{feature_key}'] = image_tensor.float() / 255.0
        return batch

    def observation_batch_vector(
        self,
        states: np.ndarray,
        images: Mapping[str, np.ndarray],
        task: str | None = None,
    ) -> dict[str, Any]:
        """Build policy tensors from a leading-num_envs batch."""
        if self._description is None:
            raise LeRobotCompatibilityError('Call validate_description() before building policy inputs.')
        if task is not None:
            self._task_text = task.strip()
        import torch
        from lerobot.utils.constants import OBS_IMAGES, OBS_STATE

        state = np.asarray(states, dtype=np.float32)
        if state.ndim != 2 or (self._state_shape and state.shape[1] != self._state_shape[-1]):
            raise LeRobotCompatibilityError('Vector state batch has an incompatible shape.')
        batch: dict[str, Any] = {OBS_STATE: torch.from_numpy(state), 'task': [self._task_text] * len(state)}
        for studio_name, feature_key in self._camera_map.items():
            if studio_name not in images:
                raise LeRobotCompatibilityError(f'Studio observation is missing camera output {studio_name!r}.')
            image_batch = np.asarray(images[studio_name])
            if image_batch.dtype != np.uint8 or image_batch.ndim != 4 or image_batch.shape[-1] != 3:
                raise LeRobotCompatibilityError(f'Camera {studio_name!r} must have NHWC uint8 layout.')
            target_hw = self._camera_target_hw.get(feature_key)
            if target_hw is not None and image_batch.shape[1:3] != target_hw:
                from PIL import Image

                height, width = target_hw
                image_batch = np.stack([
                    np.asarray(Image.fromarray(image).resize((width, height), Image.BILINEAR), dtype=np.uint8)
                    for image in image_batch
                ])
            batch[f'{OBS_IMAGES}.{feature_key}'] = torch.from_numpy(image_batch).permute(0, 3, 1, 2).float() / 255.0
        return batch

    def select_action(self, observation: Observation, task: str | None = None) -> np.ndarray:
        import torch

        batch = self.observation_batch(observation, task)
        batch = self.preprocessor(batch)
        with torch.inference_mode():
            action = self.policy.select_action(batch)
        action = self.postprocessor(action)
        values = _as_numpy_action(action)
        if values.shape != (self._action_dimension,):
            raise LeRobotCompatibilityError(
                f'LeRobot policy returned {values.shape}; Studio expects {(self._action_dimension,)}.'
            )
        return values

    def infer_action_batch(self, states: np.ndarray, images: Mapping[str, np.ndarray], task: str | None = None) -> np.ndarray:
        import torch

        batch = self.preprocessor(self.observation_batch_vector(states, images, task))
        with torch.inference_mode():
            action = self.policy.select_action(batch)
        values = _as_numpy_actions(self.postprocessor(action), len(states))
        if values.shape != (len(states), self._action_dimension):
            raise LeRobotCompatibilityError(
                f'LeRobot policy returned {values.shape}; Studio expects {(len(states), self._action_dimension)}.'
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

    def _format_compatibility_error(self, report: LeRobotCompatibilityReport) -> str:
        problems: list[str] = []
        if report.expected_state_shape != report.actual_state_shape:
            problems.append(
                f'LeRobot state {report.expected_state_shape} vs Studio {report.actual_state_shape}'
            )
        if report.expected_action_shape != report.actual_action_shape:
            problems.append(
                f'LeRobot action {report.expected_action_shape} vs Studio {report.actual_action_shape}'
            )
        if report.missing_cameras:
            problems.append(f'missing Studio camera mappings: {", ".join(report.missing_cameras)}')
        problems.extend(
            f'camera {name}: {message}' for name, message in report.mismatched_cameras.items()
        )
        return 'LeRobot checkpoint is incompatible with the Studio profile: ' + '; '.join(problems)


def main() -> None:
    from .evaluation_report import (
        add_evaluation_arguments,
        evaluation_environment,
        lerobot_checkpoint_files,
        run_policy_evaluation,
        validate_evaluation_arguments,
    )
    from .physicalai_openvino import add_action_execution_arguments

    parser = argparse.ArgumentParser(
        description='Evaluate a LeRobot-native policy checkpoint in Physical AI Scene Builder.'
    )
    parser.add_argument(
        '--checkpoint',
        required=True,
        help="LeRobot pretrained_model checkpoint directory (contains config.json and model.safetensors).",
    )
    parser.add_argument('--device', default=DEFAULT_DEVICE, help='Torch device, e.g. auto, cpu, cuda.')
    parser.add_argument('--task', default='', help='Task text used during policy training.')
    add_action_execution_arguments(parser)
    add_evaluation_arguments(parser)
    args = parser.parse_args()
    try:
        validate_evaluation_arguments(args)
    except ValueError as error:
        parser.error(str(error))

    try:
        runner = LeRobotRunner(
            args.checkpoint,
            device=args.device,
            action_steps=args.action_steps,
            temporal_ensemble=args.temporal_ensemble,
        )
    except ValueError as error:
        parser.error(str(error))
    checkpoint = Path(args.checkpoint).resolve()
    with evaluation_environment(args) as environment:
        run_policy_evaluation(
            runner,
            environment,
            args,
            policy={
                'framework': 'lerobot',
                'checkpoint': str(checkpoint),
                'task': args.task,
                **runner.describe_action_execution(),
            },
            checkpoint_files=lerobot_checkpoint_files(checkpoint),
            checkpoint_root=checkpoint,
            task=args.task,
        )


if __name__ == '__main__':
    main()
