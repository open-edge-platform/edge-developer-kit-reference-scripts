# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import math
import queue
import time
from collections.abc import Callable, Sequence

import rclpy
from builtin_interfaces.msg import Time
from diagnostic_msgs.msg import DiagnosticArray, DiagnosticStatus, KeyValue
from rcl_interfaces.msg import ParameterDescriptor
from rclpy.callback_groups import ReentrantCallbackGroup
from rclpy.clock import Clock, ClockType
from rclpy.executors import ExternalShutdownException
from rclpy.node import Node
from rclpy.parameter import Parameter
from rclpy.publisher import Publisher
from rclpy.qos import DurabilityPolicy, QoSProfile, ReliabilityPolicy, qos_profile_sensor_data
from rclpy.task import Future
from rosgraph_msgs.msg import Clock as ClockMessage
from sensor_msgs.msg import CameraInfo, CompressedImage, Image, JointState
from std_msgs.msg import Float64MultiArray
from std_srvs.srv import SetBool, Trigger

from robotic_studio_interfaces.msg import BridgeStatus
from robotic_studio_interfaces.srv import SelectInitialState, StartRecording, StopRecording

from robotic_studio.teleoperation import Teleoperation

from .bridge import BridgeView, BridgeWorker, Operation, Request, Result
from .mapping import JointMapping, joint_values, stamp_parts
from .cameras import (
    camera_info_message, camera_token, compressed_image_message, image_dimensions, image_header, image_message,
)


class BridgeConnectionError(RuntimeError):
    """The Studio connection cannot recover without restarting the bridge."""


def array_positions(
    message: Float64MultiArray, mapping: Sequence[JointMapping]
) -> tuple[list[str], list[float]]:
    if message.layout.dim or message.layout.data_offset != 0:
        raise ValueError("Joint commands require a flat array with an empty layout and zero data_offset.")
    names = [item.ros_name for item in mapping if item.joint.controllable]
    if not names:
        raise ValueError("No controllable joints are connected.")
    if len(message.data) != len(names):
        raise ValueError(f"Expected {len(names)} positions in joint order {names}; received {len(message.data)}.")
    return names, list(message.data)


