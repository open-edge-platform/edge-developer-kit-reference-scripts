# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import io
import json
import math
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from collections import deque
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from types import MappingProxyType
from typing import Any, Self

import numpy as np

from ..generation.native_scene import NativeScene
from ..generation.scene_bundle import SceneBundle, SceneBundleError, SceneBundleLoader
from ..http_transport import HttpCommandSocket, HttpStateSocket, open_http
from .session import TeleoperationLeaseError, TeleoperationStateError


PROTOCOL_VERSION = 1
LEASE_HEARTBEAT_INTERVAL_SECONDS = 2.0
RECORD_SAVE_TIMEOUT_SECONDS = 120.0
MAX_SCENE_BUNDLE_BYTES = 1024 * 1024 * 1024
MAX_JSON_BYTES = 16 * 1024 * 1024
MAX_STREAM_BYTES = 500 * 1024 * 1024


class TeleoperationError(RuntimeError):
    """Base class for errors raised by the public teleoperation client."""


class TeleoperationConnectionError(TeleoperationError):
    """The app, native transport, or local scene could not be connected."""


class TeleoperationDiscoveryError(TeleoperationConnectionError):
    """The active teleoperation session could not be discovered from the app."""


class TeleoperationProtocolError(TeleoperationError):
    """A response or state stream message did not match protocol v1."""


class TeleoperationCommandError(TeleoperationError):
    """The native server rejected a command with a structured error."""

    def __init__(
        self,
        code: str,
        message: str,
        details: Mapping[str, Any] | None = None,
    ) -> None:
        self.code = code
        self.message = message
        self.details = dict(details or {})
        super().__init__(f"{code}: {message}")


class TeleoperationCommandOutcomeUnknown(TeleoperationConnectionError):
    """A command may have reached the server, but its reply timed out."""

    def __init__(self, command: str, endpoint: str, session_id: str) -> None:
        self.command = command
        self.endpoint = endpoint
        self.session_id = session_id
        super().__init__(
            f"Timed out waiting for teleoperation command '{command}' from {endpoint} "
            f"for session '{session_id}'. The command outcome is unknown; it was not retried."
        )


# A shorter spelling is useful to callers that prefer the word timeout.
TeleoperationCommandTimeoutError = TeleoperationCommandOutcomeUnknown


@dataclass(frozen=True, slots=True)
class JointInfo:
    name: str
    joint_type: str
    qpos_slice: slice
    qvel_slice: slice
    range: tuple[float, float] | None
    actuator_names: tuple[str, ...]
    controllable: bool
    position_control_range: tuple[float, float] | None = None


@dataclass(frozen=True, slots=True)
class ActuatorInfo:
    name: str
    action_name: str | None
    joint_name: str | None
    control_range: tuple[float, float] | None
    controllable: bool


@dataclass(frozen=True, slots=True)
class InitialStateInfo:
    state_id: str
    label: str
    index: int
    seed: int
    created_at: str
    randomization: Mapping[str, Any] | None = None
    qpos: np.ndarray | None = None
    qvel: np.ndarray | None = None
    ctrl: np.ndarray | None = None


@dataclass(frozen=True, slots=True)
class RecordingAttempt:
    """Identity of one started recording; ``seed`` differs for every recording in a collection."""

    index: int
    seed: int


@dataclass(frozen=True, slots=True)
class CompressedImage:
    """Original native JPEG preview and its validated header dimensions."""

    data: bytes
    width: int
    height: int
    encoding: str = "jpeg"


@dataclass(frozen=True, slots=True)
class StateSnapshot:
    sequence: int
    step_id: int
    state_revision: int
    state_id: str
    simulation_time: float
    qpos: np.ndarray
    qvel: np.ndarray
    ctrl: np.ndarray
    body_positions: Mapping[str, np.ndarray]
    body_quaternions: Mapping[str, np.ndarray]
    state: np.ndarray | None = None
    action: np.ndarray | None = None
    recording: str = "idle"
    images: Mapping[str, np.ndarray] = field(default_factory=dict)
    episode_id: str | None = None
    compressed_images: Mapping[str, CompressedImage] = field(default_factory=dict)


class LocalScene:
    """A compiled local MuJoCo mirror of the authoritative native scene."""

    def __init__(self, model: Any, data: Any, *, mujoco_module: Any | None = None) -> None:
        self.model = model
        self.data = data
        self._mujoco = mujoco_module
        self._closed = False

    def synchronize(self, snapshot: StateSnapshot) -> None:
        if self._closed:
            raise TeleoperationConnectionError("The local teleoperation scene is closed.")
        for name, values, expected in (
            ("qpos", snapshot.qpos, int(self.model.nq)),
            ("qvel", snapshot.qvel, int(self.model.nv)),
            ("ctrl", snapshot.ctrl, int(self.model.nu)),
        ):
            if values.shape != (expected,):
                raise TeleoperationProtocolError(
                    f"The local scene does not match the native {name} shape: "
                    f"received {values.shape}, expected {(expected,)}."
                )
            if not np.all(np.isfinite(values)):
                raise TeleoperationProtocolError(f"Native {name} contains non-finite values.")

        np.asarray(self.data.qpos)[:] = snapshot.qpos
        np.asarray(self.data.qvel)[:] = snapshot.qvel
        np.asarray(self.data.ctrl)[:] = snapshot.ctrl
        if self._mujoco is None:
            try:
                import mujoco
            except ModuleNotFoundError as error:  # pragma: no cover - model creation already needs it.
                raise TeleoperationConnectionError(
                    "Local synchronization requires the optional 'mujoco' dependency."
                ) from error
            self._mujoco = mujoco
        try:
            self._mujoco.mj_forward(self.model, self.data)
        except Exception as error:  # noqa: BLE001 - surface a client-level scene error.
            raise TeleoperationConnectionError("The local MuJoCo scene could not be synchronized.") from error

    def close(self) -> None:
        self._closed = True


@dataclass(frozen=True, slots=True)
class _ActionBinding:
    action_name: str
    actuator_name: str
    actuator_index: int
    joint_name: str | None
    joint_index: int | None
    control_range: tuple[float, float] | None
    position_actuator: bool


@dataclass(frozen=True, slots=True)
class _Metadata:
    joints: Mapping[str, JointInfo]
    actuators: Mapping[str, ActuatorInfo]
    action_names: tuple[str, ...]
    bindings: tuple[_ActionBinding, ...]
    joint_candidates: Mapping[str, tuple[_ActionBinding, ...]]


@dataclass(frozen=True, slots=True)
class _ResolvedConnection:
    control_endpoint: str
    publisher_endpoint: str
    base_url: str | None
    scene_path: Path
    discovery: Mapping[str, Any]
    temporary_directories: tuple[tempfile.TemporaryDirectory[str], ...]


def _readonly_array(value: Any, label: str, *, dimensions: int | None = None) -> np.ndarray:
    try:
        raw_array = np.asarray(value)
    except (TypeError, ValueError) as error:
        raise TeleoperationProtocolError(f"{label} must contain numeric values.") from error
    if raw_array.dtype.kind not in {"i", "u", "f"}:
        raise TeleoperationProtocolError(f"{label} must contain numeric values.")
    array = raw_array.astype(np.float64, copy=False)
    if dimensions is not None and array.ndim != dimensions:
        raise TeleoperationProtocolError(f"{label} must be {dimensions}-dimensional.")
    if not np.all(np.isfinite(array)):
        raise TeleoperationProtocolError(f"{label} must contain finite values.")
    result = np.array(array, dtype=np.float64, copy=True)
    result.setflags(write=False)
    return result


def _readonly_mapping(values: Mapping[str, Any]) -> Mapping[str, Any]:
    return MappingProxyType(dict(values))


def _positive_or_zero_integer(value: Any, label: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise TeleoperationProtocolError(f"{label} must be a non-negative integer.")
    return value


def _finite_number(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float, np.integer, np.floating)):
        raise TeleoperationCommandError("TARGET_INVALID", f"{label} must be numeric.")
    number = float(value)
    if not math.isfinite(number):
        raise TeleoperationCommandError("TARGET_NON_FINITE", f"{label} must be finite.")
    return number


def _finite_range(value: Any, label: str) -> tuple[float, float]:
    try:
        raw_values = np.asarray(value)
    except (TypeError, ValueError) as error:
        raise TeleoperationProtocolError(f"{label} must be a pair of finite numbers.") from error
    if raw_values.dtype.kind not in {"i", "u", "f"}:
        raise TeleoperationProtocolError(f"{label} must be a pair of finite numbers.")
    values = raw_values.astype(np.float64, copy=False)
    if values.shape != (2,):
        raise TeleoperationProtocolError(f"{label} must be a pair of finite numbers.")
    lower, upper = float(values[0]), float(values[1])
    if not math.isfinite(lower) or not math.isfinite(upper) or lower > upper:
        raise TeleoperationProtocolError(f"{label} must be an ordered pair of finite numbers.")
    return lower, upper


def _require_string(value: Any, label: str, error_type: type[Exception] = TeleoperationProtocolError) -> str:
    if not isinstance(value, str) or not value.strip():
        raise error_type(f"{label} must be a non-empty string.")
    return value


