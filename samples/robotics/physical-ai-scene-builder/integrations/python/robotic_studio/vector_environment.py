# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Batched policy environment contracts and spawned native MuJoCo workers."""

from __future__ import annotations

import json
import multiprocessing as mp
import os
import signal
import tempfile
import threading
import time
import traceback
import weakref
from collections.abc import Callable, Iterator, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from multiprocessing import shared_memory
from pathlib import Path
from typing import Any, Protocol, runtime_checkable

import numpy as np

from .evaluation.local import LocalEvaluationEnvironment
from .generation.scene_bundle import SceneBundleLoader
from .policy_environment import ResetInfo, TaskStatus
from .runtime import evaluation_environment, load_profile, load_scene

DEFAULT_STARTUP_TIMEOUT_S = 300.0
DEFAULT_RESPONSE_TIMEOUT_S = 60.0


@dataclass(frozen=True)
class BatchObservation:
    state: np.ndarray
    images: Mapping[str, np.ndarray]
    task: tuple[TaskStatus | None, ...]
    simulation_time: np.ndarray
    step_id: np.ndarray
    # Physics steps applied by each row's last reset/step (``None`` when the backend does not report it).
    physics_steps: np.ndarray | None = None


@runtime_checkable
class VectorPolicyEnvironment(Protocol):
    num_envs: int

    def describe(self) -> Mapping[str, Any]: ...
    def reset(self, seeds: Sequence[int | None]) -> tuple[BatchObservation, list[ResetInfo]]: ...
    def step(self, actions: np.ndarray, active: Sequence[bool]) -> BatchObservation: ...
    def close(self) -> None: ...


class VectorEnvironmentError(RuntimeError):
    """A vector environment worker failed, exited, or stopped responding."""


def open_local_evaluation(
    scene_bundle: str | Path,
    profile: Mapping[str, Any],
) -> tuple[LocalEvaluationEnvironment, Callable[[], None]]:
    """Build the in-process evaluation environment used by ``--local`` and every vector worker.

    Returns the environment and a ``close`` callable that also releases the scene bundle.
    """
    cameras = profile.get('cameras', [])
    actions = profile.get('action', [])
    if not isinstance(cameras, list) or not isinstance(actions, list):
        raise ValueError('Profile cameras and action must be arrays.')
    scene = load_scene(scene_bundle)
    try:
        environment = evaluation_environment(scene, profile)
        local = LocalEvaluationEnvironment(
            environment,
            profile,
            scene_id=str(profile.get('sceneId', '')),
            scene_fingerprint=str(profile.get('sceneFingerprint', '')),
            profile_id=str(profile.get('profileId', 'runtime-policy')),
        )
    except BaseException:
        scene.bundle.close()
        raise

    def close() -> None:
        try:
            local.close()
        finally:
            scene.bundle.close()

    return local, close


def _attach_shared_memory(name: str) -> shared_memory.SharedMemory:
    # The parent owns (and unlinks) every segment; workers must not register them for cleanup.
    try:
        return shared_memory.SharedMemory(name=name, track=False)  # type: ignore[call-arg]
    except TypeError:  # Python < 3.13: spawn children share the parent's resource tracker.
        return shared_memory.SharedMemory(name=name)


