# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Shared rollout, summary, and portable run-record utilities."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
import platform
import threading
import time
import uuid
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any, Literal, get_args

import numpy as np

from .frame_clock import FrameClock
from .policy_environment import Observation, PolicyEnvironment, TaskStatus


EpisodeOutcome = Literal['success', 'failure', 'truncated', 'stopped', 'void']
EPISODE_OUTCOMES: frozenset[str] = frozenset(get_args(EpisodeOutcome))
POLICY_BATCHING_MODES = ('batched', 'per-env')


@dataclass(frozen=True)
class EpisodeResult:
    """One evaluated episode. Field order matches the runners' historical result types."""

    seed: int | None
    steps: int
    final_observation: Observation
    success: bool | None
    elapsed_seconds: float = 0.0
    deadline_misses: int = 0
    outcome: EpisodeOutcome = 'stopped'
    reason: str | None = None
    reset_samples: tuple[Mapping[str, Any], ...] = ()


@dataclass(frozen=True)
class RunSummary:
    completed: int
    successes: int
    void: int
    success_rate: float | None
    wilson95: tuple[float, float] | None
    mean_steps_to_success: float | None
    failure_reasons: Mapping[str, int]

    @property
    def scored(self) -> int:
        """Episodes that count toward the success rate (``completed - void``)."""
        return self.completed - self.void