def _model_name(mujoco: Any, model: Any, kind: str, index: int) -> str | None:
    object_type = getattr(getattr(mujoco, "mjtObj", object()), f"mjOBJ_{kind.upper()}", None)
    if object_type is not None:
        try:
            name = mujoco.mj_id2name(model, object_type, index)
            if isinstance(name, str) and name:
                return name
        except Exception:
            pass
    accessor = getattr(model, kind, None)
    if callable(accessor):
        try:
            name = getattr(accessor(index), "name", None)
            if isinstance(name, str) and name:
                return name
        except Exception:
            pass
    address_attribute = getattr(
        model,
        {
            "joint": "name_jntadr",
            "actuator": "name_actuatoradr",
        }.get(kind, f"name_{kind}adr"),
        None,
    )
    names = getattr(model, "names", None)
    if address_attribute is not None and names is not None:
        try:
            address = int(np.asarray(address_attribute).reshape(-1)[index])
            raw_names = (
                names
                if isinstance(names, (bytes, bytearray))
                else np.asarray(names, dtype=np.uint8).tobytes()
            )
            end = raw_names.find(b"\0", address)
            value = raw_names[address:] if end < 0 else raw_names[address:end]
            decoded = value.decode("utf-8")
            return decoded or None
        except Exception:
            pass
    return None


def _scalar_array_value(model: Any, attribute: str, index: int) -> int:
    values = getattr(model, attribute, None)
    if values is None:
        raise TeleoperationProtocolError(f"The local MuJoCo model is missing '{attribute}'.")
    try:
        return int(np.asarray(values).reshape(-1)[index])
    except (IndexError, TypeError, ValueError) as error:
        raise TeleoperationProtocolError(f"The local MuJoCo model has invalid '{attribute}'.") from error


def _actuator_joint_index(model: Any, actuator_index: int) -> int:
    values = getattr(model, "actuator_trnid", None)
    if values is None:
        raise TeleoperationProtocolError("The local MuJoCo model is missing 'actuator_trnid'.")
    try:
        array = np.asarray(values)
        return int(array[actuator_index, 0])
    except (IndexError, TypeError, ValueError) as error:
        raise TeleoperationProtocolError("The local MuJoCo model has invalid 'actuator_trnid'.") from error


def _enum_value(mujoco: Any, group: str, name: str, fallback: int) -> int:
    return int(getattr(getattr(mujoco, group, object()), name, fallback))


def _joint_type_name(mujoco: Any, joint_type: int) -> str:
    values = {
        _enum_value(mujoco, "mjtJoint", "mjJNT_FREE", 0): "free",
        _enum_value(mujoco, "mjtJoint", "mjJNT_BALL", 1): "ball",
        _enum_value(mujoco, "mjtJoint", "mjJNT_SLIDE", 2): "slide",
        _enum_value(mujoco, "mjtJoint", "mjJNT_HINGE", 3): "hinge",
    }
    return values.get(joint_type, "unknown")


def _joint_widths(joint_type: str) -> tuple[int, int]:
    return {
        "free": (7, 6),
        "ball": (4, 3),
        "slide": (1, 1),
        "hinge": (1, 1),
    }.get(joint_type, (1, 1))


def _model_control_range(model: Any, actuator_index: int) -> tuple[float, float] | None:
    limited = getattr(model, "actuator_ctrllimited", None)
    if limited is None or not bool(np.asarray(limited).reshape(-1)[actuator_index]):
        return None
    ranges = getattr(model, "actuator_ctrlrange", None)
    if ranges is None:
        raise TeleoperationProtocolError("The local MuJoCo model is missing actuator control ranges.")
    try:
        value = np.asarray(ranges[actuator_index], dtype=np.float64).reshape(-1)
    except (IndexError, TypeError, ValueError) as error:
        raise TeleoperationProtocolError("The local MuJoCo model has invalid actuator control ranges.") from error
    if value.shape != (2,) or not np.all(np.isfinite(value)) or value[0] > value[1]:
        raise TeleoperationProtocolError(f"Actuator {actuator_index} has an invalid control range.")
    return float(value[0]), float(value[1])


def _actuator_parameter(model: Any, attribute: str, index: int) -> np.ndarray:
    values = getattr(model, attribute, None)
    if values is not None:
        try:
            return np.asarray(values[index], dtype=np.float64).reshape(-1)
        except (IndexError, TypeError, ValueError) as error:
            raise TeleoperationProtocolError(f"The local MuJoCo model has invalid '{attribute}'.") from error
    raise TeleoperationProtocolError(f"The local MuJoCo model is missing '{attribute}'.")


def _is_position_actuator(mujoco: Any, model: Any, actuator_index: int) -> bool:
    try:
        gain_type = _scalar_array_value(model, "actuator_gaintype", actuator_index)
        bias_type = _scalar_array_value(model, "actuator_biastype", actuator_index)
        fixed_gain = _enum_value(mujoco, "mjtGain", "mjGAIN_FIXED", 0)
        affine_bias = _enum_value(mujoco, "mjtBias", "mjBIAS_AFFINE", 1)
        if gain_type != fixed_gain or bias_type != affine_bias:
            return False
        gain = _actuator_parameter(model, "actuator_gainprm", actuator_index)
        bias = _actuator_parameter(model, "actuator_biasprm", actuator_index)
        return bool(
            len(gain) >= 1
            and len(bias) >= 2
            and np.isfinite(gain[0])
            and np.isfinite(bias[1])
            and np.isclose(bias[1], -gain[0])
        )
    except TeleoperationProtocolError:
        return False


def _build_metadata(mujoco: Any, model: Any, profile: Mapping[str, Any]) -> _Metadata:
    action_fields = profile.get("action")
    if not isinstance(action_fields, list) or not action_fields:
        raise TeleoperationProtocolError("The teleoperation profile does not declare any action fields.")

    joint_count = int(getattr(model, "njnt", 0))
    actuator_count = int(getattr(model, "nu", 0))
    joint_names: list[str | None] = []
    joint_types: list[str] = []
    joint_ranges: list[tuple[float, float] | None] = []
    joint_qpos_slices: list[slice] = []
    joint_qvel_slices: list[slice] = []
    for index in range(joint_count):
        name = _model_name(mujoco, model, "joint", index)
        joint_type = _joint_type_name(mujoco, _scalar_array_value(model, "jnt_type", index))
        qpos_address = _scalar_array_value(model, "jnt_qposadr", index)
        qvel_address = _scalar_array_value(model, "jnt_dofadr", index)
        qpos_width, qvel_width = _joint_widths(joint_type)
        limited_values = getattr(model, "jnt_limited", None)
        limited = limited_values is not None and bool(np.asarray(limited_values).reshape(-1)[index])
        joint_range: tuple[float, float] | None = None
        if limited:
            ranges = getattr(model, "jnt_range", None)
            if ranges is None:
                raise TeleoperationProtocolError("The local MuJoCo model is missing joint ranges.")
            joint_range = _finite_range(ranges[index], f"Joint range for '{name}'")
        joint_names.append(name)
        joint_types.append(joint_type)
        joint_ranges.append(joint_range)
        joint_qpos_slices.append(slice(qpos_address, qpos_address + qpos_width))
        joint_qvel_slices.append(slice(qvel_address, qvel_address + qvel_width))

    actuator_names = [_model_name(mujoco, model, "actuator", index) for index in range(actuator_count)]
    actuator_index_by_name = {
        name: index for index, name in enumerate(actuator_names) if name is not None
    }
    transmission_type = _enum_value(mujoco, "mjtTrn", "mjTRN_JOINT", 0)

    bindings: list[_ActionBinding] = []
    action_names: list[str] = []
    action_name_set: set[str] = set()
    actuator_binding_indices: dict[int, int] = {}
    for index, raw_field in enumerate(action_fields):
        if not isinstance(raw_field, Mapping):
            raise TeleoperationProtocolError(f"Action field {index} must be an object.")
        action_name = _require_string(raw_field.get("name"), f"Action field {index}")
        actuator_name = _require_string(raw_field.get("actuator"), f"Action field '{action_name}'")
        if action_name in action_name_set:
            raise TeleoperationProtocolError(f"Action name '{action_name}' is duplicated.")
        actuator_index = actuator_index_by_name.get(actuator_name)
        if actuator_index is None:
            raise TeleoperationProtocolError(
                f"Action '{action_name}' refers to unknown actuator '{actuator_name}'."
            )
        if actuator_index in actuator_binding_indices:
            other = bindings[actuator_binding_indices[actuator_index]].action_name
            raise TeleoperationProtocolError(
                f"Actuator '{actuator_name}' is addressed by both '{other}' and '{action_name}'."
            )

        native_range = _model_control_range(model, actuator_index)
        configured_range = raw_field.get("controlRange")
        effective_range = native_range
        if configured_range is not None:
            effective_range = _finite_range(configured_range, f"Control range for '{action_name}'")
            if native_range is not None and (
                effective_range[0] < native_range[0] or effective_range[1] > native_range[1]
            ):
                raise TeleoperationProtocolError(
                    f"Control range for '{action_name}' exceeds the native actuator range."
                )

        joint_name: str | None = None
        joint_index: int | None = None
        if _scalar_array_value(model, "actuator_trntype", actuator_index) == transmission_type:
            candidate_index = _actuator_joint_index(model, actuator_index)
            if 0 <= candidate_index < joint_count:
                joint_index = candidate_index
                joint_name = joint_names[candidate_index]
        position_actuator = (
            joint_index is not None
            and joint_types[joint_index] in {"hinge", "slide"}
            and _is_position_actuator(mujoco, model, actuator_index)
        )
        action_name_set.add(action_name)
        action_names.append(action_name)
        actuator_binding_indices[actuator_index] = len(bindings)
        bindings.append(
            _ActionBinding(
                action_name=action_name,
                actuator_name=actuator_name,
                actuator_index=actuator_index,
                joint_name=joint_name,
                joint_index=joint_index,
                control_range=effective_range,
                position_actuator=position_actuator,
            )
        )

    named_joint_names = [name for name in joint_names if name is not None]
    actuator_names_by_joint: dict[str, list[str]] = {name: [] for name in named_joint_names}
    position_bindings_by_joint: dict[str, list[_ActionBinding]] = {
        name: [] for name in named_joint_names
    }
    for actuator_index, actuator_name in enumerate(actuator_names):
        if actuator_name is None or _scalar_array_value(model, "actuator_trntype", actuator_index) != transmission_type:
            continue
        joint_index = _actuator_joint_index(model, actuator_index)
        if 0 <= joint_index < joint_count and joint_names[joint_index] is not None:
            actuator_names_by_joint[joint_names[joint_index]].append(actuator_name)
    for binding in bindings:
        if binding.joint_name is not None:
            if binding.position_actuator:
                position_bindings_by_joint[binding.joint_name].append(binding)

    joints: dict[str, JointInfo] = {}
    joint_candidates: dict[str, tuple[_ActionBinding, ...]] = {}
    for index, name in enumerate(joint_names):
        if name is None:
            continue
        candidates = tuple(position_bindings_by_joint[name])
        joint_candidates[name] = candidates
        joints[name] = JointInfo(
            name=name,
            joint_type=joint_types[index],
            qpos_slice=joint_qpos_slices[index],
            qvel_slice=joint_qvel_slices[index],
            range=joint_ranges[index],
            actuator_names=tuple(actuator_names_by_joint[name]),
            controllable=joint_types[index] in {"hinge", "slide"} and len(candidates) == 1,
            position_control_range=candidates[0].control_range if len(candidates) == 1 else None,
        )

    binding_by_actuator = {binding.actuator_index: binding for binding in bindings}
    actuators: dict[str, ActuatorInfo] = {}
    for index, name in enumerate(actuator_names):
        if name is None:
            continue
        binding = binding_by_actuator.get(index)
        actuators[name] = ActuatorInfo(
            name=name,
            action_name=None if binding is None else binding.action_name,
            joint_name=None if binding is None else binding.joint_name,
            control_range=None if binding is None else binding.control_range,
            controllable=binding is not None,
        )

    return _Metadata(
        joints=MappingProxyType(joints),
        actuators=MappingProxyType(actuators),
        action_names=tuple(action_names),
        bindings=tuple(bindings),
        joint_candidates=MappingProxyType(joint_candidates),
    )


