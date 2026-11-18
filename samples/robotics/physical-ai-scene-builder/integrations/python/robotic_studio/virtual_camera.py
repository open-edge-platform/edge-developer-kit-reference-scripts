# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Expose simulated scene cameras as V4L2 webcams (``/dev/video<n>``).

Run as ``python -m robotic_studio.virtual_camera`` it watches a streaming Simulate session without
taking its control lease: it renders the enabled cameras about ``--fps`` times a second without
stepping, so it works whoever drives the simulation (a virtual robot, an SDK app, or nobody).

Each enabled camera runs :mod:`robotic_studio.v4l2_loopback_relay` as root where the camera
client looks for it (inside the Physical AI Studio container, or on this computer through a helper
container; see :mod:`robotic_studio.device_relay`) and streams the camera's rendered RGB frames to it as YUYV. Frames are dropped rather than queued, so
a slow consumer never stalls the simulation loop.
"""

from __future__ import annotations

import argparse
import json
import subprocess  # nosec B404
import sys
import threading
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from . import v4l2_loopback_relay
from .device_relay import add_target_arguments, relay_command_prefix

FIRST_DEVICE_NUMBER = 40
MAX_LABEL_LENGTH = 31


class VirtualCameraError(RuntimeError):
    """A camera request could not be carried out."""


def rgb_to_yuyv(image: np.ndarray) -> bytes:
    """Converts an ``HxWx3`` RGB image with an even width to packed YUYV (BT.601, limited range)."""
    rgb = np.asarray(image, dtype=np.float32)
    if rgb.ndim != 3 or rgb.shape[2] != 3 or rgb.shape[1] % 2:
        raise ValueError("Expected an HxWx3 RGB image with an even width.")
    red, green, blue = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    luma = 16.0 + (65.481 * red + 128.553 * green + 24.966 * blue) / 255.0
    blue_diff = 128.0 + (-37.797 * red - 74.203 * green + 112.0 * blue) / 255.0
    red_diff = 128.0 + (112.0 * red - 93.786 * green - 18.214 * blue) / 255.0
    packed = np.empty((rgb.shape[0], rgb.shape[1] // 2, 4), dtype=np.float32)
    packed[..., 0] = luma[:, 0::2]
    packed[..., 1] = (blue_diff[:, 0::2] + blue_diff[:, 1::2]) / 2.0
    packed[..., 2] = luma[:, 1::2]
    packed[..., 3] = (red_diff[:, 0::2] + red_diff[:, 1::2]) / 2.0
    return np.clip(np.rint(packed), 0, 255).astype(np.uint8).tobytes()


def device_label(camera: str) -> str:
    """The name camera discovery reports for the virtual device (v4l2loopback keeps 31 bytes)."""
    return f"Virtual {camera}".encode()[:MAX_LABEL_LENGTH].decode(errors="ignore")


@dataclass(frozen=True)
class CameraSpec:
    name: str
    output_name: str
    width: int
    height: int
    number: int

    @property
    def device_width(self) -> int:
        # YUYV packs two pixels per sample pair, so an odd last column is cropped.
        return self.width - self.width % 2


class CameraRelay:
    """One loopback device fed with the latest frame of one camera."""

    def __init__(
        self,
        spec: CameraSpec,
        command_prefix: Sequence[str],
        python: str,
        fps: int,
        on_event: Callable[[dict[str, Any]], None] = lambda _event: None,
    ) -> None:
        self.spec = spec
        self.on_event = on_event
        source = Path(v4l2_loopback_relay.__file__).read_text()
        self.process = subprocess.Popen(
            [
                *command_prefix,
                python,
                "-u",
                "-c",
                source,
                "--label",
                device_label(spec.name),
                "--width",
                str(spec.device_width),
                "--height",
                str(spec.height),
                "--fps",
                str(fps),
                "--number",
                str(spec.number),
            ],
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            bufsize=0,
        )
        self.device_path: str | None = None
        self.error: str | None = None
        self.frames_written = 0
        self._ready = threading.Event()
        self._frame: np.ndarray | None = None
        self._frame_ready = threading.Condition()
        self._closing = False
        threading.Thread(target=self._watch, daemon=True).start()
        threading.Thread(target=self._write, daemon=True).start()

    @property
    def state(self) -> str:
        if self.error:
            return "failed"
        if self.device_path and self.process.poll() is None:
            return "ready"
        return "starting" if self.process.poll() is None else "stopped"

    def submit(self, image: np.ndarray) -> None:
        with self._frame_ready:
            self._frame = image
            self._frame_ready.notify()

    def _watch(self) -> None:
        assert self.process.stderr is not None
        for raw in self.process.stderr:
            line = raw.decode(errors="replace").strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except ValueError:
                event = {"type": "log", "message": line}
            if event.get("type") == "ready":
                self.device_path = str(event.get("device"))
                self._ready.set()
            elif event.get("type") == "error":
                self.error = str(event.get("message"))
            event = {**event, "camera": self.spec.name}
            self.on_event(event)
        code = self.process.wait()
        if not self._closing and not self.error:
            self.error = f"The camera relay exited with code {code}."
        self._ready.set()
        with self._frame_ready:
            self._frame_ready.notify()

    def _write(self) -> None:
        assert self.process.stdin is not None
        self._ready.wait()
        width = self.spec.device_width
        while True:
            with self._frame_ready:
                while self._frame is None and not self._closing and self.process.poll() is None:
                    self._frame_ready.wait()
                frame, self._frame = self._frame, None
            if frame is None:
                return
            try:
                self.process.stdin.write(rgb_to_yuyv(frame[:, :width, :3]))
            except (BrokenPipeError, ValueError, OSError):
                return
            self.frames_written += 1

    def close(self, timeout_s: float = 8.0) -> None:
        with self._frame_ready:
            self._closing = True
            self._frame_ready.notify()
        if self.process.stdin is not None:
            try:
                self.process.stdin.close()
            except OSError:
                pass
        try:
            self.process.wait(timeout=timeout_s)
        except subprocess.TimeoutExpired:
            self.process.terminate()
            try:
                self.process.wait(timeout=3.0)
            except subprocess.TimeoutExpired:
                self.process.kill()


class VirtualCameras:
    """The scene's cameras and which of them are exposed as virtual webcams."""

    def __init__(
        self,
        cameras: Sequence[Mapping[str, Any]],
        command_prefix: Sequence[str],
        python: str,
        fps: int,
        on_event: Callable[[dict[str, Any]], None] = lambda _event: None,
        relay_factory: Callable[..., CameraRelay] = CameraRelay,
    ) -> None:
        self.specs: dict[str, CameraSpec] = {}
        for index, camera in enumerate(cameras):
            name = str(camera.get("name") or camera.get("outputName") or f"camera_{index}")
            self.specs[name] = CameraSpec(
                name=name,
                output_name=str(camera.get("outputName") or name),
                width=int(camera["width"]),
                height=int(camera["height"]),
                number=FIRST_DEVICE_NUMBER + index,
            )
        self.command_prefix = list(command_prefix)
        self.python = python
        self.fps = fps
        self.on_event = on_event
        self.relay_factory = relay_factory
        self._relays: dict[str, CameraRelay] = {}
        self._lock = threading.Lock()

    def set_enabled(self, name: str, enabled: bool) -> None:
        spec = self.specs.get(name)
        if spec is None:
            raise VirtualCameraError(f"The scene has no camera named '{name}'.")
        if spec.device_width < 2 or spec.height < 1:
            raise VirtualCameraError(f"Camera '{name}' is too small to expose.")
        with self._lock:
            relay = self._relays.pop(name, None)
            # Re-enabling a failed camera starts a fresh relay.
            if enabled and relay is not None and relay.state in ("starting", "ready"):
                self._relays[name] = relay
                return
        if relay is not None:
            relay.close()
        if enabled:
            relay = self.relay_factory(spec, self.command_prefix, self.python, self.fps, self.on_event)
            with self._lock:
                self._relays[name] = relay

    def ready_outputs(self) -> list[str]:
        """Camera output names with a device ready for frames; only these need rendering."""
        with self._lock:
            return [relay.spec.output_name for relay in self._relays.values() if relay.state == "ready"]

    def publish(self, images: Mapping[str, np.ndarray]) -> None:
        with self._lock:
            relays = list(self._relays.values())
        for relay in relays:
            image = images.get(relay.spec.output_name)
            if image is not None and relay.state == "ready":
                relay.submit(image)

    def snapshot(self) -> list[dict[str, Any]]:
        with self._lock:
            relays = dict(self._relays)
        result = []
        for name, spec in self.specs.items():
            relay = relays.get(name)
            result.append(
                {
                    "name": name,
                    "width": spec.device_width,
                    "height": spec.height,
                    "enabled": relay is not None,
                    "state": relay.state if relay is not None else "off",
                    "device": relay.device_path if relay is not None and relay.state == "ready" else None,
                    "error": relay.error if relay is not None else None,
                    "frames": relay.frames_written if relay is not None else 0,
                }
            )
        return result

    def close(self) -> None:
        with self._lock:
            relays = list(self._relays.values())
            self._relays.clear()
        threads = [threading.Thread(target=relay.close) for relay in relays]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()


