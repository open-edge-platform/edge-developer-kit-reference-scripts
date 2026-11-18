# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Seeded appearance and physics randomization of MjModel fields.

Model rules never change the simulation state (``qpos``/``qvel``); they write MjModel fields such as
``geom_rgba`` or ``body_mass``. Every write is taken relative to a baseline captured when the model
was loaded, so randomization never accumulates across resets. Each applied rule is also recorded as
``{"field", "index", "values"}`` overrides so a Generate scene state can restore exactly the same
model later without re-sampling.
"""

from __future__ import annotations

import colorsys
import math
from collections.abc import Callable, Mapping, Sequence
from typing import Any, Protocol

import numpy as np

MODEL_RULE_KINDS = frozenset(
    {
        "geom-color",
        "geom-material",
        "light",
        "camera-pose",
        "camera-fov",
        "body-mass",
        "geom-friction",
        "joint-damping",
        "actuator-gain",
        "backdrop-appearance",
    }
)

BACKDROP_APPEARANCE_KIND = "backdrop-appearance"
# Pseudo model field recorded in overrides for the splat backdrop's HSV appearance transform
# (``values`` = [hueShift, saturationScale, valueScale]; ``index`` is always 0).
BACKDROP_APPEARANCE_FIELD = "backdrop_appearance"
BackdropAppearanceSink = Callable[[tuple[float, float, float] | None], None]

# Rule kind -> key holding the rule's MuJoCo target name. The sample ``target`` echoes this value.
MODEL_RULE_TARGET_KEYS: Mapping[str, str] = {
    "geom-color": "target",
    "geom-material": "geom",
    "light": "light",
    "camera-pose": "camera",
    "camera-fov": "camera",
    "body-mass": "body",
    "geom-friction": "target",
    "joint-damping": "joint",
    "actuator-gain": "actuator",
    "backdrop-appearance": "target",
}

APPEARANCE_FIELDS = (
    "geom_rgba",
    "geom_matid",
    "light_pos",
    "light_dir",
    "light_diffuse",
    "cam_pos",
    "cam_quat",
    "cam_fovy",
)
PHYSICS_FIELDS = (
    "body_mass",
    "body_inertia",
    "geom_friction",
    "dof_damping",
    "actuator_gainprm",
    "actuator_biasprm",
)
MODEL_FIELDS = APPEARANCE_FIELDS + PHYSICS_FIELDS

# MuJoCo's default geom colour. A geom with a material keeps this value and renders in the
# material colour, so colour jitter starts from the material colour in that case.
_DEFAULT_GEOM_RGBA = np.asarray([0.5, 0.5, 0.5, 1.0])


class ModelRandomizationError(ValueError):
    pass


class UniformSource(Protocol):
    def next(self) -> float: ...
    def range(self, value: list[float]) -> float: ...


def is_model_rule(rule: Mapping[str, Any]) -> bool:
    return rule.get("kind") in MODEL_RULE_KINDS


def _symmetric(random: UniformSource, jitter: Any, count: int) -> list[float]:
    amount = float(jitter or 0.0)
    return [random.range([-amount, amount]) for _ in range(count)]


def sample_model_rule(rule: Mapping[str, Any], random: UniformSource) -> dict[str, Any]:
    """Draw one sample for a model rule. The number of draws per kind is fixed for determinism."""
    kind = rule["kind"]
    target = rule[MODEL_RULE_TARGET_KEYS[kind]]
    if kind in {"geom-color", BACKDROP_APPEARANCE_KIND}:
        values = [random.range(list(rule[key])) for key in ("hueShift", "saturationScale", "valueScale")]
    elif kind == "geom-material":
        materials = list(rule["materials"])
        index = min(int(random.next() * len(materials)), len(materials) - 1)
        return {"target": target, "values": [float(index)], "selected": materials[index]}
    elif kind == "light":
        values = (
            _symmetric(random, rule["positionJitter"], 3)
            + _symmetric(random, rule.get("directionJitter", 0.0), 3)
            + [random.range(list(rule["diffuseScale"]))]
        )
    elif kind == "camera-pose":
        values = _symmetric(random, rule["positionJitter"], 3) + _symmetric(random, rule["rotationJitter"], 3)
    elif kind == "camera-fov":
        values = [random.range(list(rule["range"]))]
    elif kind == "geom-friction":
        scale = rule["scale"]
        values = [random.range(list(scale.get(key, (1.0, 1.0)))) for key in ("sliding", "torsional", "rolling")]
    elif kind in {"body-mass", "joint-damping", "actuator-gain"}:
        values = [random.range(list(rule["scale"]))]
    else:
        raise ModelRandomizationError(f"Unsupported model randomization rule '{kind}'.")
    return {"target": target, "values": values}


def _quaternion_from_rotation_vector(degrees: Sequence[float]) -> np.ndarray:
    vector = np.radians(np.asarray(degrees, dtype=np.float64))
    angle = float(np.linalg.norm(vector))
    if angle == 0.0:
        return np.asarray([1.0, 0.0, 0.0, 0.0])
    return np.asarray([math.cos(angle / 2), *(vector / angle * math.sin(angle / 2))])


def _rotate(quaternion: np.ndarray, vector: np.ndarray) -> np.ndarray:
    w, x, y, z = quaternion
    rotation = np.asarray(
        [
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
        ]
    )
    return rotation @ vector


def _multiply_quaternion(left: np.ndarray, right: np.ndarray) -> np.ndarray:
    lw, lx, ly, lz = left
    rw, rx, ry, rz = right
    return np.asarray(
        [
            lw * rw - lx * rx - ly * ry - lz * rz,
            lw * rx + lx * rw + ly * rz - lz * ry,
            lw * ry - lx * rz + ly * rw + lz * rx,
            lw * rz + lx * ry - ly * rx + lz * rw,
        ]
    )


class ModelRandomizer:
    """Owns the MjModel baseline and applies model rules or stored overrides on top of it.

    ``backdrop_body`` / ``backdrop_appearance`` connect the ``backdrop-appearance`` rule to a
    splat backdrop renderer: the sink receives ``(hueShift, saturationScale, valueScale)`` when a
    sample is applied and ``None`` when the baseline is restored.
    """

    def __init__(
        self,
        mujoco: Any,
        model: Any,
        *,
        backdrop_body: str | None = None,
        backdrop_appearance: BackdropAppearanceSink | None = None,
    ) -> None:
        self._mujoco = mujoco
        self.model = model
        self._baseline = {name: np.asarray(getattr(model, name)).copy() for name in MODEL_FIELDS}
        self._physics_modified = False
        self._backdrop_body = backdrop_body
        self._backdrop_sink = backdrop_appearance
        self._backdrop_values: tuple[float, float, float] | None = None

    @property
    def backdrop_appearance(self) -> tuple[float, float, float] | None:
        return self._backdrop_values

    def _set_backdrop_appearance(self, values: tuple[float, float, float] | None) -> None:
        self._backdrop_values = values
        if self._backdrop_sink is not None:
            self._backdrop_sink(values)

    def _require_backdrop(self, target: Any) -> None:
        if self._backdrop_body is None:
            raise ModelRandomizationError(
                "'backdrop-appearance' randomization requires a configured profile.backdrop."
            )
        if target != self._backdrop_body:
            raise ModelRandomizationError(
                f"'backdrop-appearance' target '{target}' must be the backdrop body '{self._backdrop_body}'."
            )

    def baseline(self, field: str) -> np.ndarray:
        return self._baseline[field]

    def _field(self, name: str) -> np.ndarray:
        return np.asarray(getattr(self.model, name))

    def _named_id(self, kind: str, name: str) -> int:
        object_type = getattr(self._mujoco.mjtObj, f"mjOBJ_{kind.upper()}")
        index = int(self._mujoco.mj_name2id(self.model, object_type, str(name)))
        if index < 0:
            raise ModelRandomizationError(f"No {kind} named '{name}' exists in the model.")
        return index

    def _geoms(self, target: str, mode: str) -> list[int]:
        if mode == "geom":
            return [self._named_id("geom", target)]
        body_id = self._named_id("body", target)
        geoms = [index for index, owner in enumerate(np.asarray(self.model.geom_bodyid)) if int(owner) == body_id]
        if not geoms:
            raise ModelRandomizationError(f"Body '{target}' has no geoms to randomize.")
        return geoms

    def restore(self, data: Any | None = None) -> None:
        """Write every baseline field back. Recomputes derived constants if physics changed."""
        for name, baseline in self._baseline.items():
            self._field(name)[:] = baseline
        if self._backdrop_values is not None:
            self._set_backdrop_appearance(None)
        if self._physics_modified:
            self._physics_modified = False
            self._refresh_constants(data)

    def _refresh_constants(self, data: Any | None) -> None:
        if data is not None and hasattr(self._mujoco, "mj_setConst"):
            # mj_setConst uses ``data`` as scratch space; callers reset or restore state afterwards.
            self._mujoco.mj_setConst(self.model, data)

    def apply_rules(
        self,
        rules: Sequence[Mapping[str, Any]],
        samples: Sequence[Mapping[str, Any]],
        data: Any | None = None,
    ) -> list[dict[str, Any]]:
        """Apply sampled model rules on top of the current model and return the overrides written."""
        if len(rules) != len(samples):
            raise ModelRandomizationError(f"Expected {len(rules)} model samples, received {len(samples)}.")
        overrides: dict[tuple[str, int], np.ndarray] = {}
        for rule, sample in zip(rules, samples, strict=True):
            for field, index in self._apply_rule(rule, sample):
                if field == BACKDROP_APPEARANCE_FIELD:
                    overrides[(field, index)] = np.asarray(self._backdrop_values, dtype=np.float64)
                    continue
                overrides[(field, index)] = np.asarray(self._field(field)[index]).copy()
        if any(field in PHYSICS_FIELDS for field, _ in overrides):
            self._physics_modified = True
            self._refresh_constants(data)
        return [
            {"field": field, "index": index, "values": np.atleast_1d(values).astype(float).tolist()}
            for (field, index), values in overrides.items()
        ]

    def apply_overrides(self, overrides: Sequence[Mapping[str, Any]], data: Any | None = None) -> None:
        """Restore the baseline, then write stored override rows exactly."""
        self.restore(data)
        physics = False
        for override in overrides:
            field = str(override.get("field"))
            if field == BACKDROP_APPEARANCE_FIELD:
                self._apply_backdrop_override(override)
                continue
            if field not in self._baseline:
                raise ModelRandomizationError(f"Model override field '{field}' is not randomizable.")
            rows = self._field(field)
            index = int(override.get("index", -1))
            if not 0 <= index < rows.shape[0]:
                raise ModelRandomizationError(f"Model override index {index} is out of range for '{field}'.")
            values = np.asarray(override.get("values"), dtype=np.float64)
            if values.size != np.atleast_1d(rows[index]).size or not np.all(np.isfinite(values)):
                raise ModelRandomizationError(f"Model override for '{field}[{index}]' has invalid values.")
            rows[index] = values.reshape(np.shape(rows[index]))
            physics = physics or field in PHYSICS_FIELDS
        if physics:
            self._physics_modified = True
            self._refresh_constants(data)

    def _apply_backdrop_override(self, override: Mapping[str, Any]) -> None:
        if self._backdrop_body is None:
            raise ModelRandomizationError(
                "A backdrop appearance override requires a configured profile.backdrop."
            )
        if int(override.get("index", -1)) != 0:
            raise ModelRandomizationError("Backdrop appearance overrides must use index 0.")
        values = np.asarray(override.get("values"), dtype=np.float64)
        if values.shape != (3,) or not np.all(np.isfinite(values)):
            raise ModelRandomizationError("Backdrop appearance overrides need three finite values.")
        self._set_backdrop_appearance((float(values[0]), float(values[1]), float(values[2])))

    def _apply_rule(self, rule: Mapping[str, Any], sample: Mapping[str, Any]) -> list[tuple[str, int]]:
        kind = rule.get("kind")
        target = rule.get(MODEL_RULE_TARGET_KEYS.get(str(kind), ""))
        if sample.get("target") != target:
            raise ModelRandomizationError(
                f"Randomization sample target '{sample.get('target')}' does not match rule target '{target}'."
            )
        values = np.asarray(sample.get("values"), dtype=np.float64)
        if not np.all(np.isfinite(values)):
            raise ModelRandomizationError(f"Randomization sample for '{target}' must be finite.")

        def expect(count: int) -> np.ndarray:
            if values.shape != (count,):
                raise ModelRandomizationError(f"'{kind}' samples need {count} values, received {values.size}.")
            return values

        if kind == "geom-color":
            hue_shift, saturation_scale, value_scale = expect(3)
            written = []
            for geom_id in self._geoms(str(target), str(rule.get("mode", "body"))):
                base = self._baseline["geom_rgba"][geom_id].astype(np.float64)
                material = int(self._baseline["geom_matid"][geom_id])
                if material >= 0 and np.allclose(base, _DEFAULT_GEOM_RGBA):
                    base = np.asarray(self.model.mat_rgba[material], dtype=np.float64)
                hue, saturation, value = colorsys.rgb_to_hsv(*np.clip(base[:3], 0.0, 1.0))
                red, green, blue = colorsys.hsv_to_rgb(
                    (hue + hue_shift) % 1.0,
                    float(np.clip(saturation * saturation_scale, 0.0, 1.0)),
                    float(np.clip(value * value_scale, 0.0, 1.0)),
                )
                self._field("geom_rgba")[geom_id] = (red, green, blue, base[3])
                written.append(("geom_rgba", geom_id))
            return written
        if kind == BACKDROP_APPEARANCE_KIND:
            self._require_backdrop(target)
            hue_shift, saturation_scale, value_scale = expect(3)
            self._set_backdrop_appearance((float(hue_shift), float(saturation_scale), float(value_scale)))
            return [(BACKDROP_APPEARANCE_FIELD, 0)]
        if kind == "geom-material":
            index = int(expect(1)[0])
            materials = list(rule.get("materials") or [])
            if not 0 <= index < len(materials):
                raise ModelRandomizationError(f"Material index {index} is out of range for '{target}'.")
            geom_id = self._named_id("geom", str(target))
            self._field("geom_matid")[geom_id] = self._named_id("material", materials[index])
            return [("geom_matid", geom_id)]
        if kind == "light":
            sampled = expect(7)
            light_id = self._named_id("light", str(target))
            self._field("light_pos")[light_id] = self._baseline["light_pos"][light_id] + sampled[:3]
            direction = _rotate(
                _quaternion_from_rotation_vector(sampled[3:6]), self._baseline["light_dir"][light_id]
            )
            norm = float(np.linalg.norm(direction))
            if norm > 0:
                self._field("light_dir")[light_id] = direction / norm
            self._field("light_diffuse")[light_id] = self._baseline["light_diffuse"][light_id] * sampled[6]
            return [("light_pos", light_id), ("light_dir", light_id), ("light_diffuse", light_id)]
        if kind == "camera-pose":
            sampled = expect(6)
            camera_id = self._named_id("camera", str(target))
            self._field("cam_pos")[camera_id] = self._baseline["cam_pos"][camera_id] + sampled[:3]
            rotated = _multiply_quaternion(
                self._baseline["cam_quat"][camera_id], _quaternion_from_rotation_vector(sampled[3:])
            )
            self._field("cam_quat")[camera_id] = rotated / np.linalg.norm(rotated)
            return [("cam_pos", camera_id), ("cam_quat", camera_id)]
        if kind == "camera-fov":
            fov = float(expect(1)[0])
            if not 1.0 <= fov <= 179.0:
                raise ModelRandomizationError("Camera field of view must be between 1 and 179 degrees.")
            camera_id = self._named_id("camera", str(target))
            self._field("cam_fovy")[camera_id] = fov
            return [("cam_fovy", camera_id)]
        if kind == "body-mass":
            scale = float(expect(1)[0])
            body_id = self._named_id("body", str(target))
            self._field("body_mass")[body_id] = self._baseline["body_mass"][body_id] * scale
            self._field("body_inertia")[body_id] = self._baseline["body_inertia"][body_id] * scale
            return [("body_mass", body_id), ("body_inertia", body_id)]
        if kind == "geom-friction":
            scales = expect(3)
            written = []
            for geom_id in self._geoms(str(target), str(rule.get("mode", "body"))):
                self._field("geom_friction")[geom_id] = self._baseline["geom_friction"][geom_id] * scales
                written.append(("geom_friction", geom_id))
            return written
        if kind == "joint-damping":
            scale = float(expect(1)[0])
            joint_id = self._named_id("joint", str(target))
            start = int(self.model.jnt_dofadr[joint_id])
            joint_type = int(self.model.jnt_type[joint_id])
            joint_types = self._mujoco.mjtJoint
            width = 6 if joint_type == int(joint_types.mjJNT_FREE) else 3 if joint_type == int(joint_types.mjJNT_BALL) else 1
            written = []
            for dof in range(start, start + width):
                self._field("dof_damping")[dof] = self._baseline["dof_damping"][dof] * scale
                written.append(("dof_damping", dof))
            return written
        if kind == "actuator-gain":
            scale = float(expect(1)[0])
            actuator_id = self._named_id("actuator", str(target))
            # For a position servo, gainprm[0] = kp and biasprm[1] = -kp; scale both together.
            gain = self._baseline["actuator_gainprm"][actuator_id].copy()
            bias = self._baseline["actuator_biasprm"][actuator_id].copy()
            gain[0] *= scale
            bias[1] *= scale
            self._field("actuator_gainprm")[actuator_id] = gain
            self._field("actuator_biasprm")[actuator_id] = bias
            return [("actuator_gainprm", actuator_id), ("actuator_biasprm", actuator_id)]
        raise ModelRandomizationError(f"Unsupported model randomization rule '{kind}'.")