def _vector_worker(
    connection: Any,
    scene_path: str,
    profile_path: str,
    image_memory: Mapping[str, str],
    egl_device: int | None = None,
) -> None:
    # Ctrl+C reaches the whole process group; the parent owns graceful shutdown.
    signal.signal(signal.SIGINT, signal.SIG_IGN)
    if egl_device is not None:
        os.environ['MUJOCO_EGL_DEVICE_ID'] = str(egl_device)
    memories: dict[str, shared_memory.SharedMemory] = {}
    close_local: Callable[[], None] | None = None
    try:
        try:
            memories = {name: _attach_shared_memory(memory_name) for name, memory_name in image_memory.items()}
            local, close_local = open_local_evaluation(scene_path, load_profile(profile_path))
        except BaseException:
            connection.send(('error', traceback.format_exc()))
            return
        while True:
            command = connection.recv()
            if command is None:
                return
            try:
                kind = command[0]
                if kind == 'describe':
                    connection.send(('ok', dict(local.describe())))
                    continue
                if kind == 'reset':
                    observation, reset_info = local.reset(command[1])
                    info: Mapping[str, Any] | None = {
                        'seed': reset_info.seed,
                        'samples': [dict(sample) for sample in reset_info.samples],
                    }
                elif kind == 'step':
                    observation = local.step(command[1], command[2])
                    info = None
                else:
                    raise ValueError(f'Unknown vector environment command {kind!r}.')
                for name, image in observation.images.items():
                    memory = memories[name]
                    target = np.ndarray(tuple(image.shape), dtype=np.uint8, buffer=memory.buf)
                    target[...] = image
                    del target
                connection.send((
                    'ok',
                    {
                        'state': np.asarray(observation.state, dtype=np.float32),
                        'task': observation.task,
                        'time': observation.simulation_time,
                        'step': observation.step_id,
                        'physicsSteps': observation.physics_steps,
                        'resetInfo': info,
                    },
                ))
            except Exception:
                connection.send(('error', traceback.format_exc()))
    except (EOFError, BrokenPipeError, OSError):
        return
    finally:
        try:
            if close_local is not None:
                close_local()
        finally:
            for memory in memories.values():
                try:
                    memory.close()
                except BufferError:
                    pass


@contextmanager
def _environment_variable(name: str, value: str | None) -> Iterator[None]:
    """Temporarily set ``name`` so a spawned child inherits it before importing MuJoCo."""
    if value is None:
        yield
        return
    previous = os.environ.get(name)
    os.environ[name] = value
    try:
        yield
    finally:
        if previous is None:
            os.environ.pop(name, None)
        else:
            os.environ[name] = previous


_SPAWN_LOCK = threading.Lock()


class _Resources:
    """Everything a vector environment must release, kept off ``self`` for ``weakref.finalize``."""

    def __init__(self) -> None:
        self.parents: list[Any] = []
        self.processes: list[Any] = []
        self.memories: list[dict[str, shared_memory.SharedMemory]] = []
        self.temp_bundle: tempfile.TemporaryDirectory[str] | None = None

    def close(self) -> None:
        for pipe in self.parents:
            try:
                pipe.send(None)
            except (BrokenPipeError, EOFError, OSError):
                pass
        deadline = time.monotonic() + 5.0
        for process in self.processes:
            process.join(timeout=max(0.0, deadline - time.monotonic()))
        for process in self.processes:
            if process.is_alive():
                process.terminate()
                process.join(timeout=2.0)
            if process.is_alive():
                process.kill()
                process.join()
        for pipe in self.parents:
            try:
                pipe.close()
            except OSError:
                pass
        for memories in self.memories:
            for memory in memories.values():
                try:
                    memory.close()
                except BufferError:
                    pass
                try:
                    memory.unlink()
                except FileNotFoundError:
                    pass
        self.parents.clear()
        self.processes.clear()
        self.memories.clear()
        if self.temp_bundle is not None:
            self.temp_bundle.cleanup()
            self.temp_bundle = None