class StudioBridge(Node):
    def __init__(
        self,
        *,
        connect: Callable[[], Teleoperation] | None = None,
        parameter_overrides: list[Parameter] | None = None,
    ) -> None:
        super().__init__("bridge", namespace="/studio", parameter_overrides=parameter_overrides)
        self.declare_parameter("connection", "http://localhost:3000", ParameterDescriptor(read_only=True))
        self.declare_parameter("timeout_s", 5.0, ParameterDescriptor(read_only=True))
        self.declare_parameter("command_timeout_s", 1.0, ParameterDescriptor(read_only=True))
        self.declare_parameter("state_timeout_s", 5.0, ParameterDescriptor(read_only=True))
        self.declare_parameter("publish_clock", True, ParameterDescriptor(read_only=True))
        self.declare_parameter("publish_images", True, ParameterDescriptor(read_only=True))
        self.declare_parameter("image_transport", "both", ParameterDescriptor(read_only=True))
        for name in ("ros_joint_names", "studio_joint_names"):
            self.declare_parameter(
                name, Parameter.Type.STRING_ARRAY,
                ParameterDescriptor(read_only=True),
            )
        connection = self.get_parameter("connection").get_parameter_value().string_value
        timeout = self.get_parameter("timeout_s").get_parameter_value().double_value
        command_timeout = self.get_parameter("command_timeout_s").get_parameter_value().double_value
        state_timeout = self.get_parameter("state_timeout_s").get_parameter_value().double_value
        if not connection:
            raise ValueError("connection must be an app URL or an absolute connection-file path.")
        for name, value in (("timeout_s", timeout), ("command_timeout_s", command_timeout), ("state_timeout_s", state_timeout)):
            if not math.isfinite(value) or value <= 0:
                raise ValueError(f"{name} must be positive and finite.")
        publish_images = self.get_parameter("publish_images").get_parameter_value().bool_value
        self._image_transport = self.get_parameter("image_transport").get_parameter_value().string_value
        if self._image_transport not in ("raw", "compressed", "both"):
            super().destroy_node()
            raise ValueError("image_transport must be raw, compressed, or both.")
        if connect is None:
            connect = lambda: Teleoperation.connect(
                connection, timeout_s=timeout, auto_heartbeat=False, include_images=publish_images,
                decode_images=self._image_transport != "compressed",
            )
        self.worker = BridgeWorker(
            connect,
            ros_names=self.get_parameter_or(
                "ros_joint_names", Parameter("ros_joint_names", Parameter.Type.STRING_ARRAY, [])
            ).get_parameter_value().string_array_value,
            studio_names=self.get_parameter_or(
                "studio_joint_names", Parameter("studio_joint_names", Parameter.Type.STRING_ARRAY, [])
            ).get_parameter_value().string_array_value,
            command_timeout=command_timeout,
            state_timeout=state_timeout,
            forward_images=publish_images,
        )
        self._states = self.create_publisher(JointState, "~/joint_states", qos_profile_sensor_data)
        self._diagnostics = self.create_publisher(DiagnosticArray, "~/diagnostics", 1)
        # Latched so that late-joining panels immediately get the current state.
        self._status = self.create_publisher(
            BridgeStatus, "~/status", QoSProfile(depth=1, durability=DurabilityPolicy.TRANSIENT_LOCAL),
        )
        self._last_status_key: tuple[object, ...] | None = None
        self._last_status = 0.0
        self._image_publishers: dict[str, Publisher[Image]] = {}
        self._compressed_publishers: dict[str, Publisher[CompressedImage]] = {}
        self._published_compressed_images = 0
        self._camera_info_publishers: dict[str, Publisher[CameraInfo]] = {}
        self._calibration_errors: dict[str, str] = {}
        self._published_camera_info = 0
        self._published_images = 0
        publish_clock = self.get_parameter("publish_clock").get_parameter_value().bool_value
        clock_qos = QoSProfile(depth=1, reliability=ReliabilityPolicy.BEST_EFFORT)
        self._clock_publisher = self.create_publisher(ClockMessage, "/clock", clock_qos) if publish_clock else None
        self.create_subscription(Float64MultiArray, "~/joint_commands", self._command, QoSProfile(depth=1))
        services = ReentrantCallbackGroup()
        self.create_service(SetBool, "~/pause", self._pause, callback_group=services)
        self.create_service(Trigger, "~/reset", self._reset, callback_group=services)
        self.create_service(
            SelectInitialState, "~/select_initial_state", self._select_state, callback_group=services,
        )
        self.create_service(StartRecording, "~/recording/start", self._start_recording, callback_group=services)
        self.create_service(StopRecording, "~/recording/stop", self._stop_recording, callback_group=services)
        self._request_id = 0
        self._pending_services: dict[int, Future[Result]] = {}
        self._last_sequence: tuple[str, int] | None = None
        self._last_diagnostic = 0.0
        self._last_error = ""
        self._timer = self.create_timer(
            0.01, self._publish, clock=Clock(clock_type=ClockType.STEADY_TIME)
        )
        self.worker.start()

    def _command(self, message: Float64MultiArray) -> None:
        try:
            self.worker.command(*array_positions(message, self.worker.view.mapping))
        except ValueError as error:
            self.worker.reject(str(error))
            self.get_logger().warning(f"Rejected joint command: {error}")

    async def _operation(self, operation: Operation, *, state_id: str = "", save: bool = True) -> Result:
        if len(self._pending_services) >= 16:
            return Result(0, False, "Too many outstanding Studio service requests.")
        view = self.worker.view
        if not view.mapping or view.terminal:
            return Result(0, False, view.error or "The Studio controller is not connected.")
        self._request_id += 1
        request_id = self._request_id
        future: Future[Result] = Future(executor=self.executor)
        self._pending_services[request_id] = future
        try:
            self.worker.request(Request(request_id, operation, state_id=state_id, save=save))
        except ValueError as error:
            del self._pending_services[request_id]
            return Result(request_id, False, str(error))
        return await future

    async def _pause(self, request: SetBool.Request, response: SetBool.Response) -> SetBool.Response:
        result = await self._operation("pause" if request.data else "resume")
        response.success, response.message = result.success, result.message
        return response

    async def _reset(self, request: Trigger.Request, response: Trigger.Response) -> Trigger.Response:
        result = await self._operation("reset")
        response.success, response.message = result.success, result.message
        return response

    async def _select_state(
        self, request: SelectInitialState.Request, response: SelectInitialState.Response,
    ) -> SelectInitialState.Response:
        result = await self._operation("select_state", state_id=request.state_id)
        response.success, response.message = result.success, result.message
        return response

    async def _start_recording(
        self, request: StartRecording.Request, response: StartRecording.Response,
    ) -> StartRecording.Response:
        result = await self._operation("start_recording")
        response.success, response.message, response.episode_id = result.success, result.message, result.episode_id
        return response

    async def _stop_recording(
        self, request: StopRecording.Request, response: StopRecording.Response,
    ) -> StopRecording.Response:
        result = await self._operation("stop_recording", save=request.save)
        response.success, response.message, response.episode_id = result.success, result.message, result.episode_id
        return response

    def _publish_status(self, view: BridgeView, stamp: Time) -> None:
        snapshot = view.snapshot
        message = view.error or view.last_message
        key = (
            view.phase, message, view.terminal, view.session_id, view.recording, view.last_episode_id,
            view.command_fresh, view.initial_states,
            (snapshot.state_id, snapshot.state_revision) if snapshot else None,
        )
        interval = 0.2 if view.phase == "running" else 1.0
        now = time.monotonic()
        if key == self._last_status_key and now - self._last_status < interval:
            return
        status = BridgeStatus(
            phase=view.phase, message=message, terminal=view.terminal, session_id=view.session_id,
            real_time_factor=view.real_time_factor, recording=view.recording,
            last_episode_id=view.last_episode_id,
            initial_state_ids=[state_id for state_id, _ in view.initial_states],
            initial_state_labels=[label for _, label in view.initial_states],
            command_joint_names=[item.ros_name for item in view.mapping if item.joint.controllable],
            command_fresh=view.command_fresh,
        )
        status.header.stamp = stamp
        if snapshot is not None:
            status.state_id, status.step_id = snapshot.state_id, snapshot.step_id
            status.state_revision, status.simulation_time = snapshot.state_revision, snapshot.simulation_time
        self._status.publish(status)
        self._last_status_key, self._last_status = key, now

    def _publish(self) -> None:
        while True:
            try:
                result = self.worker.result()
            except queue.Empty:
                break
            future = self._pending_services.pop(result.request_id, None)
            if future is not None and not future.done():
                future.set_result(result)
        view = self.worker.view
        if view.error and view.error != self._last_error:
            self.get_logger().error(view.error)
        self._last_error = view.error
        snapshot = view.snapshot
        stamp = Time()
        for camera, sample in self.worker.take_images().items():
            token = camera_token(camera)
            frame_id = f"{self.get_fully_qualified_name().lstrip('/')}/cameras/{token}_optical_frame"
            if self._image_transport in ("raw", "both"):
                if camera not in sample.snapshot.images:
                    raise ValueError(f"Camera '{camera}' has no decoded image for {self._image_transport} output.")
                message = image_message(sample.snapshot, camera, frame_id)
                publisher = self._image_publishers.get(camera)
                if publisher is None:
                    publisher = self.create_publisher(Image, f"~/cameras/{token}/image_raw", qos_profile_sensor_data)
                    self._image_publishers[camera] = publisher
                publisher.publish(message)
                self._published_images += 1
            if self._image_transport in ("compressed", "both"):
                compressed = compressed_image_message(sample.snapshot, camera, frame_id)
                compressed_publisher = self._compressed_publishers.get(camera)
                if compressed_publisher is None:
                    compressed_publisher = self.create_publisher(
                        CompressedImage, f"~/cameras/{token}/image_raw/compressed", qos_profile_sensor_data,
                    )
                    self._compressed_publishers[camera] = compressed_publisher
                compressed_publisher.publish(compressed)
                self._published_compressed_images += 1
            if sample.error:
                if self._calibration_errors.get(camera) != sample.error:
                    self.get_logger().warning(f"CameraInfo unavailable for '{camera}': {sample.error}")
                self._calibration_errors[camera] = sample.error
            elif sample.calibration is not None:
                if self._calibration_errors.pop(camera, None) is not None:
                    self.get_logger().info(f"CameraInfo available again for '{camera}'.")
                info_publisher = self._camera_info_publishers.get(camera)
                if info_publisher is None:
                    info_publisher = self.create_publisher(
                        CameraInfo, f"~/cameras/{token}/camera_info", qos_profile_sensor_data,
                    )
                    self._camera_info_publishers[camera] = info_publisher
                width, height = image_dimensions(sample.snapshot, camera)
                info_publisher.publish(camera_info_message(
                    sample.calibration,
                    CameraInfo(header=image_header(sample.snapshot, frame_id), width=width, height=height),
                ))
                self._published_camera_info += 1
        if snapshot is not None:
            try:
                seconds, nanos = stamp_parts(snapshot.simulation_time)
                stamp = Time(sec=seconds, nanosec=nanos)
                identity = (view.session_id, snapshot.sequence)
                if identity != self._last_sequence:
                    names, positions, velocities = joint_values(view.mapping, snapshot)
                    message = JointState(name=names, position=positions, velocity=velocities)
                    message.header.stamp = stamp
                    if self._clock_publisher is not None:
                        self._clock_publisher.publish(ClockMessage(clock=stamp))
                    self._states.publish(message)
                    self._last_sequence = identity
            except ValueError as error:
                self.worker.reject(f"Cannot publish native state: {error}")
                self.get_logger().error(f"Cannot publish native state: {error}")
        self._publish_status(view, stamp)
        if time.monotonic() - self._last_diagnostic >= 1.0:
            if view.phase == "faulted":
                level = DiagnosticStatus.ERROR
            elif view.error or view.phase == "disconnected" or view.calibration_errors:
                level = DiagnosticStatus.WARN
            else:
                level = DiagnosticStatus.OK
            values = {
                "phase": view.phase,
                "session_id": view.session_id,
                "state_revision": str(snapshot.state_revision) if snapshot else "",
                "step_id": str(snapshot.step_id) if snapshot else "",
                "terminal": str(view.terminal),
                "rejected_commands": str(view.rejected_commands),
                "replaced_commands": str(view.replaced_commands),
                "received_commands": str(view.received_commands),
                "command_joint_names": ", ".join(
                    item.ros_name for item in view.mapping if item.joint.controllable
                ),
                "real_time_factor": f"{view.real_time_factor:.3f}",
                "camera_status": view.camera_status,
                "published_images": str(self._published_images),
                "published_compressed_images": str(self._published_compressed_images),
                "image_transport": self._image_transport,
                "published_camera_info": str(self._published_camera_info),
                "camera_info_errors": "; ".join(f"{name}: {error}" for name, error in view.calibration_errors),
                "dropped_image_snapshots": str(view.dropped_image_snapshots),
                "replaced_images": str(view.replaced_images),
            }
            status = DiagnosticStatus(
                level=level, name=self.get_fully_qualified_name(), hardware_id=view.session_id,
                message=view.error or ("CameraInfo unavailable for some cameras" if view.calibration_errors else view.phase),
                values=[KeyValue(key=key, value=value) for key, value in values.items()],
            )
            diagnostics = DiagnosticArray(status=[status])
            diagnostics.header.stamp = stamp
            self._diagnostics.publish(diagnostics)
            self._last_diagnostic = time.monotonic()
        if view.terminal:
            raise BridgeConnectionError(view.error or "The Studio stream is unavailable.")

    def destroy_node(self) -> None:
        self._timer.cancel()
        for request_id, future in self._pending_services.items():
            if not future.done():
                future.set_result(Result(request_id, False, "Studio bridge is shutting down."))
        self._pending_services.clear()
        self.worker.close()
        super().destroy_node()


def main(args: list[str] | None = None) -> None:
    rclpy.init(args=args)
    node: StudioBridge | None = None
    try:
        node = StudioBridge()
        rclpy.spin(node)
    except BridgeConnectionError:
        raise SystemExit(1) from None
    except (KeyboardInterrupt, ExternalShutdownException):
        pass
    finally:
        if node is not None:
            node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()