def _emit(message: Mapping[str, Any]) -> None:
    sys.stdout.write(json.dumps(message) + "\n")
    sys.stdout.flush()


def _camera_event(event: Mapping[str, Any]) -> None:
    camera = event.get("camera")
    if event.get("type") == "ready":
        _emit({"type": "log", "message": f"Camera {camera} ready at {event.get('device')}."})
    elif event.get("type") in ("error", "log") and event.get("message"):
        _emit({"type": "log", "message": f"Camera {camera}: {event['message']}"})
    elif event.get("type") == "closed" and event.get("removed") is False:
        _emit(
            {
                "type": "log",
                "message": f"Camera {camera}: {event.get('device')} is still open in another app; "
                "it is reused the next time the camera is turned on.",
            }
        )


def _set_enabled(cameras: VirtualCameras, name: str, enabled: bool) -> None:
    try:
        cameras.set_enabled(name, enabled)
    except VirtualCameraError as error:
        _emit({"type": "log", "message": str(error)})


def _read_commands(cameras: VirtualCameras, stop: threading.Event) -> None:
    for line in sys.stdin:
        try:
            command = json.loads(line)
        except ValueError:
            continue
        if command.get("type") == "camera":
            _set_enabled(cameras, str(command.get("name")), bool(command.get("enabled")))
        elif command.get("type") == "stop":
            break
    stop.set()