def _decode_float_attachment(
    descriptor: Mapping[str, Any],
    payload: bytes,
    *,
    label: str,
) -> np.ndarray:
    if descriptor.get("dtype") != "float64" or descriptor.get("encoding") != "raw-le":
        raise TeleoperationProtocolError(f"Native {label} attachment has an unsupported encoding.")
    shape = descriptor.get("shape")
    if (
        not isinstance(shape, list)
        or not shape
        or any(not isinstance(size, int) or isinstance(size, bool) or size < 0 for size in shape)
    ):
        raise TeleoperationProtocolError(f"Native {label} attachment has an invalid shape.")
    expected_bytes = int(np.prod(shape, dtype=np.int64)) * np.dtype("<f8").itemsize
    if expected_bytes > MAX_STREAM_BYTES or descriptor.get("byteLength") != expected_bytes:
        raise TeleoperationProtocolError(f"Native {label} attachment has an invalid byte length.")
    if len(payload) != expected_bytes:
        raise TeleoperationProtocolError(f"Native {label} attachment length does not match its shape.")
    return _readonly_array(np.frombuffer(payload, dtype="<f8").reshape(tuple(shape)), label)


def _decode_camera_attachment(
    descriptor: Mapping[str, Any],
    payload: bytes,
    *,
    decode_images: bool = True,
) -> tuple[CompressedImage, np.ndarray | None]:
    if descriptor.get("dtype") != "uint8" or descriptor.get("encoding") != "jpeg":
        raise TeleoperationProtocolError("Native camera attachment has an unsupported encoding.")
    shape = descriptor.get("shape")
    if (
        not isinstance(shape, list)
        or len(shape) != 3
        or any(not isinstance(size, int) or isinstance(size, bool) or size < 1 for size in shape)
        or shape[2] != 3
    ):
        raise TeleoperationProtocolError("Native camera attachment has an invalid shape.")
    byte_length = descriptor.get("byteLength")
    if not isinstance(byte_length, int) or isinstance(byte_length, bool) or byte_length != len(payload):
        raise TeleoperationProtocolError("Native camera attachment length does not match its descriptor.")
    if byte_length > MAX_STREAM_BYTES or math.prod(shape) > MAX_STREAM_BYTES:
        raise TeleoperationProtocolError("Native camera attachment exceeds the configured size limit.")
    try:
        from PIL import Image

        with Image.open(io.BytesIO(payload)) as image:
            if image.format != "JPEG" or image.size != (shape[1], shape[0]):
                raise TeleoperationProtocolError("Native JPEG format or dimensions do not match its descriptor.")
            values = np.asarray(image.convert("RGB"), dtype=np.uint8).copy() if decode_images else None
    except ModuleNotFoundError as error:
        raise TeleoperationProtocolError(
            "Camera snapshots require Pillow. Install the 'teleoperation' Python extra."
        ) from error
    except TeleoperationProtocolError:
        raise
    except Exception as error:  # noqa: BLE001 - malformed JPEG is a protocol error.
        raise TeleoperationProtocolError("Native camera attachment is not a valid JPEG.") from error
    if values is not None and tuple(values.shape) != tuple(shape):
        raise TeleoperationProtocolError("Native camera attachment shape does not match its descriptor.")
    if values is not None:
        values.setflags(write=False)
    return CompressedImage(bytes(payload), shape[1], shape[0]), values


def _decode_header_vector(header: Mapping[str, Any], name: str) -> np.ndarray | None:
    if name not in header or header[name] is None:
        return None
    return _readonly_array(header[name], f"Native {name}", dimensions=1)


