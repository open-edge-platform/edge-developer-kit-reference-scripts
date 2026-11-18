# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import math
import queue
import threading
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, replace
from typing import Literal, Protocol

from robotic_studio.frame_clock import FrameClock, capture_fps_from_profile
from robotic_studio.teleoperation import (
    InitialStateInfo,
    StateSnapshot,
    Teleoperation,
    TeleoperationCommandError,
    TeleoperationStateError,
)
from robotic_studio.teleoperation.client import LEASE_HEARTBEAT_INTERVAL_SECONDS

from .mapping import JointMapping, joint_mapping, joint_values, position_targets, stamp_parts
from .cameras import CameraCalibration, CameraSample, camera_token, image_dimensions


class Session(Protocol):
    @property
    def session_id(self) -> str: ...
    @property
    def current_state(self) -> StateSnapshot: ...
    def observe(self) -> StateSnapshot: ...
    def heartbeat(self) -> None: ...
    def step(self, *, joints: Mapping[str, float], physics_steps: int) -> StateSnapshot: ...
    def reset(self) -> StateSnapshot: ...
    @property
    def initial_states(self) -> tuple[InitialStateInfo, ...]: ...
    def select_initial_state(self, state_id: str) -> StateSnapshot: ...
    def start_recording(self) -> str: ...
    def stop_recording(self, *, save: bool = True) -> Mapping[str, object] | None: ...
    def save_recording(self) -> Mapping[str, object]: ...
    def discard_recording(self) -> None: ...


Phase = Literal["disconnected", "paused", "running", "faulted"]
Operation = Literal["pause", "resume", "reset", "select_state", "start_recording", "stop_recording"]


@dataclass(frozen=True)
class BridgeView:
    phase: Phase = "disconnected"
    session_id: str = ""
    snapshot: StateSnapshot | None = None
    mapping: tuple[JointMapping, ...] = ()
    error: str = ""
    terminal: bool = False
    rejected_commands: int = 0
    replaced_commands: int = 0
    real_time_factor: float = 0.0
    received_commands: int = 0
    camera_status: str = "disabled"
    dropped_image_snapshots: int = 0
    replaced_images: int = 0
    calibration_errors: tuple[tuple[str, str], ...] = ()
    recording: str = "idle"
    last_episode_id: str = ""
    last_message: str = ""
    initial_states: tuple[tuple[str, str], ...] = ()
    command_fresh: bool = False


@dataclass(frozen=True)
class Request:
    request_id: int
    operation: Operation
    state_id: str = ""
    save: bool = True


@dataclass(frozen=True)
class Result:
    request_id: int
    success: bool
    message: str
    episode_id: str = ""


