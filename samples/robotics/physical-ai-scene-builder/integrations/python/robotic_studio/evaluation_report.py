# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Shared command-line evaluation flow: flags, console summaries, videos, and run records.

Both policy CLIs (``robotic-studio-lerobot-eval``, ``robotic-studio-physicalai-openvino-eval``) and
the shipped example scripts call :func:`run_policy_evaluation`, so every entry point prints the same
per-episode lines and writes the same run record.
"""

from __future__ import annotations

import argparse
import json
import threading
from collections.abc import Callable, Iterator, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

import numpy as np

from .evaluation_cli import graceful_stop, progress_reporter
from .frame_clock import DEFAULT_CAPTURE_FPS, FrameClock, validate_capture_fps
from .evaluation_loop import (
    POLICY_BATCHING_MODES,
    EpisodeResult,
    checkpoint_fingerprint,
    create_run_record,
    format_success_rate,
    new_run_id,
    software_versions,
    summarize,
    write_run_record,
)
from .environment import DEFAULT_STUDIO_URL
from .policy_environment import Observation, PolicyEnvironment

DEFAULT_MAX_STEPS = 600
# Scripts start before the user clicks Start streaming, so allow time to switch to the browser.
DEFAULT_WAIT_TIMEOUT_S = 300.0


def add_evaluation_arguments(parser: argparse.ArgumentParser) -> None:
    """Connection, multi-episode, run-record, and video flags shared by every evaluation entry point."""
    parser.add_argument(
        '--studio-url',
        default=DEFAULT_STUDIO_URL,
        help=f'Physical AI Scene Builder URL (default: {DEFAULT_STUDIO_URL}).',
    )
    parser.add_argument(
        '--local',
        action='store_true',
        help=(
            'Simulate in this process instead of the Studio worker, from --scene-bundle and '
            '--profile, or from the active Evaluate scene downloaded from --studio-url.'
        ),
    )
    parser.add_argument('--scene-bundle', type=Path, help='Scene bundle (.mujoco-scene or directory) for --local.')
    parser.add_argument('--profile', type=Path, help='Evaluation profile JSON for --local (with --scene-bundle).')
    parser.add_argument(
        '--num-envs',
        type=int,
        default=1,
        help='Parallel simulated environments (needs --local; default: 1).',
    )
    parser.add_argument(
        '--policy-batching',
        choices=POLICY_BATCHING_MODES,
        default='batched',
        help=(
            'With --num-envs > 1: one batched policy call per step (batched), or one policy '
            'instance per environment for results identical to --num-envs 1 (per-env).'
        ),
    )
    parser.add_argument(
        '--wait-timeout',
        type=float,
        default=DEFAULT_WAIT_TIMEOUT_S,
        help=(
            'Seconds to wait for Start streaming in Physical AI Scene Builder '
            f'(default: {DEFAULT_WAIT_TIMEOUT_S:g}).'
        ),
    )
    parser.add_argument('--episodes', type=int, default=1, help='Number of seeded episodes (default: 1).')
    parser.add_argument(
        '--seed-start',
        type=int,
        default=None,
        help='First reset seed; episode i uses seed-start + i (default: 0).',
    )
    parser.add_argument('--seed', type=int, default=None, help='Alias for --seed-start.')
    parser.add_argument(
        '--max-steps',
        type=int,
        default=None,
        help=f'Steps before an episode is truncated (default: the scene task limit, else {DEFAULT_MAX_STEPS}).',
    )
    parser.add_argument(
        '--run-dir',
        type=Path,
        default=Path('./runs'),
        help='Directory for the JSON run record and videos (default: ./runs).',
    )
    parser.add_argument(
        '--record-video',
        action='append',
        default=[],
        metavar='CAMERA',
        help='Save an MP4 of this camera for every episode (repeatable). Needs the av package.',
    )
    parser.add_argument(
        '--unscored',
        action='store_true',
        help=(
            'Run even when the session has no success check (no task). Episodes then run to '
            '--max-steps and are not scored.'
        ),
    )
    parser.add_argument(
        '--no-terminate-on-success',
        action='store_true',
        help='Keep stepping after the task succeeds, until --max-steps.',
    )
    parser.add_argument(
        '--realtime-hz',
        type=float,
        default=None,
        help='Optionally pace policy commands to this wall-clock rate without skipping steps.',
    )
    parser.add_argument(
        '--fps',
        type=int,
        default=DEFAULT_CAPTURE_FPS,
        help=(
            'Policy actions per simulated second; match the training dataset '
            f'(default: {DEFAULT_CAPTURE_FPS}, the Generate capture rate).'
        ),
    )
    parser.add_argument('--status-interval', type=int, default=20, help='Steps between progress lines.')


def resolve_seed_start(args: argparse.Namespace) -> int:
    if args.seed_start is not None:
        return int(args.seed_start)
    return 0 if args.seed is None else int(args.seed)


RUN_RECORD_BACKENDS = frozenset({'sim', 'real-so101'})


def _num_envs(args: argparse.Namespace) -> int:
    value = getattr(args, 'num_envs', None)
    return 1 if value is None else int(value)


def validate_evaluation_arguments(args: argparse.Namespace) -> None:
    """Reject flag combinations the evaluation flow cannot honour, before opening any environment."""
    num_envs = _num_envs(args)
    if num_envs < 1:
        raise ValueError('--num-envs must be positive.')
    if num_envs > 1:
        if not getattr(args, 'local', False):
            raise ValueError('--num-envs greater than one requires --local.')
        if getattr(args, 'record_video', None):
            raise ValueError('--record-video is not supported with --num-envs greater than one.')
    if getattr(args, 'local', False) and (
        (getattr(args, 'scene_bundle', None) is None) != (getattr(args, 'profile', None) is None)
    ):
        raise ValueError(
            '--local needs both --scene-bundle and --profile, or neither to download the active '
            'Evaluate scene from --studio-url.'
        )


@contextmanager
def _local_scene_files(args: argparse.Namespace) -> Iterator[tuple[Path, Path]]:
    """Scene bundle and profile paths for ``--local``: the given files, or the active Studio scene."""
    if args.scene_bundle is not None and args.profile is not None:
        yield Path(args.scene_bundle), Path(args.profile)
        return
    import tempfile

    from .evaluation.local import download_evaluation_scene

    with tempfile.TemporaryDirectory(prefix='robotic-studio-local-evaluation-') as directory:
        print(f'Downloading the active Evaluate scene from {args.studio_url}.', flush=True)
        scene_bundle, profile = download_evaluation_scene(args.studio_url, destination=directory)
        profile_path = Path(directory) / 'profile.json'
        profile_path.write_text(json.dumps(profile), encoding='utf-8')
        yield scene_bundle, profile_path


@contextmanager
def evaluation_environment(args: argparse.Namespace) -> Iterator[Any]:
    """Open the local in-process runtime (``--local``), N local workers, or the Studio worker."""
    validate_evaluation_arguments(args)
    if getattr(args, 'local', False):
        from .runtime import load_profile
        from .vector_environment import SubprocessVectorEnvironment, open_local_evaluation

        num_envs = _num_envs(args)
        with _local_scene_files(args) as (scene_bundle, profile_path):
            if num_envs > 1:
                with SubprocessVectorEnvironment(
                    str(scene_bundle), str(profile_path), num_envs=num_envs
                ) as vector:
                    yield vector
                return
            local, close = open_local_evaluation(scene_bundle, load_profile(profile_path))
            try:
                yield local
            finally:
                close()
        return
    from .environment import StudioEnvironment

    with StudioEnvironment.connect(args.studio_url) as environment:
        print(
            f'Waiting for the Evaluate session at {args.studio_url}; '
            'click Start streaming in Physical AI Scene Builder.',
            flush=True,
        )
        environment.wait_for_studio(timeout_s=args.wait_timeout, acquire=False)
        yield environment


def resolve_max_steps(requested: int | None, description: Mapping[str, Any]) -> int:
    if requested is not None:
        if requested < 1:
            raise ValueError('--max-steps must be positive.')
        return requested
    task = description.get('task')
    limit = task.get('maxEpisodeSteps') if isinstance(task, Mapping) else None
    return int(limit) if isinstance(limit, int) and limit > 0 else DEFAULT_MAX_STEPS


NO_SUCCESS_CHECK_WARNING = (
    'Warning: this session has no success check, so episodes cannot be scored; each runs to '
    '--max-steps and is recorded as void.'
)
NO_TASK_IN_SESSION = (
    'This Evaluate session has no task, so episodes would not be scored (and the object start '
    'position is not randomized). In Physical AI Scene Builder, open Simulate > Task, turn on '
    'Score episodes, choose the object and target, then turn Stream to external app off and on '
    'again. To run without scores anyway, add --unscored.'
)
NO_TASK_IN_PROFILE = (
    'The --profile defines no pick-and-place task, so episodes would not be scored. Add a "task" '
    'to the profile, or add --unscored to run without scores.'
)


def unscored_problem(args: argparse.Namespace) -> str:
    """Why an evaluation without a success check stops before its first episode."""
    if getattr(args, 'local', False) and getattr(args, 'profile', None):
        return NO_TASK_IN_PROFILE
    return NO_TASK_IN_SESSION


def has_success_check(description: Mapping[str, Any]) -> bool:
    """Whether the worker reports task status (success/failure) for each step."""
    capabilities = description.get('capabilities')
    return isinstance(description.get('task'), Mapping) or (
        isinstance(capabilities, Mapping) and bool(capabilities.get('taskStatus'))
    )


def _void_unscored(result: EpisodeResult) -> str | None:
    """Without a success check a max-steps episode says nothing about the policy: exclude it."""
    return 'void' if result.outcome == 'truncated' else None


def lerobot_checkpoint_files(checkpoint: Path) -> list[Path]:
    """LeRobot checkpoint files that determine behaviour: config, weights, and processor JSONs."""
    root = checkpoint.resolve()
    files = {root / 'config.json', root / 'model.safetensors', *root.glob('*.json')}
    return sorted(path for path in files if path.is_file())


def physicalai_checkpoint_files(package: Path) -> list[Path]:
    """Physical AI package files: the manifest plus every XML/BIN it references."""
    root = package.resolve()
    manifest_path = root / 'manifest.json'
    files = [manifest_path]
    try:
        manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError):
        return []

    def referenced(value: Any) -> None:
        if isinstance(value, str) and value.lower().endswith(('.xml', '.bin')):
            candidate = (root / value).resolve()
            if candidate.is_file() and candidate.is_relative_to(root):
                files.append(candidate)
        elif isinstance(value, Mapping):
            for item in value.values():
                referenced(item)
        elif isinstance(value, list):
            for item in value:
                referenced(item)

    referenced(manifest)
    return sorted(set(files))


class _VideoWriter:
    """Streams RGB frames for one camera into an H.264 MP4 through PyAV."""

    def __init__(self, av: Any, path: Path, fps: float) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self._av = av
        self._container = av.open(str(path), mode='w')
        self._stream = self._container.add_stream('libx264', rate=max(1, round(fps)))
        self._stream.pix_fmt = 'yuv420p'
        self._sized = False

    def add(self, frame: np.ndarray) -> None:
        image = np.ascontiguousarray(frame[..., :3], dtype=np.uint8)
        if not self._sized:
            # H.264 with yuv420p needs even dimensions.
            self._stream.width = image.shape[1] - image.shape[1] % 2
            self._stream.height = image.shape[0] - image.shape[0] % 2
            self._sized = True
        image = image[: self._stream.height, : self._stream.width]
        for packet in self._stream.encode(self._av.VideoFrame.from_ndarray(image, format='rgb24')):
            self._container.mux(packet)

    def close(self) -> None:
        for packet in self._stream.encode():
            self._container.mux(packet)
        self._container.close()


class _Output(Protocol):
    def __call__(self, message: str) -> None: ...


def _print(message: str) -> None:
    print(message, flush=True)


@dataclass
class EvaluationReport:
    """Per-episode console lines, optional videos, and the final run record for one CLI run."""

    description: Mapping[str, Any]
    policy: Mapping[str, Any]
    settings: Mapping[str, Any]
    run_dir: Path
    total_episodes: int
    backend: str = 'sim'
    record_video: Sequence[str] = ()
    checkpoint_files: Sequence[Path] = ()
    checkpoint_root: Path | None = None
    output: _Output = _print
    action_fps: float | None = None
    scored: bool = True
    run_id: str = field(default_factory=new_run_id)
    videos: dict[int, dict[str, str]] = field(default_factory=dict)
    _writers: dict[str, _VideoWriter] = field(default_factory=dict)
    _episode_index: int = 0
    _video_backend: Any = None
    _video_unavailable: bool = False

    def __post_init__(self) -> None:
        cameras = {str(camera.get('name')) for camera in self.description.get('cameras', [])}
        unknown = [name for name in self.record_video if name not in cameras]
        if unknown:
            raise ValueError(
                f"--record-video camera(s) {', '.join(unknown)} are not in the evaluation profile "
                f"(available: {', '.join(sorted(cameras)) or 'none'})."
            )
        if self.record_video:
            try:
                import av  # noqa: PLC0415 - optional dependency
            except ModuleNotFoundError:
                self.output('Video recording needs the av package (pip install av); continuing without video.')
                self._video_unavailable = True
            else:
                self._video_backend = av

    @property
    def fps(self) -> float:
        if self.action_fps is not None:
            return self.action_fps
        timestep = float(self.description.get('timestep') or 0.0)
        physics_steps = int(self.description.get('physicsSteps') or 1)
        return 1.0 / (timestep * physics_steps) if timestep > 0 else 30.0

    def on_step(self, observation: Observation, _step: int) -> None:
        """Feed camera frames of the current episode to its video writers."""
        if self._video_backend is None:
            return
        for camera in self.record_video:
            image = observation.images.get(camera)
            if image is None:
                continue
            writer = self._writers.get(camera)
            if writer is None:
                path = self.run_dir / self.run_id / f'episode-{self._episode_index:03d}-{camera}.mp4'
                writer = self._writers[camera] = _VideoWriter(self._video_backend, path, self.fps)
            writer.add(np.asarray(image))

    def on_episode(self, index: int, result: EpisodeResult) -> None:
        """Close this episode's videos and print its outcome line."""
        paths: dict[str, str] = {}
        for camera, writer in self._writers.items():
            writer.close()
            paths[camera] = writer.path.relative_to(self.run_dir).as_posix()
        self._writers.clear()
        if paths:
            self.videos[index] = paths
        self._episode_index = index + 1
        seed = '?' if result.seed is None else result.seed
        if not self.scored and result.outcome == 'void':
            outcome = 'not scored (no success check)'
        else:
            reason = f' ({result.reason})' if result.reason and result.outcome != 'success' else ''
            outcome = f'{result.outcome}{reason}'
        self.output(
            f'Episode {index + 1}/{self.total_episodes} seed={seed} -> {outcome} '
            f'in {result.steps} steps ({result.final_observation.simulation_time:.1f} s sim)'
        )

    def close_videos(self) -> None:
        for writer in self._writers.values():
            writer.close()
        self._writers.clear()

    def environment_record(self) -> dict[str, Any]:
        description = self.description
        return {
            'backend': description.get('backend', 'native-worker'),
            'sceneId': description.get('sceneId'),
            'sceneFingerprint': description.get('sceneFingerprint'),
            'profileId': description.get('profileId'),
            'inputConvention': description.get('inputConvention'),
            'physicsSteps': description.get('physicsSteps'),
            'timestep': description.get('timestep'),
            'task': description.get('task'),
            'randomization': list(description.get('randomization') or []),
            'calibrationFingerprint': None,
            'cameras': [
                {
                    'name': camera.get('name'),
                    'width': camera.get('width'),
                    'height': camera.get('height'),
                    'device': None,
                }
                for camera in description.get('cameras', [])
            ],
        }

    def finish(self, results: Sequence[EpisodeResult]) -> Path:
        """Write the run record and print the success rate, CI, and record path."""
        self.close_videos()
        policy = dict(self.policy)
        if self.checkpoint_files:
            policy['checkpointFingerprint'] = checkpoint_fingerprint(
                list(self.checkpoint_files), self.run_dir / '.fingerprints.json', root=self.checkpoint_root
            )
        record = create_run_record(
            backend=self.backend,
            environment=self.environment_record(),
            policy=policy,
            settings=self.settings,
            episodes=results,
            software=software_versions(),
            run_id=self.run_id,
            videos=self.videos,
        )
        path = write_run_record(self.run_dir / f'{self.run_id}.json', record)
        summary = summarize(results)
        if results and not self.scored:
            self.output(
                f'Not scored: {len(results)} episode(s) ran without a success check, so there is '
                'no success rate. Run with --local and a --profile that defines a pick-and-place '
                'task to score episodes.'
            )
        elif summary.success_rate is not None:
            self.output(format_success_rate(summary.successes, summary.scored, summary.wilson95))
        elif results:
            self.output('No scored episodes (all void).')
        self.output(f'Run record: {path}')
        return path