def decode_state_message(
    parts: Sequence[bytes], session_id: str, *, decode_images: bool = True,
) -> StateSnapshot:
    """Decode one native PUB message; optionally retain JPEGs without decoding pixels."""
    if not isinstance(decode_images, bool):
        raise ValueError("decode_images must be a bool.")
    if len(parts) < 2:
        raise TeleoperationProtocolError("Native state PUB message is incomplete.")
    try:
        topic = parts[0].decode("utf-8")
        header_value = json.loads(parts[1].decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise TeleoperationProtocolError("Native state topic or header is not valid UTF-8 JSON.") from error
    expected_topic = f"teleop.state.v1.{session_id}"
    if topic != expected_topic:
        raise TeleoperationProtocolError(f"Unexpected native state topic '{topic}'.")
    if not isinstance(header_value, Mapping) or header_value.get("messageType") != "state":
        raise TeleoperationProtocolError("Native state header is invalid.")
    header = header_value
    if header.get("protocolVersion") != PROTOCOL_VERSION or header.get("sessionId") != session_id:
        raise TeleoperationProtocolError("Native state protocol or session does not match the connection.")
    sequence = _positive_or_zero_integer(header.get("sequence"), "sequence")
    step_id = _positive_or_zero_integer(header.get("stepId"), "stepId")
    state_revision = _positive_or_zero_integer(header.get("stateRevision"), "stateRevision")
    state_id = _require_string(header.get("stateId"), "stateId")
    simulation_time = header.get("simulationTime")
    if isinstance(simulation_time, bool) or not isinstance(simulation_time, (int, float)):
        raise TeleoperationProtocolError("simulationTime must be numeric.")
    simulation_time = float(simulation_time)
    if not math.isfinite(simulation_time):
        raise TeleoperationProtocolError("simulationTime must be finite.")

    raw_descriptors = header.get("attachments")
    if not isinstance(raw_descriptors, list) or len(raw_descriptors) != len(parts) - 2:
        raise TeleoperationProtocolError("Native state attachment count does not match its header.")
    decoded: dict[str, np.ndarray] = {}
    cameras: dict[str, np.ndarray] = {}
    compressed: dict[str, CompressedImage] = {}
    for descriptor_value, payload in zip(raw_descriptors, parts[2:], strict=True):
        if not isinstance(descriptor_value, Mapping):
            raise TeleoperationProtocolError("Native state attachment descriptor is invalid.")
        name = _require_string(descriptor_value.get("name"), "Native attachment name")
        if name in decoded or name in compressed:
            raise TeleoperationProtocolError(f"Native attachment '{name}' is duplicated.")
        kind = descriptor_value.get("kind")
        if kind == "camera":
            compressed[name], pixels = _decode_camera_attachment(
                descriptor_value, payload, decode_images=decode_images,
            )
            if pixels is not None:
                cameras[name] = pixels
        elif kind in {"qpos", "qvel", "ctrl", "state", "action", "act", "body-position", "body-quaternion"}:
            decoded[name] = _decode_float_attachment(descriptor_value, payload, label=name)
        else:
            raise TeleoperationProtocolError(f"Native attachment kind '{kind}' is unsupported.")

    for name in ("qpos", "qvel", "ctrl"):
        if name not in decoded:
            raise TeleoperationProtocolError(f"Native state is missing its {name} attachment.")
        if decoded[name].ndim != 1:
            raise TeleoperationProtocolError(f"Native {name} attachment must be one-dimensional.")

    state = _decode_header_vector(header, "state")
    action = _decode_header_vector(header, "action")
    if state is None and "state" in decoded:
        state = decoded["state"]
    elif state is not None and "state" in decoded:
        raise TeleoperationProtocolError("Native state contains duplicate state vectors.")
    if action is None:
        action = decoded.get("action", decoded.get("act"))
    elif "action" in decoded or "act" in decoded:
        raise TeleoperationProtocolError("Native state contains duplicate action vectors.")

    body_positions: dict[str, np.ndarray] = {}
    body_quaternions: dict[str, np.ndarray] = {}
    body_names = header.get("bodyNames", [])
    if not isinstance(body_names, list) or any(not isinstance(name, str) or not name for name in body_names):
        raise TeleoperationProtocolError("Native bodyNames must be an array of names.")
    if len(set(body_names)) != len(body_names):
        raise TeleoperationProtocolError("Native bodyNames contains duplicates.")
    body_position = decoded.get("body-position")
    if body_position is not None:
        if body_position.shape != (len(body_names), 3):
            raise TeleoperationProtocolError("Native body-position attachment shape is invalid.")
        body_positions = {
            name: _readonly_array(body_position[index], f"Body position '{name}'", dimensions=1)
            for index, name in enumerate(body_names)
        }
    body_quaternion = decoded.get("body-quaternion")
    if body_quaternion is not None:
        if body_quaternion.shape != (len(body_names), 4):
            raise TeleoperationProtocolError("Native body-quaternion attachment shape is invalid.")
        body_quaternions = {
            name: _readonly_array(body_quaternion[index], f"Body quaternion '{name}'", dimensions=1)
            for index, name in enumerate(body_names)
        }

    dimensions = header.get("dimensions")
    if dimensions is not None:
        if not isinstance(dimensions, Mapping):
            raise TeleoperationProtocolError("Native state dimensions must be an object.")
        expected_dimensions = {
            "nq": decoded["qpos"].size,
            "nv": decoded["qvel"].size,
            "nu": decoded["ctrl"].size,
            "nbody": len(body_names),
        }
        for name, expected in expected_dimensions.items():
            value = dimensions.get(name)
            if not isinstance(value, int) or isinstance(value, bool) or value != expected:
                raise TeleoperationProtocolError(f"Native state dimension '{name}' is inconsistent.")

    recording_value = header.get("recording", "idle")
    if isinstance(recording_value, bool):
        recording = "recording" if recording_value else "idle"
    elif isinstance(recording_value, str) and recording_value in {"idle", "recording", "stopping"}:
        recording = recording_value
    else:
        raise TeleoperationProtocolError("Native recording status is invalid.")
    episode_id = header.get("episodeId")
    if episode_id is not None and (not isinstance(episode_id, str) or not episode_id):
        raise TeleoperationProtocolError("Native episodeId is invalid.")

    return StateSnapshot(
        sequence=sequence,
        step_id=step_id,
        state_revision=state_revision,
        state_id=state_id,
        simulation_time=simulation_time,
        qpos=decoded["qpos"],
        qvel=decoded["qvel"],
        ctrl=decoded["ctrl"],
        body_positions=MappingProxyType(body_positions),
        body_quaternions=MappingProxyType(body_quaternions),
        state=state,
        action=action,
        recording=recording,
        images=MappingProxyType(cameras),
        compressed_images=MappingProxyType(compressed),
        episode_id=episode_id,
    )


def _normalise_base_url(value: Any) -> str:
    if not isinstance(value, str):
        raise TeleoperationDiscoveryError("The teleoperation base URL must be a string.")
    parsed = urllib.parse.urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise TeleoperationDiscoveryError("The teleoperation base URL must be an HTTP(S) URL.")
    return value.rstrip("/")


def _json_error_message(payload: bytes) -> str | None:
    try:
        value = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    if isinstance(value, Mapping) and isinstance(value.get("error"), str):
        return value["error"]
    return None


def _http_json(url: str, timeout_s: float) -> Mapping[str, Any]:
    request = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with open_http(request, timeout_s) as response:
            payload = response.read(MAX_JSON_BYTES + 1)
    except urllib.error.HTTPError as error:
        try:
            detail = _json_error_message(error.read(MAX_JSON_BYTES))
        except OSError:
            detail = None
        message = detail or f"HTTP {error.code} while requesting {url}."
        if error.code == 404:
            raise TeleoperationDiscoveryError(
                f"No active teleoperation session was found at {url}."
            ) from error
        raise TeleoperationDiscoveryError(message) from error
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        raise TeleoperationConnectionError(f"Could not reach teleoperation app at {url}.") from error
    if len(payload) > MAX_JSON_BYTES:
        raise TeleoperationDiscoveryError(f"The response from {url} is too large.")
    try:
        value = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise TeleoperationDiscoveryError(f"The response from {url} was not valid JSON.") from error
    if not isinstance(value, Mapping):
        raise TeleoperationDiscoveryError(f"The response from {url} must be a JSON object.")
    if isinstance(value.get("error"), str):
        raise TeleoperationDiscoveryError(value["error"])
    return value


def _download_scene_bundle(url: str, destination: Path, timeout_s: float) -> None:
    request = urllib.request.Request(url, headers={"Accept": "application/octet-stream"})
    try:
        with open_http(request, timeout_s) as response:
            total = 0
            with destination.open("wb") as output:
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > MAX_SCENE_BUNDLE_BYTES:
                        raise TeleoperationConnectionError(
                            "The downloaded teleoperation scene bundle exceeds the size limit."
                        )
                    output.write(chunk)
    except urllib.error.HTTPError as error:
        raise TeleoperationConnectionError(
            f"Could not download the teleoperation scene bundle (HTTP {error.code})."
        ) from error
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        raise TeleoperationConnectionError("Could not download the teleoperation scene bundle.") from error


def _read_connection_file(path: Path) -> Mapping[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise TeleoperationDiscoveryError(f"Could not read connection configuration '{path}'.") from error
    if not isinstance(value, Mapping):
        raise TeleoperationDiscoveryError(f"Connection configuration '{path}' must contain an object.")
    return value


def _endpoint_values(value: Mapping[str, Any]) -> tuple[str, str]:
    raw_endpoints = value.get("endpoints")
    endpoints = raw_endpoints if isinstance(raw_endpoints, Mapping) else {}
    control = endpoints.get("control")
    publisher = endpoints.get("publisher")
    if not isinstance(control, str) or not control:
        raise TeleoperationDiscoveryError("Teleoperation connection is missing endpoints.control.")
    if not isinstance(publisher, str) or not publisher:
        raise TeleoperationDiscoveryError("Teleoperation connection is missing endpoints.publisher.")
    return control, publisher


def _connection_identity(value: Mapping[str, Any]) -> str | None:
    session_id = value.get("sessionId")
    return session_id if isinstance(session_id, str) and session_id else None


def _scene_value(value: Mapping[str, Any]) -> Any:
    return value.get("sceneBundle")


def _resolve_connection(
    source: str | Path | Mapping[str, Any],
    *,
    scene_bundle: str | Path | bytes | bytearray | None,
    timeout_s: float,
) -> _ResolvedConnection:
    temporary_directories: list[tempfile.TemporaryDirectory[str]] = []
    base_url: str | None = None
    source_path: Path | None = None
    if isinstance(source, Mapping):
        value: Mapping[str, Any] = source
    elif isinstance(source, Path) or (
        isinstance(source, str) and urllib.parse.urlparse(source).scheme not in {"http", "https"}
    ):
        source_path = Path(source).expanduser()
        value = _read_connection_file(source_path)
    elif isinstance(source, str):
        base_url = _normalise_base_url(source)
        try:
            value = _http_json(f"{base_url}/api/teleoperation/sessions", timeout_s)
        except TeleoperationDiscoveryError:
            raise
    else:
        raise TeleoperationDiscoveryError(
            "Connect expects an HTTP(S) URL, a connection.json path, or a connection mapping."
        )

    if base_url is None:
        configured_base = value.get("baseUrl")
        if configured_base is not None:
            base_url = _normalise_base_url(configured_base)

    status = value.get("status")
    if base_url is not None and status is not None and status not in {"starting", "ready", "active"}:
        raise TeleoperationDiscoveryError(
            f"The discovered teleoperation session is not active (status={status!r})."
        )

    session_id = _connection_identity(value)
    control_endpoint, publisher_endpoint = _endpoint_values(value)
    relay = value.get("relay")
    if base_url is not None and isinstance(relay, Mapping):
        control, publisher = relay.get("control"), relay.get("publisher")
        if not isinstance(control, str) or not isinstance(publisher, str):
            raise TeleoperationDiscoveryError("The HTTP relay requires control and publisher URLs.")
        control_endpoint = urllib.parse.urljoin(f"{base_url}/", control)
        publisher_endpoint = urllib.parse.urljoin(f"{base_url}/", publisher)

    configured_scene = scene_bundle if scene_bundle is not None else _scene_value(value)
    scene_path: Path | None = None
    if configured_scene is not None:
        if isinstance(configured_scene, (bytes, bytearray)):
            temporary = tempfile.TemporaryDirectory(prefix="robotic-studio-teleoperation-scene-")
            temporary_directories.append(temporary)
            scene_path = Path(temporary.name) / "scene.mujoco-scene"
            try:
                scene_path.write_bytes(bytes(configured_scene))
            except Exception:
                temporary.cleanup()
                temporary_directories.remove(temporary)
                raise
        elif isinstance(configured_scene, (str, Path)):
            scene_path = Path(configured_scene).expanduser()
            if scene_bundle is None and source_path is not None and not scene_path.is_absolute():
                scene_path = source_path.parent / scene_path
        else:
            raise TeleoperationDiscoveryError("scene_bundle must be a path or bundle bytes.")

    if scene_path is None and source_path is not None:
        sibling = source_path.parent / "scene.mujoco-scene"
        if sibling.is_file():
            scene_path = sibling

    if scene_path is None and base_url is not None:
        if session_id is None:
            raise TeleoperationDiscoveryError(
                "The app discovery response is missing sessionId for the scene download."
            )
        temporary = tempfile.TemporaryDirectory(prefix="robotic-studio-teleoperation-scene-")
        temporary_directories.append(temporary)
        scene_path = Path(temporary.name) / "scene.mujoco-scene"
        scene_url = (
            f"{base_url}/api/teleoperation/sessions/"
            f"{urllib.parse.quote(session_id, safe='')}/scene"
        )
        try:
            _download_scene_bundle(scene_url, scene_path, timeout_s)
        except Exception:
            temporary.cleanup()
            temporary_directories.remove(temporary)
            raise

    if scene_path is None:
        raise TeleoperationConnectionError(
            "A scene_bundle override is required when connecting from a connection mapping or JSON file."
        )
    if not scene_path.is_file():
        raise TeleoperationConnectionError(f"Teleoperation scene bundle '{scene_path}' does not exist.")
    return _ResolvedConnection(
        control_endpoint=control_endpoint,
        publisher_endpoint=publisher_endpoint,
        base_url=base_url,
        scene_path=scene_path,
        discovery=dict(value),
        temporary_directories=tuple(temporary_directories),
    )


class _RecordingContext:
    def __init__(self, client: Teleoperation) -> None:
        self.client = client
        self.started = False

    def __enter__(self) -> Teleoperation:
        self.client.start_recording()
        self.started = True
        return self.client

    def __exit__(
        self,
        exception_type: type[BaseException] | None,
        _exception: BaseException | None,
        _traceback: Any,
    ) -> bool:
        if not self.started or self.client.command_outcome_unknown:
            return False
        if exception_type is None:
            self.client.stop_recording(save=True)
        else:
            self.client.discard_recording()
        return False


class Teleoperation:
    """Synchronous public client for one native Physical AI Scene Builder session."""

    def __init__(
        self,
        *,
        resolved: _ResolvedConnection,
        local: LocalScene,
        bundle: SceneBundle,
        mujoco_module: Any,
        timeout_s: float,
        client_id: str | None,
        include_images: bool = False,
        decode_images: bool = True,
        auto_heartbeat: bool = True,
    ) -> None:
        if timeout_s <= 0 or not math.isfinite(timeout_s):
            raise ValueError("timeout_s must be a positive finite number.")
        self._include_images = bool(include_images)
        if not isinstance(decode_images, bool):
            raise ValueError("decode_images must be a bool.")
        self._decode_images = decode_images
        self._auto_heartbeat = auto_heartbeat
        self._resolved = resolved
        self._bundle = bundle
        self.local = local
        self._mujoco = mujoco_module
        self.timeout_s = float(timeout_s)
        self._client_id = client_id or f"teleoperation-client-{uuid.uuid4()}"
        if not self._client_id:
            raise ValueError("client_id must be non-empty.")
        self._session_id: str | None = None
        self._context: Any = None
        self._dealer: Any = None
        self._stream: Any = None
        self._zmq: Any = None
        self._request_id = 0
        self._command_lock = threading.RLock()
        self._lease_id: str | None = None
        self._recording_attempt: RecordingAttempt | None = None
        self._heartbeat_stop = threading.Event()
        self._heartbeat_thread: threading.Thread | None = None
        self._response_timed_out = False
        self._closed = False
        self._last_sequence = -1
        self._current_state: StateSnapshot | None = None
        self._profile: Mapping[str, Any] = MappingProxyType({})
        self._description: Mapping[str, Any] = MappingProxyType({})
        self._metadata: _Metadata | None = None
        self._initial_states: tuple[InitialStateInfo, ...] = ()
        self._image_snapshots: deque[StateSnapshot] = deque(maxlen=2)
        self._dropped_image_snapshots = 0

    @classmethod
    def connect(
        cls,
        base_url_or_connection: str | Path | Mapping[str, Any],
        *,
        scene_bundle: str | Path | bytes | bytearray | None = None,
        timeout_s: float = 5.0,
        client_id: str | None = None,
        include_images: bool = False,
        decode_images: bool = True,
        auto_heartbeat: bool = True,
    ) -> Teleoperation:
        """Discover, compile, lease, and connect to an active teleoperation session.

        With ``include_images`` the worker also publishes JPEG camera previews (throttled to the
        profile's ``streamHz``) in ``current_state.images``; ``step`` snapshots stay state-only.
        Use ``take_image_snapshots()`` to retain previews superseded by state-only messages.
        Original JPEGs are also available in ``compressed_images``. With
        ``decode_images=False``, only JPEG headers are checked and ``images`` stays
        empty; pixel decoding and full compressed-data validation are skipped.

        Set ``auto_heartbeat=False`` for single-threaded transport ownership and call
        ``heartbeat()`` at least every two seconds, including while physics is paused.
        """
        if timeout_s <= 0 or not math.isfinite(timeout_s):
            raise ValueError("timeout_s must be a positive finite number.")
        if not isinstance(decode_images, bool):
            raise ValueError("decode_images must be a bool.")
        resolved: _ResolvedConnection | None = None
        bundle: SceneBundle | None = None
        client: Teleoperation | None = None
        try:
            resolved = _resolve_connection(
                base_url_or_connection,
                scene_bundle=scene_bundle,
                timeout_s=timeout_s,
            )
            try:
                bundle = SceneBundleLoader().load(resolved.scene_path)
            except SceneBundleError as error:
                raise TeleoperationConnectionError(f"The teleoperation scene bundle is invalid: {error}") from error
            try:
                import mujoco
            except ModuleNotFoundError as error:
                raise TeleoperationConnectionError(
                    "Teleoperation requires MuJoCo. Install the 'teleoperation' Python extra."
                ) from error
            try:
                native_scene = NativeScene.compile(bundle)
            except Exception as error:  # noqa: BLE001 - optional-native errors need public context.
                raise TeleoperationConnectionError("The teleoperation scene could not be compiled with MuJoCo.") from error
            local = LocalScene(native_scene.model, native_scene.data, mujoco_module=mujoco)
            client = cls(
                resolved=resolved,
                local=local,
                bundle=bundle,
                mujoco_module=mujoco,
                timeout_s=timeout_s,
                client_id=client_id,
                include_images=include_images,
                decode_images=decode_images,
                auto_heartbeat=auto_heartbeat,
            )
            client._connect()
            return client
        except Exception:
            if client is not None:
                client.close()
            elif bundle is not None:
                bundle.close()
            if resolved is not None:
                for temporary in resolved.temporary_directories:
                    temporary.cleanup()
            raise

    def __enter__(self) -> Self:
        self._ensure_open()
        return self

    def __exit__(
        self,
        _exception_type: type[BaseException] | None,
        _exception: BaseException | None,
        _traceback: Any,
    ) -> None:
        self.close()

    @property
    def session_id(self) -> str:
        if self._session_id is None:
            raise TeleoperationConnectionError("The native session identity is not available before hello.")
        return self._session_id

    @property
    def joints(self) -> Mapping[str, JointInfo]:
        metadata = self._require_metadata()
        return metadata.joints

    @property
    def actuators(self) -> Mapping[str, ActuatorInfo]:
        metadata = self._require_metadata()
        return metadata.actuators

    @property
    def action_names(self) -> tuple[str, ...]:
        return self._require_metadata().action_names

    @property
    def initial_states(self) -> tuple[InitialStateInfo, ...]:
        return self._initial_states

    @property
    def current_state(self) -> StateSnapshot:
        if self._current_state is None:
            raise TeleoperationConnectionError("No authoritative teleoperation snapshot is available.")
        return self._current_state

    @property
    def profile(self) -> Mapping[str, Any]:
        return self._profile

    @property
    def description(self) -> Mapping[str, Any]:
        return self._description

    @property
    def lease_id(self) -> str | None:
        return self._lease_id

    @property
    def command_outcome_unknown(self) -> bool:
        return self._response_timed_out

    @property
    def recording(self) -> bool:
        return self._current_state is not None and self._current_state.recording == "recording"

    def _connect(self) -> None:
        self._open_transport()
        self._request("hello", supportedVersions=[PROTOCOL_VERSION])
        description = self._request("describe")
        stream_clients = description.get("streamClients")
        if (
            not isinstance(stream_clients, int)
            or isinstance(stream_clients, bool)
            or stream_clients < 1
        ):
            raise TeleoperationConnectionError(
                "The Physical AI Scene Builder viewport stream is not running. Click Start streaming in the "
                "Generate tab before connecting the teleoperation client."
            )
        profile = description.get("profile")
        if not isinstance(profile, Mapping):
            raise TeleoperationProtocolError("Teleoperation describe did not return a profile.")
        fingerprint = profile.get("sceneFingerprint")
        if not isinstance(fingerprint, str) or not fingerprint:
            raise TeleoperationProtocolError("Teleoperation profile has no scene fingerprint.")
        expected_fingerprint = self._resolved.discovery.get("sceneFingerprint")
        if isinstance(expected_fingerprint, str) and fingerprint != expected_fingerprint:
            raise TeleoperationConnectionError(
                "The active teleoperation session uses a different scene than this control archive. "
                "Download a fresh control archive for the active scene."
            )
        self._profile = MappingProxyType(dict(profile))
        self._description = MappingProxyType(dict(description))
        self._metadata = _build_metadata(self._mujoco, self.local.model, self._profile)
        self._initial_states = self._parse_initial_states(description)

        acquire = self._request(
            "acquire",
            sceneFingerprint=fingerprint,
            **({"includeImages": True} if self._include_images else {}),
        )
        lease_id = acquire.get("leaseId")
        if not isinstance(lease_id, str) or not lease_id:
            raise TeleoperationProtocolError("Teleoperation acquire did not return a lease ID.")
        self._lease_id = lease_id
        state_revision = acquire.get("stateRevision")
        if not isinstance(state_revision, int) or isinstance(state_revision, bool) or state_revision < 0:
            raise TeleoperationProtocolError("Teleoperation acquire returned an invalid state revision.")
        snapshot = self._wait_for_snapshot(
            minimum_sequence=self._last_sequence,
            expected_state_revision=state_revision,
        )
        self.local.synchronize(snapshot)
        if self._auto_heartbeat:
            self._start_heartbeat()

    def heartbeat(self) -> None:
        """Refresh the controller lease, surfacing transport and lease failures to the caller."""
        self._request("ping", leaseId=self._require_lease())

    def _start_heartbeat(self) -> None:
        if self._heartbeat_thread is not None:
            return
        self._heartbeat_stop.clear()
        self._heartbeat_thread = threading.Thread(
            target=self._heartbeat_loop,
            name="teleoperation-lease-heartbeat",
            daemon=True,
        )
        self._heartbeat_thread.start()

    def _heartbeat_loop(self) -> None:
        while not self._heartbeat_stop.wait(LEASE_HEARTBEAT_INTERVAL_SECONDS):
            lease_id = self._lease_id
            if lease_id is None or self._closed:
                return
            try:
                self._request("ping", leaseId=lease_id)
            except Exception:
                return

    def _parse_initial_states(self, description: Mapping[str, Any]) -> tuple[InitialStateInfo, ...]:
        collection = description.get("collection")
        collection_states = collection.get("states") if isinstance(collection, Mapping) else None
        discovery_states = self._resolved.discovery.get("states")
        described_states = description.get("states")
        raw_states_by_id: dict[str, Any] = {}
        for values in (discovery_states, described_states, collection_states):
            if not isinstance(values, list):
                continue
            for value in values:
                if isinstance(value, Mapping) and isinstance(value.get("stateId"), str):
                    raw_states_by_id[value["stateId"]] = value
        states: list[InitialStateInfo] = []
        seen: set[str] = set()
        for index, raw_state in enumerate(raw_states_by_id.values()):
            if not isinstance(raw_state, Mapping):
                raise TeleoperationProtocolError(f"Initial state {index} is not an object.")
            state_id = _require_string(raw_state.get("stateId"), f"Initial state {index}.stateId")
            if state_id in seen:
                raise TeleoperationProtocolError(f"Initial state '{state_id}' is duplicated.")
            seen.add(state_id)
            label = _require_string(raw_state.get("label"), f"Initial state '{state_id}'.label")
            state_index = raw_state.get("index")
            seed = raw_state.get("seed")
            if not isinstance(state_index, int) or isinstance(state_index, bool) or state_index < 0:
                raise TeleoperationProtocolError(f"Initial state '{state_id}' has an invalid index.")
            if not isinstance(seed, int) or isinstance(seed, bool):
                raise TeleoperationProtocolError(f"Initial state '{state_id}' has an invalid seed.")
            created_at = _require_string(raw_state.get("createdAt"), f"Initial state '{state_id}'.createdAt")
            randomization = raw_state.get("sourceRandomization", raw_state.get("randomization"))
            if randomization is not None and not isinstance(randomization, Mapping):
                raise TeleoperationProtocolError(f"Initial state '{state_id}' has invalid randomization metadata.")
            arrays: dict[str, np.ndarray | None] = {}
            for name in ("qpos", "qvel", "ctrl"):
                raw_array = raw_state.get(name)
                arrays[name] = None if raw_array is None else _readonly_array(raw_array, f"Initial state '{state_id}' {name}", dimensions=1)
            states.append(
                InitialStateInfo(
                    state_id=state_id,
                    label=label,
                    index=state_index,
                    seed=seed,
                    created_at=created_at,
                    randomization=None if randomization is None else _readonly_mapping(randomization),
                    qpos=arrays["qpos"],
                    qvel=arrays["qvel"],
                    ctrl=arrays["ctrl"],
                )
            )
        return tuple(states)

    def _open_transport(self) -> None:
        try:
            import zmq
        except ModuleNotFoundError as error:
            raise TeleoperationConnectionError(
                "Teleoperation requires pyzmq. Install the 'teleoperation' Python extra."
            ) from error
        self._zmq = zmq
        try:
            if urllib.parse.urlparse(self._resolved.control_endpoint).scheme in {"http", "https"}:
                self._dealer = HttpCommandSocket(self._resolved.control_endpoint, self.timeout_s)
                self._stream = HttpStateSocket(self._resolved.publisher_endpoint, self.timeout_s)
                return
            self._context = zmq.Context()
            self._dealer = self._context.socket(zmq.DEALER)
            self._dealer.setsockopt(zmq.IDENTITY, self._client_id.encode("utf-8"))
            self._dealer.setsockopt(zmq.LINGER, 0)
            self._dealer.setsockopt(zmq.RCVTIMEO, max(1, int(self.timeout_s * 1000)))
            self._dealer.setsockopt(zmq.SNDTIMEO, max(1, int(self.timeout_s * 1000)))
            self._dealer.connect(self._resolved.control_endpoint)

            self._stream = self._context.socket(zmq.SUB)
            self._stream.setsockopt(zmq.LINGER, 0)
            self._stream.setsockopt_string(zmq.SUBSCRIBE, "teleop.state.v1.")
            self._stream.connect(self._resolved.publisher_endpoint)
        except Exception as error:  # noqa: BLE001 - normalize transport setup failures.
            self._close_transport()
            raise TeleoperationConnectionError(
                f"Could not connect to native teleoperation endpoints "
                f"{self._resolved.control_endpoint} and {self._resolved.publisher_endpoint}."
            ) from error

    def _request(
        self,
        command: str,
        *,
        response_timeout_s: float | None = None,
        **fields: Any,
    ) -> Mapping[str, Any]:
        with self._command_lock:
            return self._request_locked(command, response_timeout_s=response_timeout_s, **fields)

    def _request_locked(
        self,
        command: str,
        *,
        response_timeout_s: float | None = None,
        **fields: Any,
    ) -> Mapping[str, Any]:
        self._ensure_open()
        if self._dealer is None or self._zmq is None:
            raise TeleoperationConnectionError("The teleoperation command channel is not connected.")
        if response_timeout_s is not None and (
            response_timeout_s <= 0 or not math.isfinite(response_timeout_s)
        ):
            raise ValueError("response_timeout_s must be a positive finite number.")
        timeout_overridden = response_timeout_s is not None
        if timeout_overridden:
            timeout_ms = max(1, int(response_timeout_s * 1000))
            self._dealer.setsockopt(self._zmq.RCVTIMEO, timeout_ms)
            self._dealer.setsockopt(self._zmq.SNDTIMEO, timeout_ms)
        self._request_id += 1
        envelope = {
            "protocolVersion": PROTOCOL_VERSION,
            "clientId": self._client_id,
            "requestId": self._request_id,
            "command": command,
            **fields,
        }
        try:
            self._dealer.send_json(envelope)
            raw_response = self._dealer.recv()
        except self._zmq.Again as error:
            self._response_timed_out = True
            raise TeleoperationCommandOutcomeUnknown(
                command,
                self._resolved.control_endpoint,
                self._session_id or "unknown",
            ) from error
        except Exception as error:  # noqa: BLE001 - normalize ZMQ failures.
            raise TeleoperationConnectionError(
                f"The teleoperation command channel failed while sending '{command}'."
            ) from error
        finally:
            if timeout_overridden:
                timeout_ms = max(1, int(self.timeout_s * 1000))
                self._dealer.setsockopt(self._zmq.RCVTIMEO, timeout_ms)
                self._dealer.setsockopt(self._zmq.SNDTIMEO, timeout_ms)
        if isinstance(raw_response, str):
            raw_bytes = raw_response.encode("utf-8")
        elif isinstance(raw_response, bytes):
            raw_bytes = raw_response
        else:
            raise TeleoperationProtocolError("Teleoperation returned a non-binary response.")
        try:
            response_value = json.loads(raw_bytes.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise TeleoperationProtocolError("Teleoperation returned invalid JSON.") from error
        if not isinstance(response_value, Mapping):
            raise TeleoperationProtocolError("Teleoperation response must be a JSON object.")
        if response_value.get("protocolVersion") != PROTOCOL_VERSION:
            raise TeleoperationProtocolError("Teleoperation selected an unsupported protocol version.")
        response_session_id = response_value.get("sessionId")
        if not isinstance(response_session_id, str) or not response_session_id:
            raise TeleoperationProtocolError("Teleoperation response has no session identity.")
        if self._session_id is None:
            if command != "hello":
                raise TeleoperationProtocolError("The native session identity was not established by hello.")
            self._session_id = response_session_id
        elif response_session_id != self._session_id:
            raise TeleoperationProtocolError("Teleoperation response session changed during the connection.")
        if response_value.get("clientId") != self._client_id:
            raise TeleoperationProtocolError("Teleoperation response client does not match the connection.")
        if response_value.get("requestId") != self._request_id:
            raise TeleoperationProtocolError("Teleoperation response request ID did not match the command.")
        if response_value.get("ok") is not True:
            raw_error = response_value.get("error")
            if not isinstance(raw_error, Mapping):
                raise TeleoperationProtocolError("Teleoperation returned an unstructured command error.")
            code = str(raw_error.get("code", "TRANSPORT_ERROR"))
            message = str(raw_error.get("message", "The teleoperation command failed."))
            details = raw_error.get("details")
            if code in {"LEASE_REQUIRED", "LEASE_INVALID", "ALREADY_ACQUIRED"}:
                raise TeleoperationLeaseError(message)
            if code in {
                "STATE_REVISION_STALE",
                "STATE_NOT_FOUND",
                "STATE_CHANGE_DURING_RECORDING",
            }:
                raise TeleoperationStateError(message)
            raise TeleoperationCommandError(
                code,
                message,
                details if isinstance(details, Mapping) else None,
            )
        result = response_value.get("result")
        if not isinstance(result, Mapping):
            raise TeleoperationProtocolError("Teleoperation response is missing its result object.")
        return result

    def _wait_for_snapshot(
        self,
        *,
        minimum_sequence: int,
        expected_state_revision: int | None = None,
        expected_step_id: int | None = None,
        expected_state_id: str | None = None,
        exact_step_id: bool = False,
    ) -> StateSnapshot:
        if self._stream is None:
            raise TeleoperationConnectionError("The teleoperation state stream is not connected.")
        deadline = time.monotonic() + self.timeout_s
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TeleoperationConnectionError("Timed out waiting for a native teleoperation snapshot.")
            if not self._stream.poll(max(1, int(math.ceil(remaining * 1000)))):
                raise TeleoperationConnectionError("Timed out waiting for a native teleoperation snapshot.")
            try:
                snapshot = decode_state_message(
                    self._stream.recv_multipart(), self._session_id, decode_images=self._decode_images,
                )
            except self._zmq.Again:  # type: ignore[union-attr]
                continue
            if snapshot.sequence <= self._last_sequence or snapshot.sequence <= minimum_sequence:
                continue
            self._last_sequence = snapshot.sequence
            self._retain_image_snapshot(snapshot)
            if expected_state_revision is not None:
                if snapshot.state_revision < expected_state_revision:
                    continue
                if snapshot.state_revision > expected_state_revision:
                    raise TeleoperationStateError(
                        "The native state revision changed while waiting for the requested snapshot."
                    )
            if expected_step_id is not None:
                if snapshot.step_id < expected_step_id:
                    continue
                if exact_step_id and snapshot.step_id > expected_step_id:
                    continue
            if expected_state_id is not None and snapshot.state_id != expected_state_id:
                raise TeleoperationStateError(
                    f"The native snapshot state '{snapshot.state_id}' does not match '{expected_state_id}'."
                )
            return self._accept_snapshot(snapshot)

    def _accept_snapshot(self, snapshot: StateSnapshot) -> StateSnapshot:
        self._current_state = snapshot
        local = getattr(self, "local", None)
        if local is not None:
            local.synchronize(snapshot)
        return snapshot

    def _retain_image_snapshot(self, snapshot: StateSnapshot) -> None:
        if not (snapshot.images or snapshot.compressed_images) or not self._include_images:
            return
        if len(self._image_snapshots) == self._image_snapshots.maxlen:
            self._dropped_image_snapshots += 1
        self._image_snapshots.append(snapshot)

    @property
    def dropped_image_snapshots(self) -> int:
        """Image-bearing snapshots replaced in the bounded preview queue (not transport losses)."""
        return self._dropped_image_snapshots

    def take_image_snapshots(self) -> tuple[StateSnapshot, ...]:
        """Drain up to two image-bearing snapshots with their original time/state identity.

        Call on the same thread as ``observe``/``step``. Those methods fill this queue
        even when a newer state-only message supersedes a camera preview. Previews are
        lossy and throttled by the worker; this is not a frame-complete recording API.
        """
        self._ensure_open()
        snapshots = tuple(self._image_snapshots)
        self._image_snapshots.clear()
        return snapshots

    def observe(self) -> StateSnapshot:
        """Return the newest complete PUB snapshot, waiting when none has arrived yet."""
        self._ensure_open()
        if self._current_state is None:
            return self._wait_for_snapshot(minimum_sequence=self._last_sequence)
        if self._stream is not None:
            for _ in range(100):
                if not self._stream.poll(0):
                    break
                try:
                    snapshot = decode_state_message(
                        self._stream.recv_multipart(), self._session_id, decode_images=self._decode_images,
                    )
                except self._zmq.Again:  # type: ignore[union-attr]
                    break
                if snapshot.sequence <= self._last_sequence:
                    continue
                self._last_sequence = snapshot.sequence
                self._retain_image_snapshot(snapshot)
                self._accept_snapshot(snapshot)
        return self._current_state

    def read(self) -> StateSnapshot:
        return self.observe()

    def _require_metadata(self) -> _Metadata:
        if self._metadata is None:
            raise TeleoperationConnectionError("Teleoperation metadata is not available before connect().")
        return self._metadata

    def _require_lease(self) -> str:
        if self._lease_id is None:
            raise TeleoperationLeaseError("The external teleoperation lease has not been acquired.")
        return self._lease_id

    def _resolve_joint_target(self, name: Any) -> _ActionBinding:
        if not isinstance(name, str) or not name:
            raise TeleoperationCommandError("TARGET_UNSUPPORTED", "Joint target names must be non-empty strings.")
        metadata = self._require_metadata()
        candidates = metadata.joint_candidates.get(name)
        if candidates is None:
            raise TeleoperationCommandError("TARGET_NOT_FOUND", f"No joint named '{name}' exists in the scene.")
        if len(candidates) == 0:
            raise TeleoperationCommandError(
                "TARGET_UNSUPPORTED",
                f"Joint '{name}' has no profile-declared position actuator.",
            )
        if len(candidates) != 1:
            raise TeleoperationCommandError(
                "TARGET_AMBIGUOUS",
                f"Joint '{name}' has multiple profile-declared position actuators.",
            )
        return candidates[0]

    def _resolve_actuator_target(self, name: Any) -> _ActionBinding:
        if not isinstance(name, str) or not name:
            raise TeleoperationCommandError("TARGET_UNSUPPORTED", "Actuator target names must be non-empty strings.")
        metadata = self._require_metadata()
        matches = [
            binding
            for binding in metadata.bindings
            if binding.action_name == name or binding.actuator_name == name
        ]
        if not matches:
            raise TeleoperationCommandError(
                "TARGET_NOT_FOUND",
                f"No controllable actuator or action named '{name}' exists in the profile.",
            )
        if len(matches) != 1:
            raise TeleoperationCommandError(
                "TARGET_AMBIGUOUS",
                f"Actuator address '{name}' is ambiguous in the profile.",
            )
        return matches[0]

    def _complete_targets(
        self,
        current: StateSnapshot,
        joints: Mapping[str, Any] | None,
        actuators: Mapping[str, Any] | None,
    ) -> dict[str, float]:
        metadata = self._require_metadata()
        if joints is not None and not isinstance(joints, Mapping):
            raise TeleoperationCommandError("TARGET_INVALID", "joints must be a mapping of names to values.")
        if actuators is not None and not isinstance(actuators, Mapping):
            raise TeleoperationCommandError("TARGET_INVALID", "actuators must be a mapping of names to values.")
        if current.ctrl.shape != (int(self.local.model.nu),):
            raise TeleoperationProtocolError("The authoritative ctrl vector does not match the local model.")
        targets = {
            binding.action_name: float(current.ctrl[binding.actuator_index])
            for binding in metadata.bindings
        }
        addressed: set[str] = set()
        for is_joint, collection in ((True, joints), (False, actuators)):
            if collection is None:
                continue
            for name, raw_value in collection.items():
                binding = (
                    self._resolve_joint_target(name)
                    if is_joint
                    else self._resolve_actuator_target(name)
                )
                if binding.action_name in addressed:
                    raise TeleoperationCommandError(
                        "TARGET_DUPLICATE",
                        f"Target '{binding.action_name}' was addressed more than once.",
                    )
                addressed.add(binding.action_name)
                targets[binding.action_name] = _finite_number(
                    raw_value,
                    f"Target '{name}'",
                )
        for binding in metadata.bindings:
            value = targets[binding.action_name]
            if not math.isfinite(value):
                raise TeleoperationCommandError(
                    "TARGET_NON_FINITE",
                    f"Target '{binding.action_name}' must be finite.",
                )
            if binding.control_range is not None and not binding.control_range[0] <= value <= binding.control_range[1]:
                raise TeleoperationCommandError(
                    "TARGET_OUT_OF_RANGE",
                    f"Target '{binding.action_name}' is outside its configured range "
                    f"[{binding.control_range[0]}, {binding.control_range[1]}].",
                )
        return targets

    def step(
        self,
        *,
        joints: Mapping[str, Any] | None = None,
        actuators: Mapping[str, Any] | None = None,
        physics_steps: int = 1,
        kinematic_state: Mapping[str, Any] | None = None,
    ) -> StateSnapshot:
        """Apply partial sticky targets and wait for their authoritative native snapshot."""
        lease_id = self._require_lease()
        if not isinstance(physics_steps, int) or isinstance(physics_steps, bool) or not 1 <= physics_steps <= 1_000:
            raise TeleoperationCommandError("PHYSICS_STEPS_INVALID", "physics_steps must be between 1 and 1000.")
        current = self.observe()
        targets = self._complete_targets(current, joints, actuators)
        if kinematic_state is not None and not isinstance(kinematic_state, Mapping):
            raise TeleoperationCommandError("TARGET_INVALID", "kinematic_state must be a mapping.")
        minimum_sequence = self._last_sequence
        result = self._request(
            "step",
            leaseId=lease_id,
            expectedStateRevision=current.state_revision,
            targets=targets,
            physicsSteps=physics_steps,
            **({"kinematicState": dict(kinematic_state)} if kinematic_state is not None else {}),
        )
        step_id = result.get("stepId")
        state_revision = result.get("stateRevision")
        if not isinstance(step_id, int) or isinstance(step_id, bool) or step_id < 1:
            raise TeleoperationProtocolError("Teleoperation step did not return a valid step ID.")
        if (
            not isinstance(state_revision, int)
            or isinstance(state_revision, bool)
            or state_revision != current.state_revision
        ):
            raise TeleoperationStateError("Teleoperation step returned a different state revision.")
        return self._wait_for_snapshot(
            minimum_sequence=minimum_sequence,
            expected_state_revision=current.state_revision,
            expected_step_id=step_id,
            exact_step_id=True,
        )

    def select_initial_state(self, state_id: str) -> StateSnapshot:
        lease_id = self._require_lease()
        if not isinstance(state_id, str) or not state_id:
            raise TeleoperationStateError("state_id must be a non-empty string.")
        if not any(state.state_id == state_id for state in self._initial_states):
            raise TeleoperationStateError(f"Initial state '{state_id}' was not found in the session.")
        current = self.observe()
        minimum_sequence = self._last_sequence
        result = self._request("state.select", leaseId=lease_id, stateId=state_id)
        state_revision = result.get("stateRevision")
        if not isinstance(state_revision, int) or isinstance(state_revision, bool) or state_revision < 0:
            raise TeleoperationProtocolError("Teleoperation state.select returned an invalid state revision.")
        del current
        snapshot = self._wait_for_snapshot(
            minimum_sequence=minimum_sequence,
            expected_state_revision=state_revision,
            expected_step_id=0,
            expected_state_id=state_id,
            exact_step_id=True,
        )
        self.local.synchronize(snapshot)
        return snapshot

    def reset(self) -> StateSnapshot:
        lease_id = self._require_lease()
        current = self.observe()
        minimum_sequence = self._last_sequence
        try:
            result = self._request("reset", leaseId=lease_id)
        except TeleoperationCommandError as error:
            if error.code != "MALFORMED_COMMAND" or "reset" not in error.message.lower():
                raise
            result = self._request(
                "state.select",
                leaseId=lease_id,
                stateId=current.state_id,
            )
            result = {**result, "stepId": 0, "stateId": result.get("stateId", current.state_id)}
        state_id = result.get("stateId")
        state_revision = result.get("stateRevision")
        step_id = result.get("stepId")
        if not isinstance(state_id, str) or not state_id:
            raise TeleoperationProtocolError("Teleoperation reset returned an invalid state ID.")
        if not isinstance(state_revision, int) or isinstance(state_revision, bool) or state_revision < 0:
            raise TeleoperationProtocolError("Teleoperation reset returned an invalid state revision.")
        if not isinstance(step_id, int) or isinstance(step_id, bool) or step_id < 0:
            raise TeleoperationProtocolError("Teleoperation reset returned an invalid step ID.")
        if state_revision < current.state_revision:
            raise TeleoperationStateError("Teleoperation reset returned a stale state revision.")
        snapshot = self._wait_for_snapshot(
            minimum_sequence=minimum_sequence,
            expected_state_revision=state_revision,
            expected_step_id=step_id,
            expected_state_id=state_id,
            exact_step_id=True,
        )
        self.local.synchronize(snapshot)
        return snapshot

    def start_recording(self) -> str:
        lease_id = self._require_lease()
        result = self._request("record.start", leaseId=lease_id)
        episode_id = result.get("episodeId")
        if not isinstance(episode_id, str) or not episode_id:
            raise TeleoperationProtocolError("Teleoperation record.start did not return an episode ID.")
        index, seed = result.get("recordingIndex"), result.get("attemptSeed")
        self._recording_attempt = (
            RecordingAttempt(index, seed)
            if all(isinstance(value, int) and not isinstance(value, bool) for value in (index, seed))
            else None
        )
        return episode_id

    @property
    def recording_attempt(self) -> RecordingAttempt | None:
        """Seed of the recording started last, for varying scripted demonstrations per attempt."""
        return self._recording_attempt

    def stop_recording(
        self,
        *,
        save: bool = True,
        metadata: Mapping[str, Any] | None = None,
    ) -> Mapping[str, Any] | None:
        """Stop recording and, with ``save``, commit it with optional JSON ``metadata``."""
        lease_id = self._require_lease()
        result = self._request("record.stop", leaseId=lease_id)
        pending = result.get("pendingRecording")
        if pending is None:
            return None
        if not isinstance(pending, Mapping):
            raise TeleoperationProtocolError("Teleoperation record.stop returned invalid pending recording data.")
        if not save:
            return dict(pending)
        return self.save_recording(metadata=metadata)

    def save_recording(self, *, metadata: Mapping[str, Any] | None = None) -> Mapping[str, Any]:
        """Commit the stopped (pending) recording with optional JSON ``metadata``."""
        lease_id = self._require_lease()
        saved = self._request(
            "record.save",
            response_timeout_s=RECORD_SAVE_TIMEOUT_SECONDS,
            leaseId=lease_id,
            **({"metadata": dict(metadata)} if metadata is not None else {}),
        )
        episode = saved.get("episode")
        if not isinstance(episode, Mapping):
            raise TeleoperationProtocolError("Teleoperation record.save did not return an episode.")
        return dict(episode)

    def discard_recording(self) -> None:
        lease_id = self._require_lease()
        self._request("record.discard", leaseId=lease_id)

    def start_batch(
        self,
        *,
        state_ids: Sequence[str] | str = "all",
        episodes_per_state: int = 1,
        workers: int = 1,
        controller: str = "so101-pick-place",
        egl_devices: Sequence[int] | None = None,
    ) -> Mapping[str, Any]:
        """Start batch generation in the native worker (requires the lease; see ``batch_status``)."""
        lease_id = self._require_lease()
        result = self._request(
            "batch.start",
            leaseId=lease_id,
            stateIds=list(state_ids) if isinstance(state_ids, Sequence) and not isinstance(state_ids, str) else state_ids,
            episodesPerState=episodes_per_state,
            workers=workers,
            controller=controller,
            **({"eglDevices": list(egl_devices)} if egl_devices is not None else {}),
        )
        return result.get("batch", {}) if isinstance(result.get("batch", {}), Mapping) else {}

    def batch_status(self) -> Mapping[str, Any]:
        """Return the worker's batch status (no lease needed)."""
        result = self._request("batch.status")
        return result.get("batch", {}) if isinstance(result.get("batch", {}), Mapping) else {}

    def cancel_batch(self) -> Mapping[str, Any]:
        """Ask the worker to cancel the running batch; already resolved attempts stay committed."""
        lease_id = self._require_lease()
        result = self._request("batch.cancel", leaseId=lease_id)
        return result.get("batch", {}) if isinstance(result.get("batch", {}), Mapping) else {}

    def record(self) -> _RecordingContext:
        """Record one interval, saving it on normal exit and discarding on errors."""
        return _RecordingContext(self)

    def release(self) -> None:
        if self._lease_id is None:
            return
        if self._response_timed_out:
            raise TeleoperationCommandOutcomeUnknown(
                "release",
                self._resolved.control_endpoint,
                self._session_id or "unknown",
            )
        lease_id = self._lease_id
        self._request("release", leaseId=lease_id)
        self._lease_id = None

    def _ensure_open(self) -> None:
        if self._closed:
            raise TeleoperationConnectionError("The teleoperation client is closed.")

    def _close_transport(self) -> None:
        for socket in (self._dealer, self._stream):
            if socket is not None:
                try:
                    socket.close(0)
                except Exception:
                    pass
        self._dealer = None
        self._stream = None
        if self._context is not None:
            try:
                self._context.term()
            except Exception:
                pass
        self._context = None

    def close(self) -> None:
        if self._closed:
            return
        try:
            self._heartbeat_stop.set()
            heartbeat_thread = self._heartbeat_thread
            if heartbeat_thread is not None and heartbeat_thread is not threading.current_thread():
                heartbeat_thread.join(timeout=max(self.timeout_s, 1.0))
            self._heartbeat_thread = None
            if self._lease_id is not None and not self._response_timed_out and self._dealer is not None:
                try:
                    self.release()
                except Exception:
                    pass
        finally:
            self._close_transport()
            self.local.close()
            self._image_snapshots.clear()
            self._bundle.close()
            for temporary in self._resolved.temporary_directories:
                temporary.cleanup()
            self._closed = True


__all__ = [
    "ActuatorInfo",
    "InitialStateInfo",
    "JointInfo",
    "LocalScene",
    "StateSnapshot",
    "Teleoperation",
    "TeleoperationCommandError",
    "TeleoperationCommandOutcomeUnknown",
    "TeleoperationCommandTimeoutError",
    "TeleoperationConnectionError",
    "TeleoperationDiscoveryError",
    "TeleoperationError",
    "TeleoperationProtocolError",
    "decode_state_message",
]