class Controller:
    """Single-threaded SDK controller; ROS callbacks never call this object."""

    def __init__(
        self,
        client: Session,
        mapping: tuple[JointMapping, ...],
        *,
        fps: int,
        timestep: float,
        command_timeout: float,
        state_timeout: float,
        now: float,
    ) -> None:
        for name, value in (("command_timeout", command_timeout), ("state_timeout", state_timeout)):
            if not math.isfinite(value) or value <= 0:
                raise ValueError(f"{name} must be positive and finite.")
        self.client = client
        self.mapping = mapping
        self.clock = FrameClock(fps, timestep)
        if math.ceil(self.clock.steps_per_frame) > 1_000:
            raise ValueError("The capture rate requires more than 1,000 physics steps per command.")
        self.command_timeout = command_timeout
        self.state_timeout = state_timeout
        self._accept_snapshot(client.current_state)
        self.phase: Phase = "paused"
        self.error = ""
        self.terminal = False
        self.targets: dict[str, float] = {}
        self.command_at: float | None = None
        self.state_at = now
        self.heartbeat_at = now
        self.real_time_factor = 0.0
        self.generation = 0
        # A recording stopped by this bridge that is neither saved nor discarded yet.
        self.recording_pending = False
        self.last_episode_id = ""
        self.last_message = ""

    def command(self, targets: dict[str, float], received_at: float) -> None:
        if self.terminal:
            raise ValueError("The connection is faulted; restart the bridge before sending commands.")
        self.targets = targets
        self.command_at = received_at
        if self.phase != "faulted":
            self.error = ""

    def fault(self, message: str, *, terminal: bool = False) -> None:
        self.generation += 1
        self.phase = "faulted"
        self.error = message
        self.terminal = terminal
        self.targets = {}
        self.command_at = None
        self.clock.reset()
        self.real_time_factor = 0.0

    def _accept_snapshot(self, snapshot: StateSnapshot) -> None:
        try:
            joint_values(self.mapping, snapshot)
            stamp_parts(snapshot.simulation_time)
        except ValueError as error:
            raise RuntimeError(f"Native state cannot be represented by the ROS bridge: {error}") from error
        self.snapshot = snapshot

    def _stop_stepping(self) -> None:
        self.generation += 1
        self.phase = "paused"
        self.targets = {}
        self.command_at = None
        self.real_time_factor = 0.0

    def _restarted(self, snapshot: StateSnapshot, started: float, now: float) -> None:
        """Adopt a new state after reset or state selection; stepping stays paused."""
        self._accept_snapshot(snapshot)
        self._stop_stepping()
        self.clock.reset()
        self.state_at = now + (time.monotonic() - started)
        self.error = ""

    def request(self, operation: Operation, now: float, *, state_id: str = "", save: bool = True) -> str:
        if self.terminal:
            raise ValueError("The connection is faulted; restart the bridge to reconnect.")
        message = self._request(operation, now, state_id=state_id, save=save)
        self.last_message = message
        return message

    def _request(self, operation: Operation, now: float, *, state_id: str, save: bool) -> str:
        if operation == "pause":
            self._stop_stepping()
            return "Simulation stepping paused; send fresh positions before resuming."
        if operation == "resume":
            if self.command_at is None or now - self.command_at > self.command_timeout:
                raise ValueError("Send a fresh joint command before resuming.")
            self.phase = "running"
            self.error = ""
            return "Simulation stepping resumed."
        if operation == "reset":
            started = time.monotonic()
            self._restarted(self.client.reset(), started, now)
            return "Active initial state reset; stepping remains paused."
        if operation == "select_state":
            if not any(state.state_id == state_id for state in self.client.initial_states):
                raise ValueError(f"Unknown initial state '{state_id}'.")
            started = time.monotonic()
            self._restarted(self.client.select_initial_state(state_id), started, now)
            return f"Initial state '{state_id}' selected; stepping remains paused."
        if operation == "start_recording":
            if self.recording_pending:
                raise ValueError("Save or discard the stopped recording first.")
            self.last_episode_id = self.client.start_recording()
            return f"Recording episode '{self.last_episode_id}' started."
        if operation == "stop_recording":
            return self._stop_recording(now, save)
        raise ValueError(f"Unknown operation '{operation}'.")

    def _stop_recording(self, now: float, save: bool) -> str:
        if save:
            # record.save blocks this thread for up to minutes; never keep stepping behind it.
            self._stop_stepping()
        started = time.monotonic()
        try:
            if not self.recording_pending:
                # The server rejects a stop without an active recording; the snapshot may lag a start.
                pending = self.client.stop_recording(save=False)
                if pending is None:
                    return "Recording stopped without frames; nothing to save."
                self.recording_pending = True
                episode_id = pending.get("episodeId")
                if isinstance(episode_id, str) and episode_id:
                    self.last_episode_id = episode_id
            if save:
                episode = self.client.save_recording()
                episode_id = episode.get("episodeId")
                if isinstance(episode_id, str) and episode_id:
                    self.last_episode_id = episode_id
                self.recording_pending = False
                return f"Recording episode '{self.last_episode_id}' saved; stepping paused."
            self.client.discard_recording()
            self.recording_pending = False
            return f"Recording episode '{self.last_episode_id}' discarded."
        finally:
            # Saving does not tick; the stream was not stale while the worker waited.
            self.state_at = max(self.state_at, now + (time.monotonic() - started))

    def tick(self, now: float) -> None:
        if self.terminal:
            return
        cycle_started = time.monotonic()
        heartbeat_due = now - self.heartbeat_at >= LEASE_HEARTBEAT_INTERVAL_SECONDS
        if heartbeat_due:
            self.client.heartbeat()
        snapshot = self.client.observe()
        now += time.monotonic() - cycle_started
        if heartbeat_due:
            self.heartbeat_at = now
        previous = self.snapshot
        self._accept_snapshot(snapshot)
        if snapshot.sequence > previous.sequence:
            self.state_at = now
        if now - self.state_at > self.state_timeout:
            self.fault("Authoritative state stream is stale.", terminal=True)
            return
        if (
            snapshot.state_revision != previous.state_revision
            or snapshot.state_id != previous.state_id
            or snapshot.step_id < previous.step_id
            or snapshot.simulation_time < previous.simulation_time
        ):
            self.fault("Native state changed; pending commands cleared. Send fresh positions and resume.")
            return
        if self.phase != "running":
            return
        if self.command_at is None or now - self.command_at > self.command_timeout:
            self.fault("Joint command watchdog expired; simulation stepping paused.")
            return
        started = time.monotonic()
        self._accept_snapshot(self.client.step(
            joints=self.targets, physics_steps=self.clock.next_physics_steps()
        ))
        finished = time.monotonic()
        self.state_at = now + (finished - started)
        elapsed = max(finished - cycle_started, self.clock.period)
        self.real_time_factor = (self.snapshot.simulation_time - snapshot.simulation_time) / elapsed

    def view(self, now: float | None = None) -> BridgeView:
        recording = self.snapshot.recording
        if self.recording_pending and recording == "idle":
            recording = "pending"
        now = time.monotonic() if now is None else now
        return BridgeView(
            phase=self.phase, session_id=self.client.session_id, snapshot=self.snapshot,
            mapping=self.mapping, error=self.error, terminal=self.terminal,
            real_time_factor=self.real_time_factor, recording=recording,
            last_episode_id=self.last_episode_id, last_message=self.last_message,
            initial_states=tuple((state.state_id, state.label) for state in self.client.initial_states),
            command_fresh=self.command_at is not None and now - self.command_at <= self.command_timeout,
        )