class SubprocessVectorEnvironment:
    """One spawn-context ``LocalEvaluationEnvironment`` process per row, with shared RGB buffers.

    Inactive rows are neither stepped nor re-rendered: their last state, task status, and images are
    reused. Worker processes ignore SIGINT so the caller can stop gracefully and still write its
    run record; ``close()`` (also run at garbage collection and interpreter exit) stops the workers
    and unlinks every shared-memory segment.

    ``egl_devices`` spreads headless rendering over several GPUs: worker ``i`` renders on
    ``egl_devices[i % len(egl_devices)]`` through ``MUJOCO_EGL_DEVICE_ID``.
    """

    backend = 'native-local'

    def __init__(
        self,
        scene_bundle: str | Path,
        profile_path: str | Path,
        *,
        num_envs: int,
        egl_devices: Sequence[int] | None = None,
        startup_timeout: float = DEFAULT_STARTUP_TIMEOUT_S,
        response_timeout: float = DEFAULT_RESPONSE_TIMEOUT_S,
    ) -> None:
        if not isinstance(num_envs, int) or isinstance(num_envs, bool) or num_envs < 1:
            raise ValueError('num_envs must be a positive integer.')
        devices = [int(device) for device in egl_devices] if egl_devices else []
        if any(device < 0 for device in devices):
            raise ValueError('egl_devices must be non-negative EGL device indices.')
        self.num_envs = num_envs
        self.profile = load_profile(profile_path)
        self._response_timeout = float(response_timeout)
        self._resources = _Resources()
        self._finalizer = weakref.finalize(self, self._resources.close)
        self._last_responses: list[Mapping[str, Any]] | None = None
        try:
            bundle_path = Path(scene_bundle)
            if not bundle_path.is_dir():
                self._resources.temp_bundle = tempfile.TemporaryDirectory(prefix='robotic-studio-vector-scene-')
                target = Path(self._resources.temp_bundle.name)
                # Extract once into a retained directory so every worker resolves the same manifest
                # and relative assets after the loader's temporary archive is released.
                bundle = SceneBundleLoader().load(bundle_path, destination=target)
                (target / 'manifest.json').write_text(json.dumps(bundle.manifest), encoding='utf-8')
                bundle.close()
                bundle_path = target
            self.scene_bundle_path = str(bundle_path)
            cameras = self.profile.get('cameras', [])
            if not isinstance(cameras, list):
                raise ValueError('Profile cameras must be an array.')
            self._image_shapes = {
                str(camera['outputName']): (int(camera['height']), int(camera['width']), 3)
                for camera in cameras
            }
            context = mp.get_context('spawn')
            for index in range(num_envs):
                memories = {
                    name: shared_memory.SharedMemory(create=True, size=max(1, int(np.prod(shape))))
                    for name, shape in self._image_shapes.items()
                }
                self._resources.memories.append(memories)
                parent, child = context.Pipe()
                self._resources.parents.append(parent)
                device = devices[index % len(devices)] if devices else None
                process = context.Process(
                    target=_vector_worker,
                    args=(
                        child,
                        self.scene_bundle_path,
                        str(profile_path),
                        {name: memory.name for name, memory in memories.items()},
                        device,
                    ),
                    name=f'robotic-studio-vector-env-{index}',
                    daemon=True,
                )
                with _SPAWN_LOCK, _environment_variable(
                    'MUJOCO_EGL_DEVICE_ID', None if device is None else str(device)
                ):
                    process.start()
                child.close()
                self._resources.processes.append(process)
            # Every worker compiles the scene before answering; the first answer gives the description.
            for index in range(num_envs):
                self._send(index, ('describe',))
            descriptions = [
                self._receive(index, timeout=startup_timeout) for index in range(num_envs)
            ]
            self._description: Mapping[str, Any] = {**descriptions[0], 'backend': self.backend}
        except BaseException:
            self.close()
            raise

    @property
    def closed(self) -> bool:
        return not self._finalizer.alive

    def describe(self) -> Mapping[str, Any]:
        return self._description

    def shared_memory_names(self) -> list[str]:
        return [memory.name for memories in self._resources.memories for memory in memories.values()]

    def _collect(self, responses: Sequence[Mapping[str, Any]]) -> BatchObservation:
        memories = self._resources.memories
        states = np.stack([np.asarray(response['state'], dtype=np.float32) for response in responses])
        images: dict[str, np.ndarray] = {}
        for name, shape in self._image_shapes.items():
            images[name] = np.stack([
                np.ndarray(shape, dtype=np.uint8, buffer=memories[index][name].buf).copy()
                for index in range(self.num_envs)
            ])
        return BatchObservation(
            states,
            images,
            tuple(response['task'] for response in responses),
            np.asarray([response['time'] for response in responses], dtype=np.float64),
            np.asarray([response['step'] for response in responses], dtype=np.int64),
            np.asarray([response.get('physicsSteps') or 0 for response in responses], dtype=np.int64),
        )

    def _require_open(self) -> None:
        if self.closed:
            raise VectorEnvironmentError('The vector environment is closed.')

    def reset(self, seeds: Sequence[int | None]) -> tuple[BatchObservation, list[ResetInfo]]:
        self._require_open()
        if len(seeds) != self.num_envs:
            raise ValueError('A seed is required for each vector environment.')
        try:
            for index, seed in enumerate(seeds):
                self._send(index, ('reset', seed))
            responses = [self._receive(index) for index in range(self.num_envs)]
        except BaseException:
            self.close()
            raise
        self._last_responses = responses
        infos = [
            ResetInfo(response['resetInfo']['seed'], tuple(response['resetInfo']['samples']))
            for response in responses
        ]
        return self._collect(responses), infos

    def step(
        self,
        actions: np.ndarray,
        active: Sequence[bool],
        physics_steps: int | Sequence[int | None] | None = None,
    ) -> BatchObservation:
        """Step active rows; inactive rows are not contacted and keep their last observation."""
        self._require_open()
        array = np.asarray(actions)
        if array.ndim != 2 or array.shape[0] != self.num_envs or len(active) != self.num_envs:
            raise ValueError('actions and active mask must have a leading num_envs dimension.')
        if self._last_responses is None:
            raise RuntimeError('Reset the vector environment before stepping.')
        if physics_steps is None or isinstance(physics_steps, (int, np.integer)):
            row_physics_steps: list[int | None] = [
                None if physics_steps is None else int(physics_steps)
            ] * self.num_envs
        else:
            row_physics_steps = [None if value is None else int(value) for value in physics_steps]
            if len(row_physics_steps) != self.num_envs:
                raise ValueError('physics_steps must be a scalar or have one entry per environment.')
        responses = list(self._last_responses)
        stepped = [bool(enabled) for enabled in active]
        try:
            for index in range(self.num_envs):
                if stepped[index]:
                    self._send(index, ('step', array[index].tolist(), row_physics_steps[index]))
            for index in range(self.num_envs):
                if stepped[index]:
                    responses[index] = self._receive(index)
        except BaseException:
            self.close()
            raise
        self._last_responses = responses
        return self._collect(responses)

    def _send(self, index: int, message: Any) -> None:
        try:
            self._resources.parents[index].send(message)
        except (BrokenPipeError, EOFError, OSError):
            # The worker is gone; ``_receive`` reports its last error message or exit code.
            pass

    def _receive(self, index: int, *, timeout: float | None = None) -> Any:
        pipe = self._resources.parents[index]
        process = self._resources.processes[index]
        deadline = time.monotonic() + (self._response_timeout if timeout is None else timeout)
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise VectorEnvironmentError(
                    f'Vector environment worker {index} did not respond within '
                    f'{self._response_timeout if timeout is None else timeout:g} seconds.'
                )
            if pipe.poll(min(remaining, 0.5)):
                try:
                    message = pipe.recv()
                except (EOFError, OSError) as error:
                    process.join(timeout=1.0)
                    raise VectorEnvironmentError(
                        f'Vector environment worker {index} exited unexpectedly '
                        f'(exit code {process.exitcode}).'
                    ) from error
                break
            if not process.is_alive():
                raise VectorEnvironmentError(
                    f'Vector environment worker {index} exited unexpectedly (exit code {process.exitcode}).'
                )
        status, payload = message
        if status == 'error':
            raise VectorEnvironmentError(f'Vector environment worker {index} failed:\n{payload}')
        return payload

    def close(self) -> None:
        self._finalizer()

    def __enter__(self) -> SubprocessVectorEnvironment:
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()