def run(args: argparse.Namespace) -> int:
    from robotic_studio.environment import StudioEnvironment

    stop = threading.Event()
    environment = StudioEnvironment.connect(args.studio_url, timeout_s=args.timeout)
    cameras: VirtualCameras | None = None
    try:
        environment.wait_for_studio(timeout_s=args.timeout, acquire=False)
        description = environment.describe()
        prefix = relay_command_prefix(args)
        cameras = VirtualCameras(
            description.get("cameras") or [],
            prefix,
            args.relay_python,
            fps=round(args.fps),
            on_event=_camera_event,
        )
        for name in args.camera or []:
            _set_enabled(cameras, name, True)
        _emit({"type": "ready", "cameras": cameras.snapshot()})
        threading.Thread(target=_read_commands, args=(cameras, stop), daemon=True).start()

        period = 1.0 / args.fps
        next_tick = time.monotonic()
        next_status = 0.0
        while not stop.is_set():
            outputs = cameras.ready_outputs()
            if outputs:
                cameras.publish(environment.render(outputs).images)
            now = time.monotonic()
            if now >= next_status:
                _emit({"type": "status", "cameras": cameras.snapshot()})
                next_status = now + 0.25
            next_tick = max(next_tick + period, now)
            stop.wait(max(0.0, next_tick - time.monotonic()))
    except Exception as error:
        _emit({"type": "error", "message": f"{type(error).__name__}: {error}"})
        return 1
    finally:
        if cameras is not None:
            cameras.close()
        environment.close()
        _emit({"type": "stopped"})
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="robotic-studio-virtual-cameras",
        description="Expose the cameras of a streaming Simulate session as /dev/video<n> webcams.",
    )
    parser.add_argument("--studio-url", default="http://127.0.0.1:3000")
    add_target_arguments(parser)
    parser.add_argument("--camera", action="append", help="Scene camera to expose (repeatable).")
    parser.add_argument("--fps", type=float, default=30.0, help="Frames rendered per second.")
    parser.add_argument("--timeout", type=float, default=20.0)
    args = parser.parse_args(argv)
    if not 1.0 <= args.fps <= 60.0:
        parser.error("--fps must be between 1 and 60.")
    return run(args)


if __name__ == "__main__":
    raise SystemExit(main())