def wilson_interval(successes: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n < 1 or successes < 0 or successes > n or not math.isfinite(z) or z <= 0:
        raise ValueError('Wilson interval requires 0 <= successes <= n, n > 0, and z > 0.')
    p = successes / n
    denominator = 1 + z * z / n
    center = (p + z * z / (2 * n)) / denominator
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denominator
    return max(0.0, center - half), min(1.0, center + half)


def format_success_rate(successes: int, scored: int, interval: Sequence[float] | None) -> str:
    """Plain-language result line, e.g. ``7/10 succeeded (70%). Likely true success rate: 40%-89% ...``.

    ``interval`` is the 95% Wilson interval: the range the policy's long-run success rate probably
    lies in, given how few episodes were run.
    """
    text = f'{successes}/{scored} succeeded ({successes / scored:.0%})'
    if interval is None:
        return f'{text}.'
    low, high = interval
    return f'{text}. Likely true success rate: {low:.0%}-{high:.0%} (more episodes narrow this range).'


def summarize(results: Sequence[EpisodeResult]) -> RunSummary:
    scored = [result for result in results if result.outcome != 'void']
    successes = sum(result.outcome == 'success' for result in scored)
    reasons: dict[str, int] = {}
    for result in scored:
        if result.outcome in {'failure', 'truncated'}:
            reason = result.reason or ('max_steps' if result.outcome == 'truncated' else 'failure')
            reasons[reason] = reasons.get(reason, 0) + 1
    successful_steps = [result.steps for result in scored if result.outcome == 'success']
    n = len(scored)
    return RunSummary(
        completed=len(results),
        successes=successes,
        void=len(results) - n,
        success_rate=successes / n if n else None,
        wilson95=wilson_interval(successes, n) if n else None,
        mean_steps_to_success=float(np.mean(successful_steps)) if successful_steps else None,
        failure_reasons=reasons,
    )


def _terminal_outcome(status: TaskStatus) -> tuple[EpisodeOutcome, str | None]:
    if status.success:
        return 'success', status.reason
    if status.terminated:
        return 'failure', status.reason
    return 'truncated', status.reason or 'max_steps'


def run_episode(
    environment: PolicyEnvironment,
    select_action: Callable[[Observation], Sequence[float] | np.ndarray],
    *,
    reset_policy: Callable[[], None] | None = None,
    seed: int | None = None,
    max_steps: int | None = None,
    physics_steps: int | None = None,
    frame_clock: FrameClock | None = None,
    realtime_hz: float | None = None,
    stop_event: Any = None,
    pause_event: Any = None,
    on_step: Callable[[Observation, int], None] | None = None,
    clock: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
    success_fn: Callable[[Observation, int], bool | None] | None = None,
    terminate_on_success: bool = True,
    episode_end_hook: Callable[[EpisodeResult], str | None] | None = None,
    on_reset: Callable[[Observation, Any], None] | None = None,
) -> EpisodeResult:
    """Run one episode until the task ends, ``max_steps`` is reached, or ``stop_event`` is set.

    Worker task status decides success/failure/truncation when present; ``success_fn`` lets custom
    tasks without a worker check end the episode as a success. ``frame_clock`` steps one policy
    action per dataset frame (the rate the policy was trained at); ``physics_steps`` instead applies
    a fixed step count per action.
    """
    if realtime_hz is not None and (not math.isfinite(realtime_hz) or realtime_hz <= 0):
        raise ValueError('realtime_hz must be finite and positive.')
    if frame_clock is not None and physics_steps is not None:
        raise ValueError('Pass either frame_clock or physics_steps, not both.')
    if frame_clock is not None:
        frame_clock.reset()
    if reset_policy is not None:
        reset_policy()
    observation, reset_info = environment.reset(seed=seed)
    if on_reset is not None:
        on_reset(observation, reset_info)
    reset_samples = tuple(getattr(reset_info, 'samples', ()) or ())
    start = clock()
    period = None if realtime_hz is None else 1.0 / realtime_hz
    next_deadline = None if period is None else start + period
    misses = 0
    steps = 0
    outcome: EpisodeOutcome = 'stopped'
    reason: str | None = None

    def stopped() -> bool:
        return stop_event is not None and stop_event.is_set()

    status = observation.task
    if status is not None and (status.terminated or status.truncated):
        outcome, reason = _terminal_outcome(status)
    else:
        while True:
            while pause_event is not None and pause_event.is_set() and not stopped():
                sleep(0.1)
            if stopped():
                break
            if max_steps is not None and steps >= max_steps:
                last = observation.task
                outcome, reason = ('success', None) if last is not None and last.success else ('truncated', 'max_steps')
                break
            if next_deadline is not None and steps:
                delay = next_deadline - clock()
                if delay > 0:
                    sleep(delay)
                else:
                    misses += 1
                next_deadline = clock() + period
                if stopped():
                    break
            observation = environment.step(
                select_action(observation),
                physics_steps=frame_clock.next_physics_steps() if frame_clock is not None else physics_steps,
            )
            steps += 1
            if on_step is not None:
                on_step(observation, steps)
            status = observation.task
            if status is not None and (
                status.terminated or status.truncated or (status.success and terminate_on_success)
            ):
                outcome, reason = _terminal_outcome(status)
                break
            if success_fn is not None and success_fn(observation, steps):
                outcome, reason = 'success', None
                break
    return _episode_result(
        seed=seed,
        steps=steps,
        observation=observation,
        elapsed_seconds=max(0.0, clock() - start),
        deadline_misses=misses,
        outcome=outcome,
        reason=reason,
        reset_samples=reset_samples,
        episode_end_hook=episode_end_hook,
    )


def _success_value(outcome: str) -> bool | None:
    return True if outcome == 'success' else False if outcome in {'failure', 'truncated'} else None


def _episode_result(
    *,
    seed: int | None,
    steps: int,
    observation: Observation,
    elapsed_seconds: float,
    deadline_misses: int,
    outcome: EpisodeOutcome,
    reason: str | None,
    reset_samples: tuple[Mapping[str, Any], ...],
    episode_end_hook: Callable[[EpisodeResult], str | None] | None,
) -> EpisodeResult:
    result = EpisodeResult(
        seed=seed,
        steps=steps,
        final_observation=observation,
        success=_success_value(outcome),
        elapsed_seconds=elapsed_seconds,
        deadline_misses=deadline_misses,
        outcome=outcome,
        reason=reason,
        reset_samples=reset_samples,
    )
    if episode_end_hook is not None:
        override = episode_end_hook(result)
        if override is not None:
            if override not in EPISODE_OUTCOMES:
                raise ValueError(f'Unsupported episode outcome override: {override}')
            result = replace(result, outcome=override, success=_success_value(override))
    return result


def evaluate(
    environment: PolicyEnvironment,
    select_action: Callable[[Observation], Sequence[float] | np.ndarray],
    *,
    episodes: int = 1,
    seed_start: int | None = 0,
    on_episode: Callable[[int, EpisodeResult], None] | None = None,
    **options: Any,
) -> list[EpisodeResult]:
    """Run seeded episodes ``seed_start .. seed_start + episodes - 1``, stopping between episodes."""
    if episodes < 1:
        raise ValueError('episodes must be positive.')
    stop_event = options.get('stop_event')
    results = []
    for index in range(episodes):
        seed = None if seed_start is None else seed_start + index
        result = run_episode(environment, select_action, seed=seed, **options)
        results.append(result)
        # End the worker episode but keep the lease for the next seed.
        environment.stop()
        if on_episode is not None:
            on_episode(index, result)
        if result.outcome == 'stopped' or (stop_event is not None and stop_event.is_set()):
            break
    return results


def _check_policy_batching(policy_batching: str) -> None:
    if policy_batching not in POLICY_BATCHING_MODES:
        raise ValueError(f"policy_batching must be one of {', '.join(POLICY_BATCHING_MODES)}.")


def _stack_rows(rows: Sequence[np.ndarray | None]) -> np.ndarray:
    """Stack per-row actions, filling skipped (inactive) rows with zeros of the same shape."""
    template = next((row for row in rows if row is not None), None)
    if template is None:
        raise ValueError('At least one vector row must be active.')
    return np.stack([np.zeros_like(template) if row is None else row for row in rows])


def _row_observation(
    batch: Any,
    index: int,
    episode_id: str,
    scene_fingerprint: str,
    physics_steps: int,
) -> Observation:
    reported = getattr(batch, 'physics_steps', None)
    if reported is not None and int(reported[index]) > 0:
        physics_steps = int(reported[index])
    return Observation(
        state=np.array(batch.state[index], copy=True),
        images={name: np.array(value[index], copy=True) for name, value in batch.images.items()},
        episode_id=episode_id,
        step_id=int(batch.step_id[index]),
        simulation_time=float(batch.simulation_time[index]),
        physics_steps=physics_steps,
        scene_fingerprint=scene_fingerprint,
        task=batch.task[index],
    )


def resolve_camera_map(available: Sequence[str], expected: Sequence[str]) -> dict[str, str]:
    """Return ``{studio_camera: checkpoint_camera_key}``; see ``PolicyRunnerMixin``."""
    available_set = set(available)
    result = {key: key for key in expected if key in available_set}
    remaining_studio = [name for name in available if name not in result]
    remaining_features = [key for key in expected if key not in result.values()]
    # The dataset converter prefixes sanitized camera names with ``image__``.
    for studio_name in tuple(remaining_studio):
        feature_key = next(
            (key for key in remaining_features if key.removeprefix('image__') == studio_name),
            None,
        )
        if feature_key is not None:
            result[studio_name] = feature_key
            remaining_studio.remove(studio_name)
            remaining_features.remove(feature_key)
    if len(remaining_studio) == len(remaining_features):
        result.update(zip(remaining_studio, remaining_features, strict=True))
    return result


class PolicyRunnerMixin:
    """Shared ``run_episode``/``evaluate``/``evaluate_vector`` for policy runners.

    Implementers provide ``validate_description``, ``reset_policy``, ``select_action``, a
    ``_description`` attribute, and optionally ``_scene_fingerprint``. Batched vector evaluation
    also needs ``infer_action_batch(states, images, task) -> (num_envs, action_dim)``; ``per-env``
    batching uses independent copies from ``_make_policy_instance``.
    """

    compatibility_error: type[Exception] = RuntimeError
    _description: Mapping[str, Any] | None = None
    _scene_fingerprint: str | None = None
    _vector_policies: list[Any] | None = None

    def validate_description(self, description: Mapping[str, Any]) -> Any:  # pragma: no cover
        raise NotImplementedError

    def reset_policy(self, task: str | None = None) -> None:  # pragma: no cover
        raise NotImplementedError

    def select_action(self, observation: Observation) -> Sequence[float] | np.ndarray:  # pragma: no cover
        raise NotImplementedError

    def _resolve_camera_map(self, available: Sequence[str]) -> dict[str, str]:
        """Map Studio camera output names to the checkpoint's camera feature keys.

        Runners provide ``expected_camera_keys``. Exact names match first, then the dataset
        converter's ``image__<camera>`` keys; order is only a last resort, because the Studio
        profile and the checkpoint need not list cameras in the same order.
        """
        return resolve_camera_map(available, getattr(self, 'expected_camera_keys'))

    def _make_policy_instance(self) -> Any:
        """Return an independent policy for one vector row (``per-env`` batching).

        The default deep-copies this runner without its existing row copies, so building N copies
        costs N copies. Adapters whose inference handles cannot be deep-copied override this.
        """
        state = self.__dict__
        saved = state.pop('_vector_policies', None)
        try:
            return copy.deepcopy(self)
        finally:
            if saved is not None:
                state['_vector_policies'] = saved

    def vector_policies(self, count: int) -> list[Any]:
        """Per-env policy copies, built once and reused for every later wave."""
        policies = self.__dict__.get('_vector_policies')
        if policies is None or len(policies) != count:
            self.__dict__.pop('_vector_policies', None)
            policies = [self._make_policy_instance() for _ in range(count)]
            self._vector_policies = policies
        return policies

    def reset_batch_policy(
        self,
        count: int,
        task: str | None = None,
        *,
        policy_batching: str = 'batched',
    ) -> None:
        """Reset policy state at the start of a wave: the shared policy, or every per-env copy."""
        _check_policy_batching(policy_batching)
        if policy_batching == 'batched':
            self.reset_policy(task)
            return
        for policy in self.vector_policies(count):
            policy.reset_policy(task)

    def select_action_batch(
        self,
        states: np.ndarray,
        images: Mapping[str, np.ndarray],
        task: str | None = None,
        *,
        policy_batching: str = 'batched',
        active: Sequence[bool] | None = None,
    ) -> np.ndarray:
        """Actions for a leading-``num_envs`` batch; ``per-env`` skips inactive rows (zeros)."""
        _check_policy_batching(policy_batching)
        if policy_batching == 'per-env':
            policies = self._vector_policies
            if policies is None or len(policies) != len(states):
                raise ValueError('Reset the per-env policy copies before batched inference.')
            rows: list[np.ndarray | None] = []
            for index, policy in enumerate(policies):
                if active is not None and not active[index]:
                    rows.append(None)
                    continue
                row_images = {name: value[index] for name, value in images.items()}
                one = getattr(policy, 'infer_action_one', None)
                if callable(one):
                    rows.append(np.asarray(one(states[index], row_images, task), dtype=np.float32))
                else:
                    rows.append(np.asarray(policy.select_action(Observation(
                        state=np.asarray(states[index], dtype=np.float32),
                        images=row_images,
                        episode_id='vector-policy',
                        step_id=0,
                        simulation_time=0.0,
                        physics_steps=1,
                    )), dtype=np.float32))
            return _stack_rows(rows)
        infer = getattr(self, 'infer_action_batch', None)
        if not callable(infer):
            raise NotImplementedError('Runner does not implement batched policy inference.')
        return infer(states, images, task)

    def evaluate_vector(
        self,
        environment: Any,
        *,
        episodes: int,
        start_seed: int | None = 0,
        max_steps: int | None = 600,
        task: str | None = None,
        policy_batching: str = 'batched',
        physics_steps: int | None = None,
        frame_clock: FrameClock | None = None,
        success_fn: Callable[[Observation, int], bool | None] | None = None,
        stop_event: Any = None,
        realtime_hz: float | None = None,
        terminate_on_success: bool = True,
        episode_end_hook: Callable[[EpisodeResult], str | None] | None = None,
        on_episode: Callable[[int, EpisodeResult], None] | None = None,
        on_step: Callable[[Observation, int], None] | None = None,
        clock: Callable[[], float] | None = None,
        sleep: Callable[[float], None] | None = None,
    ) -> list[EpisodeResult]:
        """Evaluate seeds ``start_seed ..`` in synchronized waves of ``environment.num_envs``.

        Each row follows :func:`run_episode` semantics (terminal status after reset, task
        termination, ``terminate_on_success``, ``success_fn``, ``max_steps``, ``stop_event``,
        ``frame_clock``/``physics_steps``, and ``realtime_hz`` pacing per synchronized step).
        The policy is reset once per wave (``batched``) or each per-env copy is reset (``per-env``);
        finished rows are masked until the wave ends. ``on_step`` runs once per active row and step;
        ``on_episode`` runs in seed order after each wave. A stop request marks the wave's running
        rows ``stopped`` and starts no further wave.
        """
        if episodes < 1:
            raise ValueError('episodes must be positive.')
        if max_steps is not None and max_steps < 1:
            raise ValueError('max_steps must be positive.')
        _check_policy_batching(policy_batching)
        if realtime_hz is not None and (not math.isfinite(realtime_hz) or realtime_hz <= 0):
            raise ValueError('realtime_hz must be finite and positive.')
        if frame_clock is not None and physics_steps is not None:
            raise ValueError('Pass either frame_clock or physics_steps, not both.')
        clock = clock or time.monotonic
        sleep = sleep or time.sleep
        # Describe once: the vector description is static for the whole run.
        description = environment.describe()
        if self._description is None:
            self.validate_description(description)
        fingerprint = str(description.get('sceneFingerprint') or '')
        default_physics_steps = int(description.get('physicsSteps') or 1)
        num_envs = int(environment.num_envs)
        period = None if realtime_hz is None else 1.0 / realtime_hz

        def stopped() -> bool:
            return stop_event is not None and stop_event.is_set()

        results: list[EpisodeResult] = []
        next_episode = 0
        while next_episode < episodes:
            count = min(num_envs, episodes - next_episode)
            seeds: list[int | None] = [
                None if start_seed is None else start_seed + next_episode + index for index in range(count)
            ]
            seeds.extend([None] * (num_envs - count))
            episode_ids = [f'vector-episode-{next_episode + index}' for index in range(num_envs)]
            if frame_clock is not None:
                frame_clock.reset()
            self.reset_batch_policy(num_envs, task, policy_batching=policy_batching)
            batch, reset_infos = environment.reset(seeds)
            observations = [
                _row_observation(batch, index, episode_ids[index], fingerprint, default_physics_steps)
                for index in range(num_envs)
            ]
            for index in range(count):
                self._check_scene(observations[index], reset_infos[index])
            start = clock()
            next_deadline = None if period is None else start + period
            misses = 0
            steps = 0
            active = np.arange(num_envs) < count
            finished: list[EpisodeResult | None] = [None] * num_envs

            def finish(index: int, outcome: EpisodeOutcome, reason: str | None) -> None:
                finished[index] = _episode_result(
                    seed=seeds[index],
                    steps=steps,
                    observation=observations[index],
                    elapsed_seconds=max(0.0, clock() - start),
                    deadline_misses=misses,
                    outcome=outcome,
                    reason=reason,
                    reset_samples=tuple(reset_infos[index].samples),
                    episode_end_hook=episode_end_hook,
                )
                active[index] = False

            for index in range(count):
                status = observations[index].task
                if status is not None and (status.terminated or status.truncated):
                    finish(index, *_terminal_outcome(status))
            while active.any():
                if stopped():
                    break
                if max_steps is not None and steps >= max_steps:
                    for index in np.flatnonzero(active):
                        last = observations[index].task
                        if last is not None and last.success:
                            finish(int(index), 'success', None)
                        else:
                            finish(int(index), 'truncated', 'max_steps')
                    break
                if next_deadline is not None and period is not None and steps:
                    delay = next_deadline - clock()
                    if delay > 0:
                        sleep(delay)
                    else:
                        misses += 1
                    next_deadline = clock() + period
                    if stopped():
                        break
                actions = self._vector_actions(observations, batch, active, task, policy_batching)
                applied = frame_clock.next_physics_steps() if frame_clock is not None else physics_steps
                if applied is None:
                    batch = environment.step(actions, active.copy())
                else:
                    batch = environment.step(actions, active.copy(), physics_steps=applied)
                steps += 1
                for index in np.flatnonzero(active):
                    row = int(index)
                    observation = _row_observation(
                        batch, row, episode_ids[row], fingerprint, applied or default_physics_steps
                    )
                    observations[row] = observation
                    if on_step is not None:
                        on_step(observation, steps)
                    status = observation.task
                    if status is not None and (
                        status.terminated or status.truncated or (status.success and terminate_on_success)
                    ):
                        finish(row, *_terminal_outcome(status))
                    elif success_fn is not None and success_fn(observation, steps):
                        finish(row, 'success', None)
            for index in np.flatnonzero(active):
                finish(int(index), 'stopped', None)
            for index in range(count):
                result = finished[index]
                assert result is not None
                results.append(result)
                if on_episode is not None:
                    on_episode(len(results) - 1, result)
            next_episode += count
            if stopped():
                break
        return results

    def _vector_actions(
        self,
        observations: Sequence[Observation],
        batch: Any,
        active: np.ndarray,
        task: str | None,
        policy_batching: str,
    ) -> np.ndarray:
        num_envs = len(observations)
        if policy_batching == 'per-env':
            # The same call as the sequential loop, on each row's own policy copy.
            policies = self.vector_policies(num_envs)
            actions = _stack_rows([
                np.asarray(policies[index].select_action(observations[index]), dtype=np.float32)
                if active[index]
                else None
                for index in range(num_envs)
            ])
        else:
            actions = np.asarray(
                self.select_action_batch(batch.state, batch.images, task, policy_batching='batched'),
                dtype=np.float32,
            )
        if actions.ndim != 2 or actions.shape[0] != num_envs:
            raise self.compatibility_error(
                f'Batched policy returned actions shaped {actions.shape}; expected ({num_envs}, action_dim).'
            )
        return actions

    def _check_scene(self, observation: Observation, _reset_info: Any) -> None:
        expected = self._scene_fingerprint
        if expected is not None and observation.scene_fingerprint and observation.scene_fingerprint != expected:
            raise self.compatibility_error(
                'The evaluation scene fingerprint changed after checkpoint compatibility validation.'
            )

    def _loop_options(self, environment: PolicyEnvironment, task: str | None, **options: Any) -> dict[str, Any]:
        if self._description is None:
            self.validate_description(environment.describe())
        clock = options.pop('clock', None) or time.monotonic
        sleep = options.pop('sleep', None) or time.sleep
        return {
            **options,
            'reset_policy': lambda: self.reset_policy(task),
            'on_reset': self._check_scene,
            'clock': clock,
            'sleep': sleep,
        }

    def run_episode(
        self,
        environment: PolicyEnvironment,
        *,
        task: str | None = None,
        seed: int | None = None,
        physics_steps: int | None = None,
        frame_clock: FrameClock | None = None,
        success_fn: Callable[[Observation, int], bool | None] | None = None,
        pause_event: threading.Event | None = None,
        stop_event: threading.Event | None = None,
        realtime_hz: float | None = None,
        max_steps: int | None = None,
        on_step: Callable[[Observation, int], None] | None = None,
        terminate_on_success: bool = True,
        episode_end_hook: Callable[[EpisodeResult], str | None] | None = None,
        clock: Callable[[], float] | None = None,
        sleep: Callable[[float], None] | None = None,
    ) -> EpisodeResult:
        return run_episode(
            environment,
            self.select_action,
            seed=seed,
            **self._loop_options(
                environment,
                task,
                physics_steps=physics_steps,
                frame_clock=frame_clock,
                success_fn=success_fn,
                pause_event=pause_event,
                stop_event=stop_event,
                realtime_hz=realtime_hz,
                max_steps=max_steps,
                on_step=on_step,
                terminate_on_success=terminate_on_success,
                episode_end_hook=episode_end_hook,
                clock=clock,
                sleep=sleep,
            ),
        )

    def evaluate(
        self,
        environment: PolicyEnvironment,
        *,
        task: str | None = None,
        episodes: int = 1,
        start_seed: int | None = 0,
        physics_steps: int | None = None,
        frame_clock: FrameClock | None = None,
        success_fn: Callable[[Observation, int], bool | None] | None = None,
        pause_event: threading.Event | None = None,
        stop_event: threading.Event | None = None,
        realtime_hz: float | None = None,
        max_steps: int | None = None,
        on_step: Callable[[Observation, int], None] | None = None,
        terminate_on_success: bool = True,
        episode_end_hook: Callable[[EpisodeResult], str | None] | None = None,
        on_episode: Callable[[int, EpisodeResult], None] | None = None,
        clock: Callable[[], float] | None = None,
        sleep: Callable[[float], None] | None = None,
    ) -> list[EpisodeResult]:
        return evaluate(
            environment,
            self.select_action,
            episodes=episodes,
            seed_start=start_seed,
            on_episode=on_episode,
            **self._loop_options(
                environment,
                task,
                physics_steps=physics_steps,
                frame_clock=frame_clock,
                success_fn=success_fn,
                pause_event=pause_event,
                stop_event=stop_event,
                realtime_hz=realtime_hz,
                max_steps=max_steps,
                on_step=on_step,
                terminate_on_success=terminate_on_success,
                episode_end_hook=episode_end_hook,
                clock=clock,
                sleep=sleep,
            ),
        )


def fingerprint_files(paths: Sequence[Path], root: Path | None = None) -> str:
    entries = []
    for path in sorted(paths, key=lambda item: item.as_posix()):
        digest = hashlib.sha256()
        with path.open('rb') as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                digest.update(chunk)
        relative = path.relative_to(root).as_posix() if root is not None else path.as_posix()
        entries.append((relative, path.stat().st_size, digest.hexdigest()))
    return 'sha256:' + hashlib.sha256(json.dumps(entries, separators=(',', ':')).encode()).hexdigest()


def checkpoint_fingerprint(paths: Sequence[Path], cache_path: Path, root: Path | None = None) -> str:
    """Hash checkpoint files once per stable path/size/mtime signature."""
    try:
        cache = json.loads(cache_path.read_text(encoding='utf-8'))
        if not isinstance(cache, dict):
            cache = {}
    except (OSError, json.JSONDecodeError):
        cache = {}
    key = json.dumps(
        [(path.as_posix(), path.stat().st_size, path.stat().st_mtime_ns) for path in sorted(paths)],
        separators=(',', ':'),
    )
    fingerprint = cache.get(key)
    if not isinstance(fingerprint, str):
        fingerprint = fingerprint_files(paths, root=root)
        cache[key] = fingerprint
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = cache_path.with_suffix(cache_path.suffix + '.tmp')
        temporary.write_text(json.dumps(cache, sort_keys=True), encoding='utf-8')
        temporary.replace(cache_path)
    return fingerprint


def write_run_record(path: str | Path, record: Mapping[str, Any]) -> Path:
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    payload = dict(record)
    payload.setdefault('format', 'robotic-studio-run')
    payload.setdefault('formatVersion', 1)
    temporary = destination.with_suffix(destination.suffix + '.tmp')
    temporary.write_text(json.dumps(payload, indent=2, sort_keys=True) + '\n', encoding='utf-8')
    temporary.replace(destination)
    return destination


def new_run_id() -> str:
    return f"run-{datetime.now(timezone.utc).strftime('%Y-%m-%dT%H-%M-%SZ')}-{uuid.uuid4().hex[:4]}"


def create_run_record(
    *,
    backend: str,
    environment: Mapping[str, Any],
    policy: Mapping[str, Any],
    settings: Mapping[str, Any],
    episodes: Sequence[EpisodeResult],
    software: Mapping[str, Any] | None = None,
    run_id: str | None = None,
    videos: Mapping[int, Mapping[str, str]] | None = None,
    label: str = 'auto',
) -> dict[str, Any]:
    """Build a portable run record (see ``schemas/run-record-v1.schema.json``)."""
    summary = summarize(episodes)
    videos = videos or {}
    return {
        'format': 'robotic-studio-run',
        'formatVersion': 1,
        'runId': run_id or new_run_id(),
        'createdAt': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
        'backend': backend,
        'environment': dict(environment),
        'policy': dict(policy),
        'settings': dict(settings),
        'episodes': [
            {
                'index': index,
                'seed': episode.seed,
                'outcome': episode.outcome,
                'reason': episode.reason,
                'steps': episode.steps,
                'simulationSeconds': episode.final_observation.simulation_time,
                'wallSeconds': episode.elapsed_seconds,
                'deadlineMisses': episode.deadline_misses,
                'label': label,
                'resetSamples': [dict(sample) for sample in episode.reset_samples],
                **({'videos': dict(videos[index])} if index in videos else {}),
            }
            for index, episode in enumerate(episodes)
        ],
        'summary': {
            'completed': summary.completed,
            'successes': summary.successes,
            'void': summary.void,
            'successRate': summary.success_rate,
            'wilson95': None if summary.wilson95 is None else list(summary.wilson95),
            'meanStepsToSuccess': summary.mean_steps_to_success,
            'failureReasons': dict(summary.failure_reasons),
        },
        'software': dict(software or {}),
    }


def software_versions() -> dict[str, str]:
    result = {"python": platform.python_version()}
    for package, key in (("robotic-studio", "roboticStudioSdk"), ("mujoco", "mujoco"), ("lerobot", "lerobot")):
        try:
            result[key] = version(package)
        except PackageNotFoundError:
            continue
    return result


def _scored_episodes_by_seed(record: Mapping[str, Any]) -> dict[Any, Mapping[str, Any]]:
    episodes = [episode for episode in record.get('episodes', []) if episode.get('outcome') != 'void']
    by_seed = {episode.get('seed'): episode for episode in episodes}
    if len(by_seed) != len(episodes):
        raise ValueError('Each run record must have at most one non-void episode per seed.')
    return by_seed


def compare_runs(first: Mapping[str, Any], second: Mapping[str, Any]) -> dict[str, Any]:
    """Pair two run records by seed (void episodes excluded) and report both rates and the gap."""
    first_by_seed = _scored_episodes_by_seed(first)
    second_by_seed = _scored_episodes_by_seed(second)
    if set(first_by_seed) != set(second_by_seed):
        raise ValueError('Run records must contain the same non-void seeds for paired comparison.')
    seeds = sorted(first_by_seed, key=lambda value: -1 if value is None else value)
    per_seed = [
        {'seed': seed, 'first': first_by_seed[seed].get('outcome'), 'second': second_by_seed[seed].get('outcome')}
        for seed in seeds
    ]
    paired = (
        sum((row['second'] == 'success') - (row['first'] == 'success') for row in per_seed) / len(per_seed)
        if per_seed
        else None
    )
    first_summary = first.get('summary') or {}
    second_summary = second.get('summary') or {}
    first_rate = first_summary.get('successRate')
    second_rate = second_summary.get('successRate')
    return {
        'perSeed': per_seed,
        'pairedSuccessRateDifference': paired,
        'firstSummary': first_summary,
        'secondSummary': second_summary,
        'successRateDifference': None if first_rate is None or second_rate is None else second_rate - first_rate,
    }


def compare_runs_main() -> None:
    parser = argparse.ArgumentParser(description='Compare two Physical AI Scene Builder evaluation run records.')
    parser.add_argument('first', type=Path)
    parser.add_argument('second', type=Path)
    args = parser.parse_args()
    first = json.loads(args.first.read_text(encoding='utf-8'))
    second = json.loads(args.second.read_text(encoding='utf-8'))
    try:
        result = compare_runs(first, second)
    except (TypeError, ValueError) as error:
        parser.error(str(error))
    print('seed | first | second')
    for episode in result['perSeed']:
        print(f"{episode['seed']} | {episode['first'] or 'missing'} | {episode['second'] or 'missing'}")
    for label, key in (('first run', 'firstSummary'), ('second run', 'secondSummary')):
        summary = result[key]
        scored = int(summary.get('completed', 0)) - int(summary.get('void', 0))
        if summary.get('successRate') is not None and scored > 0:
            text = format_success_rate(int(summary.get('successes', 0)), scored, summary.get('wilson95'))
            print(f'{label}: {text}')
    difference = result['successRateDifference']
    if difference is not None:
        print(f"success-rate gap (second - first): {difference:+.1%}")
    paired = result['pairedSuccessRateDifference']
    if paired is not None:
        print(f"paired per-seed success gap (second - first): {paired:+.1%}")