class BridgeWorker:
    def __init__(
        self,
        connect: Callable[[], Teleoperation],
        *,
        ros_names: Sequence[str] = (),
        studio_names: Sequence[str] = (),
        command_timeout: float = 1.0,
        state_timeout: float = 5.0,
        forward_images: bool = False,
    ) -> None:
        self._connect = connect
        self._ros_names = ros_names
        self._studio_names = studio_names
        self._command_timeout = command_timeout
        self._state_timeout = state_timeout
        self._forward_images = forward_images
        self._camera_status = "disabled"
        self._camera_names: set[str] = set()
        self._images: dict[str, CameraSample] = {}
        self._calibration: CameraCalibration | None = None
        self._calibration_errors: dict[str, str] = {}
        self._dropped_image_snapshots = 0
        self._replaced_images = 0
        self._lock = threading.Lock()
        self._view = BridgeView()
        self._pending: tuple[dict[str, float], float] | None = None
        self._rejected = 0
        self._replaced = 0
        self._received = 0
        self._rejection = ""
        self._requests: queue.Queue[Request] = queue.Queue(maxsize=16)
        self._results: queue.Queue[Result] = queue.Queue(maxsize=16)
        self._outstanding = 0
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, name="studio-ros-control")

    @property
    def view(self) -> BridgeView:
        with self._lock:
            return self._view

    def start(self) -> None:
        self._thread.start()

    def command(self, names: Sequence[str], positions: Sequence[float]) -> None:
        with self._lock:
            if not self._view.mapping or self._view.terminal:
                raise ValueError("The Studio controller is not connected.")
            targets = position_targets(self._view.mapping, names, positions)
            if self._pending is not None:
                self._replaced += 1
            self._pending = (targets, time.monotonic())
            self._received += 1
            self._rejection = ""

    def reject(self, message: str) -> None:
        with self._lock:
            self._rejected += 1
            self._rejection = message

    def request(self, request: Request) -> None:
        with self._lock:
            if self._stop.is_set() or self._view.terminal:
                raise ValueError(self._view.error or "Studio worker stopped.")
            if self._outstanding >= 16:
                raise ValueError("Studio service queue is full.")
            self._requests.put_nowait(request)
            self._outstanding += 1

    def result(self) -> Result:
        result = self._results.get_nowait()
        with self._lock:
            self._outstanding -= 1
        return result

    def close(self) -> None:
        self._stop.set()
        self._thread.join()

    def take_images(self) -> dict[str, CameraSample]:
        """Take the newest pending sample per configured camera without touching the SDK."""
        with self._lock:
            images, self._images = self._images, {}
            return images

    def _collect_images(self, client: Teleoperation, controller: Controller) -> None:
        samples = client.take_image_snapshots()
        current = controller.snapshot
        with self._lock:
            self._dropped_image_snapshots = client.dropped_image_snapshots
            if controller.terminal:
                self._images.clear()
                return
            forwarded = False
            for snapshot in samples:
                if (
                    snapshot.state_revision != current.state_revision
                    or snapshot.state_id != current.state_id
                    or snapshot.step_id > current.step_id
                    or snapshot.simulation_time > current.simulation_time
                ):
                    continue
                for name in snapshot.images.keys() | snapshot.compressed_images.keys():
                    if name not in self._camera_names:
                        raise ValueError(f"Native preview contains unconfigured camera '{name}'.")
                    width, height = image_dimensions(snapshot, name)
                    if name in self._images:
                        self._replaced_images += 1
                    calibration = None
                    error_message = ""
                    try:
                        if self._calibration is None:
                            raise ValueError("Camera calibration is not initialized.")
                        calibration = self._calibration.for_image(name, width, height)
                    except ValueError as error:
                        error_message = str(error)
                        self._calibration_errors[name] = error_message
                    else:
                        self._calibration_errors.pop(name, None)
                    self._images[name] = CameraSample(snapshot, calibration, error_message)
                    forwarded = True
            if forwarded:
                self._camera_status = "streaming RGB previews"

    def _publish_view(self, controller: Controller) -> None:
        with self._lock:
            view = controller.view()
            if view.terminal:
                self._images.clear()
            self._view = replace(
                view, error=view.error or self._rejection, rejected_commands=self._rejected,
                replaced_commands=self._replaced, received_commands=self._received,
                camera_status=self._camera_status, dropped_image_snapshots=self._dropped_image_snapshots,
                replaced_images=self._replaced_images,
                calibration_errors=tuple(sorted(self._calibration_errors.items())),
            )

    def _run(self) -> None:
        client: Teleoperation | None = None
        controller: Controller | None = None
        try:
            client = self._connect()
            if self._forward_images:
                cameras = client.profile.get("cameras", [])
                if not isinstance(cameras, list):
                    raise ValueError("profile.cameras must be an array.")
                camera_names: dict[str, str] = {}
                for camera in cameras:
                    if not isinstance(camera, Mapping) or not isinstance(camera.get("outputName"), str):
                        raise ValueError("Each profile camera must have a string outputName.")
                    name = camera["outputName"]
                    camera_token(name)
                    self._camera_names.add(name)
                    camera_name = camera.get("camera")
                    camera_names[name] = camera_name if isinstance(camera_name, str) else ""
                self._calibration = CameraCalibration(client.local.model, client.local.data, camera_names)
                self._camera_status = (
                    "waiting for RGB previews" if client.profile.get("captureRgb") and self._camera_names
                    else "unavailable: enable RGB capture and configure cameras in Generate"
                )
            controller = Controller(
                client, joint_mapping(client.joints, self._ros_names, self._studio_names),
                fps=capture_fps_from_profile(client.profile),
                timestep=float(client.local.model.opt.timestep),
                command_timeout=self._command_timeout, state_timeout=self._state_timeout,
                now=time.monotonic(),
            )
            while not self._stop.is_set():
                started = time.monotonic()
                generation = controller.generation
                with self._lock:
                    pending, self._pending = self._pending, None
                if pending is not None:
                    try:
                        controller.command(*pending)
                    except ValueError as error:
                        self.reject(str(error))
                # A fixed batch bounds service work even if callers continuously enqueue.
                for _ in range(16):
                    try:
                        request = self._requests.get_nowait()
                    except queue.Empty:
                        break
                    try:
                        message = controller.request(
                            request.operation, time.monotonic(), state_id=request.state_id, save=request.save,
                        )
                        result = Result(request.request_id, True, message, controller.last_episode_id)
                    except (ValueError, TeleoperationCommandError, TeleoperationStateError) as error:
                        controller.last_message = str(error)
                        result = Result(request.request_id, False, str(error), controller.last_episode_id)
                    except Exception as error:  # SDK errors must fault, never retry mutations.
                        controller.fault(f"{type(error).__name__}: {error}", terminal=True)
                        result = Result(request.request_id, False, controller.error)
                    self._results.put_nowait(result)
                try:
                    controller.tick(time.monotonic())
                except (TeleoperationCommandError, TeleoperationStateError) as error:
                    controller.fault(f"{type(error).__name__}: {error}")
                except Exception as error:
                    controller.fault(f"{type(error).__name__}: {error}", terminal=True)
                if controller.generation != generation:
                    with self._lock:
                        self._pending = None
                        self._images.clear()
                    if self._forward_images:
                        client.take_image_snapshots()
                elif self._forward_images:
                    self._collect_images(client, controller)
                self._publish_view(controller)
                # No catch-up ticks: a slow command reduces real-time factor.
                self._stop.wait(max(0.0, controller.clock.period - (time.monotonic() - started)))
        except Exception as error:  # Thread failures must become visible ROS diagnostics.
            message = f"{type(error).__name__}: {error}"
            if controller is not None:
                controller.fault(message, terminal=True)
                self._publish_view(controller)
            else:
                with self._lock:
                    self._view = BridgeView(phase="faulted", error=message, terminal=True)
        finally:
            if client is not None:
                client.close()
            while not self._requests.empty():
                request = self._requests.get_nowait()
                self._results.put_nowait(Result(request.request_id, False, "Studio worker stopped."))