class _EvaluatingRunner(Protocol):
    policy_type: str
    device: Any

    def validate_description(self, description: Mapping[str, Any]) -> Any: ...

    def evaluate(self, environment: PolicyEnvironment, **options: Any) -> list[EpisodeResult]: ...

    def evaluate_vector(self, environment: Any, **options: Any) -> list[EpisodeResult]: ...


def run_policy_evaluation(
    runner: _EvaluatingRunner,
    environment: Any,
    args: argparse.Namespace,
    *,
    policy: Mapping[str, Any],
    checkpoint_files: Sequence[Path] = (),
    checkpoint_root: Path | None = None,
    task: str | None = None,
    physics_steps: int | None = None,
    output: Callable[[str], None] = _print,
) -> tuple[list[EpisodeResult], Path]:
    """Validate, acquire, evaluate ``--episodes`` seeds, write the run record, then stop and release.

    ``environment`` comes from :func:`evaluation_environment` (or is an already connected Studio
    environment whose Evaluate session is ready). With ``--num-envs`` > 1 it must be the vector
    environment that :func:`evaluation_environment` opens.
    """
    validate_evaluation_arguments(args)
    num_envs = _num_envs(args)
    vectorized = num_envs > 1
    if vectorized and int(getattr(environment, 'num_envs', 0) or 0) != num_envs:
        raise ValueError('--num-envs greater than one needs the environment from evaluation_environment(args).')
    description = environment.describe()
    report = runner.validate_description(description)
    output(
        f'Compatible {runner.policy_type} policy on {runner.device}; '
        f'state={report.actual_state_shape}, action={report.actual_action_shape}, '
        f'cameras={dict(report.camera_map)}'
    )
    scored = has_success_check(description)
    if not scored:
        if not getattr(args, 'unscored', False):
            raise SystemExit(unscored_problem(args))
        output(NO_SUCCESS_CHECK_WARNING)
    seed_start = resolve_seed_start(args)
    max_steps = resolve_max_steps(args.max_steps, description)
    # One policy action per dataset frame unless a caller pins a fixed physics-step count.
    frame_clock = None
    if physics_steps is None:
        fps = validate_capture_fps(getattr(args, 'fps', DEFAULT_CAPTURE_FPS), '--fps')
        frame_clock = FrameClock(fps, float(description.get('timestep') or 0.0))
    backend = str(getattr(environment, 'backend', 'sim'))
    settings: dict[str, Any] = {
        'episodes': args.episodes,
        'seedStart': seed_start,
        'maxSteps': max_steps,
        'realtimeHz': args.realtime_hz,
        'terminateOnSuccess': not args.no_terminate_on_success,
        **({'fps': frame_clock.fps} if frame_clock is not None else {'physicsSteps': physics_steps}),
    }
    if vectorized:
        settings.update(numEnvs=num_envs, policyBatching=args.policy_batching)
    evaluation_report = EvaluationReport(
        description=description,
        policy={**policy, 'type': runner.policy_type, 'device': str(runner.device)},
        settings=settings,
        run_dir=args.run_dir,
        total_episodes=args.episodes,
        # The record backend is sim vs real; the environment record keeps the runtime kind.
        backend=backend if backend in RUN_RECORD_BACKENDS else 'sim',
        record_video=tuple(args.record_video),
        checkpoint_files=checkpoint_files,
        checkpoint_root=checkpoint_root,
        output=output,
        action_fps=frame_clock.fps if frame_clock is not None else None,
        scored=scored,
    )
    progress = progress_reporter(policy=runner.policy_type, device=str(runner.device), interval=args.status_interval)
    last_progress_step = 0

    def on_step(observation: Observation, step: int) -> None:
        nonlocal last_progress_step
        # Vector rows share a step counter; report each synchronized step once.
        if not vectorized or step != last_progress_step:
            last_progress_step = step
            progress(observation, step)
        evaluation_report.on_step(observation, step)

    if not vectorized:
        environment.acquire()
    stop_event = threading.Event()
    results: list[EpisodeResult] = []
    options: dict[str, Any] = {
        'task': task,
        'episodes': args.episodes,
        'start_seed': seed_start,
        'stop_event': stop_event,
        'max_steps': max_steps,
        'terminate_on_success': not args.no_terminate_on_success,
        'physics_steps': physics_steps,
        'frame_clock': frame_clock,
        'on_step': on_step,
        'on_episode': evaluation_report.on_episode,
        'realtime_hz': args.realtime_hz,
    }
    if not scored:
        options['episode_end_hook'] = _void_unscored
    try:
        with graceful_stop(stop_event):
            if vectorized:
                results = runner.evaluate_vector(environment, policy_batching=args.policy_batching, **options)
            else:
                results = runner.evaluate(environment, **options)
        return results, evaluation_report.finish(results)
    finally:
        evaluation_report.close_videos()
        if not vectorized:
            try:
                environment.stop()
            finally:
                environment.release()
