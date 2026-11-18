# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Intel XPU 3D Gaussian-splat backdrop rendering.

A backdrop is a 3D Gaussian Splatting (3DGS) PLY or SPZ that is composited behind/around the native
MuJoCo render. The splat is attached to a static MuJoCo body (``profile.backdrop.body``, default
``rs_backdrop``). An optional local calibration rotation ``R_l`` (``profile.backdrop.rotation``,
unit quaternion ``[w, x, y, z]``) is applied to the raw PLY coordinates before scaling, so
splat-local means ``p`` map to world as ``R_b @ (scale * R_l @ p) + t_b`` and covariances as
``(R_b R_l) R_q diag((scale * exp(s))**2) R_q^T (R_b R_l)^T``.

The rasterizer follows the reference 3DGS forward pass, vectorized in torch on an Intel XPU:

* EWA projection ``Sigma2D = J W Sigma W^T J^T + 0.3 I`` with a 3-sigma screen radius,
* culling of Gaussians behind the near plane and of screen bounding boxes outside the image,
* view-dependent color from spherical harmonics up to degree 3 (``f_dc_*`` + ``f_rest_*``),
  evaluated per frame for the visible Gaussians: ``color = max(SH(dir) + 0.5, 0)`` with ``dir``
  the unit vector from the camera center to the Gaussian mean, rotated into the PLY's own frame
  (``dir_local = (R_b R_l)^T dir_world``; the uniform scale does not change directions),
* the optional ``backdrop-appearance`` HSV transform applied to that per-frame color,
* 16x16 tile binning with (tile, depth)-ordered pair lists,
* front-to-back alpha compositing per tile in depth-ordered chunks
  (``alpha = min(0.99, opacity * exp(power))``, contributions below 1/255 skipped, per-pixel
  stop once transmittance would fall below 1e-4),
* per-pixel occlusion against the native MuJoCo metric depth (a Gaussian contributes only where
  its camera depth is smaller than the native depth),
* output ``C + T_final * native_rgb``.

Camera convention (OpenCV): ``x_cam = R @ x_world + t`` with +x right, +y down, +z forward;
pixel ``u = fx * x / z + cx``, ``v = fy * y / z + cy``, image row 0 is the top, and pixel
``(row, col)`` has its center at ``(col + 0.5, row + 0.5)``.
"""

from __future__ import annotations

import math
import os
import posixpath
import re
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from robotic_studio.camera_projection import frustum_intrinsics

from .ply import SH_C0, PLYError, PLYPointCloud, read_ply, sh_rest_count

BACKDROP_BACKEND = "intel-xpu"
DEFAULT_BACKDROP_BODY = "rs_backdrop"
IDENTITY_QUATERNION = (1.0, 0.0, 0.0, 0.0)
ROTATION_NORM_TOLERANCE = 1e-3
XPU_DEVICE_ENV = "ROBOTIC_STUDIO_XPU_DEVICE"
_XPU_DEVICE_PATTERN = re.compile(r"^xpu(:\d+)?$")

# Real spherical-harmonics constants of the reference 3DGS implementation.
SH_C1 = 0.4886025119029199
SH_C2 = (1.0925484305920792, -1.0925484305920792, 0.31539156525252005, -1.0925484305920792, 0.5462742152960396)
SH_C3 = (
    -0.5900435899266435,
    2.890611442640554,
    -0.4570457994644658,
    0.3731763325901154,
    -0.4570457994644658,
    1.445305721320277,
    -0.5900435899266435,
)
MAX_SH_DEGREE = 3

TILE_SIZE = 16
NEAR_EPSILON = 1e-6
ALPHA_MIN = 1.0 / 255.0
ALPHA_MAX = 0.99
TRANSMITTANCE_MIN = 1e-4
# Depth-ordered Gaussians per tile per compositing step (power of two, adapted to memory).
_MIN_CHUNK = 32
_MAX_CHUNK = 2048
# torch threshold keeps values strictly above the threshold; keep alpha >= 1/255.
_ALPHA_SKIP = float(np.nextafter(np.float32(ALPHA_MIN), np.float32(0.0)))
# Hard ceiling on Gaussians; the effective limit also scales with device memory.
MAX_GAUSSIANS = 16_000_000
# Approximate persistent + per-frame device bytes per Gaussian (float32 tensors).
_BYTES_PER_GAUSSIAN = 320
# Approximate bytes per (Gaussian, tile) pair during binning and sorting.
_BYTES_PER_PAIR = 48


class BackdropError(RuntimeError):
    """Raised when backdrop configuration or rendering fails."""


@dataclass(frozen=True)
class BackdropCamera:
    """Pinhole camera with OpenCV conventions (see module docstring)."""

    rotation: np.ndarray  # (3, 3) world -> camera
    translation: np.ndarray  # (3,)
    fx: float
    fy: float
    cx: float
    cy: float
    width: int
    height: int
    near: float


@dataclass(frozen=True)
class BackdropSpec:
    """Optional ``profile.backdrop``; absence means the plain MuJoCo render path is used."""

    asset: str
    backend: str = BACKDROP_BACKEND
    body: str = DEFAULT_BACKDROP_BODY
    scale: float = 1.0
    hash: str | None = None
    # Local calibration rotation (w, x, y, z), applied to raw PLY coordinates before scaling.
    rotation: tuple[float, float, float, float] = IDENTITY_QUATERNION

    @classmethod
    def from_profile(cls, value: object) -> BackdropSpec | None:
        if value is None:
            return None
        if not isinstance(value, Mapping):
            raise ValueError("profile.backdrop must be an object.")
        asset_value = value.get("asset")
        if not isinstance(asset_value, str) or not asset_value.strip():
            raise ValueError("profile.backdrop must contain an asset string.")
        asset = asset_value.replace("\\", "/")
        if (
            not asset.lower().endswith((".ply", ".spz"))
            or asset.startswith("/")
            or ":" in asset.split("/")[0]
            or posixpath.normpath(asset) != asset
            or asset == ".."
            or asset.startswith("../")
            or not asset.startswith("splats/")
        ):
            raise ValueError("profile.backdrop.asset must be a relative splats/*.ply or splats/*.spz path.")
        backend = value.get("backend", BACKDROP_BACKEND)
        if backend != BACKDROP_BACKEND:
            raise ValueError("Only the intel-xpu backdrop backend is supported.")
        body = value.get("body", DEFAULT_BACKDROP_BODY)
        if not isinstance(body, str) or not body.strip():
            raise ValueError("profile.backdrop.body must be a non-empty MuJoCo body name.")
        scale = value.get("scale", 1.0)
        if (
            not isinstance(scale, (int, float))
            or isinstance(scale, bool)
            or not math.isfinite(scale)
            or scale <= 0
        ):
            raise ValueError("profile.backdrop.scale must be a positive finite number.")
        content_hash = value.get("hash")
        if content_hash is not None and (
            not isinstance(content_hash, str) or not _SHA256_HEX.fullmatch(content_hash)
        ):
            raise ValueError("profile.backdrop.hash must be a lowercase SHA-256 hex digest when present.")
        rotation = normalize_backdrop_rotation(value.get("rotation"))
        return cls(
            asset=asset,
            backend=backend,
            body=body,
            scale=float(scale),
            hash=content_hash,
            rotation=rotation,
        )


def normalize_backdrop_rotation(value: object) -> tuple[float, float, float, float]:
    """Validate ``profile.backdrop.rotation`` ([w, x, y, z], unit within 1e-3) and normalize it."""
    if value is None:
        return IDENTITY_QUATERNION
    if (
        not isinstance(value, (list, tuple))
        or len(value) != 4
        or not all(
            isinstance(item, (int, float)) and not isinstance(item, bool) and math.isfinite(item)
            for item in value
        )
    ):
        raise ValueError("profile.backdrop.rotation must be a [w, x, y, z] array of 4 finite numbers.")
    norm = math.sqrt(sum(float(item) ** 2 for item in value))
    if abs(norm - 1.0) > ROTATION_NORM_TOLERANCE:
        raise ValueError(
            f"profile.backdrop.rotation must be a unit quaternion (|q| = {norm:.6g}, "
            f"tolerance {ROTATION_NORM_TOLERANCE})."
        )
    w, x, y, z = (float(item) / norm for item in value)
    return (w, x, y, z)


_SHA256_HEX = re.compile(r"[0-9a-f]{64}")


def resolve_backdrop_asset(bundle: Any, spec: BackdropSpec) -> Path:
    """Return the on-disk PLY for ``spec`` inside ``bundle`` or raise ``BackdropError``.

    The asset must resolve inside the bundle root, exist, and match the bundle's declared splat
    (``SceneBundle.backdrop_path``) and optional manifest hash.
    """
    if bundle is None:
        raise BackdropError("A backdrop requires a scene bundle that contains the splat asset.")
    declared = bundle.backdrop_path
    if declared is not None and declared != spec.asset:
        raise BackdropError(
            f"profile.backdrop.asset '{spec.asset}' does not match the scene bundle splat '{declared}'."
        )
    bundle_root = Path(bundle.root).resolve()
    path = (bundle_root / spec.asset).resolve()
    if not path.is_relative_to(bundle_root) or not path.is_file():
        raise BackdropError(f"profile.backdrop asset is not present in the scene bundle: {spec.asset}")
    if spec.hash is not None:
        bundled_hash = next(
            entry["sha256"].lower()
            for entry in bundle.manifest["files"]
            if entry["path"] == spec.asset and isinstance(entry.get("sha256"), str)
        )
        if bundled_hash != spec.hash:
            raise BackdropError(
                f"profile.backdrop asset {spec.asset} does not match profile.backdrop.hash; "
                "re-save the scene so the worker receives the current splat."
            )
    return path


def camera_from_mujoco(
    camera_position: np.ndarray,
    camera_rotation: np.ndarray,
    *,
    width: int,
    height: int,
    near: float,
    frustum_bottom: float,
    frustum_top: float,
    frustum_center: float,
    frustum_width: float,
    frustum_near: float,
) -> BackdropCamera:
    """Build an OpenCV camera from a MuJoCo camera pose and the rendered OpenGL frustum.

    MuJoCo camera frames look down -Z with +Y up, so ``R = diag(1, -1, -1) @ cam_xmat.T``.
    The frustum values come from ``mjvScene.camera`` (as used by ``mjr_render``); for the
    default ``fovy`` cameras this yields ``fy = fx = (H / 2) / tan(fovy / 2)``, ``cx = W / 2``,
    ``cy = H / 2``.
    """
    rotation_world = np.asarray(camera_rotation, dtype=np.float64).reshape(3, 3)
    position = np.asarray(camera_position, dtype=np.float64).reshape(3)
    rotation = np.diag([1.0, -1.0, -1.0]) @ rotation_world.T
    translation = -rotation @ position
    try:
        fx, fy, cx, cy = frustum_intrinsics(
            width=width, height=height, frustum_bottom=frustum_bottom,
            frustum_top=frustum_top, frustum_center=frustum_center,
            frustum_width=frustum_width, frustum_near=frustum_near,
        )
    except ValueError as error:
        raise BackdropError(str(error)) from error
    return BackdropCamera(
        rotation=rotation,
        translation=translation,
        fx=float(fx),
        fy=float(fy),
        cx=float(cx),
        cy=float(cy),
        width=int(width),
        height=int(height),
        near=float(near),
    )


def _quaternion_matrices(quaternions: np.ndarray) -> np.ndarray:
    """``(N, 4)`` (w, x, y, z) quaternions -> ``(N, 3, 3)`` rotation matrices."""
    norms = np.linalg.norm(quaternions, axis=1, keepdims=True)
    if np.any(norms <= 0):
        raise BackdropError("3DGS PLY contains zero-length rotation quaternions.")
    w, x, y, z = (quaternions / norms).T
    return np.stack(
        (
            np.stack((1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)), axis=1),
            np.stack((2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)), axis=1),
            np.stack((2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)), axis=1),
        ),
        axis=1,
    )


def shift_colors_hsv_torch(
    torch: Any, colors: Any, hue_shift: float, saturation_scale: float, value_scale: float
) -> Any:
    """Apply the HSV appearance transform to an ``(N, 3)`` color tensor on its device."""
    rgb = colors.clamp(0.0, 1.0)
    red, green, blue = rgb.unbind(1)
    maximum = rgb.amax(dim=1)
    delta = maximum - rgb.amin(dim=1)
    has_delta = delta > 0
    safe = torch.where(has_delta, delta, torch.ones_like(delta))
    rc, gc, bc = (maximum - red) / safe, (maximum - green) / safe, (maximum - blue) / safe
    hue = torch.where(red == maximum, bc - gc, torch.where(green == maximum, 2.0 + rc - bc, 4.0 + gc - rc))
    hue = torch.where(has_delta, torch.remainder(hue / 6.0, 1.0), torch.zeros_like(hue))
    saturation = torch.where(maximum > 0, delta / torch.where(maximum > 0, maximum, 1.0), 0.0)
    hue = torch.remainder(hue + hue_shift, 1.0)
    saturation = (saturation * saturation_scale).clamp(0.0, 1.0)
    value = (maximum * value_scale).clamp(0.0, 1.0)
    sector_float = torch.floor(hue * 6.0)
    fraction = hue * 6.0 - sector_float
    p = value * (1.0 - saturation)
    q = value * (1.0 - saturation * fraction)
    t = value * (1.0 - saturation * (1.0 - fraction))
    sector = torch.remainder(sector_float.to(torch.int64), 6)[:, None]
    red = torch.stack((value, q, p, p, t, value), dim=1).gather(1, sector)
    green = torch.stack((t, value, value, q, p, p), dim=1).gather(1, sector)
    blue = torch.stack((p, p, t, value, value, q), dim=1).gather(1, sector)
    return torch.cat((red, green, blue), dim=1)


def sh_basis_torch(torch: Any, directions: Any, degree: int) -> Any:
    """Higher-order real SH basis ``(G, (d + 1)^2 - 1)`` for unit directions ``(G, 3)``.

    Matches the reference 3DGS ``computeColorFromSH`` (degree-0 term excluded).
    """
    x, y, z = directions.unbind(1)
    terms = [-SH_C1 * y, SH_C1 * z, -SH_C1 * x]
    if degree > 1:
        xx, yy, zz = x * x, y * y, z * z
        xy, yz, xz = x * y, y * z, x * z
        terms += [
            SH_C2[0] * xy,
            SH_C2[1] * yz,
            SH_C2[2] * (2.0 * zz - xx - yy),
            SH_C2[3] * xz,
            SH_C2[4] * (xx - yy),
        ]
        if degree > 2:
            terms += [
                SH_C3[0] * y * (3.0 * xx - yy),
                SH_C3[1] * xy * z,
                SH_C3[2] * y * (4.0 * zz - xx - yy),
                SH_C3[3] * z * (2.0 * zz - 3.0 * xx - 3.0 * yy),
                SH_C3[4] * x * (4.0 * zz - xx - yy),
                SH_C3[5] * z * (xx - yy),
                SH_C3[6] * x * (xx - 3.0 * yy),
            ]
    return torch.stack(terms, dim=1)


def _camera_center(camera: BackdropCamera) -> np.ndarray:
    """World camera center ``-R^T t`` (float64)."""
    rotation = np.asarray(camera.rotation, dtype=np.float64).reshape(3, 3)
    return -rotation.T @ np.asarray(camera.translation, dtype=np.float64).reshape(3)


def resolve_xpu_device(torch: Any) -> Any:
    """Select the Intel XPU device (``ROBOTIC_STUDIO_XPU_DEVICE``, default ``xpu``)."""
    if getattr(torch, "xpu", None) is None or not torch.xpu.is_available():
        raise BackdropError(
            "Intel XPU backdrop rendering requires an available Intel XPU device "
            "(torch.xpu.is_available() is False); CUDA and CPU rendering are not supported."
        )
    requested = os.environ.get(XPU_DEVICE_ENV, "xpu").strip()
    if not _XPU_DEVICE_PATTERN.match(requested):
        raise BackdropError(f"{XPU_DEVICE_ENV} must look like 'xpu' or 'xpu:N', got '{requested}'.")
    index = int(requested.split(":", 1)[1]) if ":" in requested else torch.xpu.current_device()
    count = int(torch.xpu.device_count())
    if not 0 <= index < count:
        raise BackdropError(f"{XPU_DEVICE_ENV}='{requested}' is out of range; {count} XPU device(s) found.")
    return torch.device("xpu", index)


class IntelXPUBackdropRenderer:
    """Vectorized standard-3DGS rasterizer composited over native MuJoCo RGB + depth."""

    def __init__(
        self,
        asset: str | Path | PLYPointCloud,
        *,
        scale: float = 1.0,
        rotation: Any = None,
        max_sh_degree: int = MAX_SH_DEGREE,
        device: Any = None,
        max_gaussians: int = MAX_GAUSSIANS,
    ) -> None:
        try:
            import torch
        except ModuleNotFoundError as error:
            raise BackdropError(
                "Intel XPU backdrop rendering requires the optional torch XPU stack."
            ) from error
        self._torch = torch
        self.device = torch.device(device) if device is not None else resolve_xpu_device(torch)
        if self.device.type != "xpu":
            raise BackdropError("Backdrop rendering only runs on an Intel XPU device.")
        if not math.isfinite(scale) or scale <= 0:
            raise BackdropError("Backdrop scale must be a positive finite number.")
        self.scale = float(scale)
        try:
            quaternion = normalize_backdrop_rotation(None if rotation is None else list(rotation))
        except (TypeError, ValueError) as error:
            raise BackdropError(f"Backdrop rotation is invalid: {error}") from error
        self.rotation = quaternion
        # Local calibration rotation R_l (raw PLY frame -> backdrop body frame, before scaling).
        self._local_rotation = _quaternion_matrices(np.asarray([quaternion], dtype=np.float64))[0]
        if (
            not isinstance(max_sh_degree, int)
            or isinstance(max_sh_degree, bool)
            or not 0 <= max_sh_degree <= MAX_SH_DEGREE
        ):
            raise BackdropError(f"max_sh_degree must be an integer in [0, {MAX_SH_DEGREE}].")
        cloud = asset if isinstance(asset, PLYPointCloud) else read_ply(asset)
        if not cloud.is_gaussian_splat:
            raise BackdropError(
                "3DGS PLY must contain x/y/z, f_dc_0..2 (or red/green/blue), scale_0..2, rot_0..3, and opacity."
            )
        try:
            cloud_degree = cloud.sh_degree
        except PLYError as error:
            raise BackdropError(str(error)) from error
        self.sh_degree = min(int(max_sh_degree), cloud_degree)
        sh_count = sh_rest_count(self.sh_degree)
        count = int(len(cloud.positions))
        total_memory = int(torch.xpu.get_device_properties(self.device).total_memory)
        memory_limit = int(0.5 * total_memory // (_BYTES_PER_GAUSSIAN + 12 * sh_count))
        limit = min(int(max_gaussians), memory_limit)
        if count > limit:
            raise BackdropError(
                f"Backdrop splat has {count} Gaussians; at most {limit} fit this XPU device "
                f"({total_memory // (1024 * 1024)} MiB)."
            )
        self.gaussian_count = count
        self._total_memory = total_memory
        # Chunk budget: elements per [tiles, 256 pixels, K Gaussians] float32 tensor.
        self._chunk_elements = int(np.clip(total_memory // 4000, 1 << 20, 1 << 23))
        self._max_pairs = int(np.clip(total_memory // (4 * _BYTES_PER_PAIR), 1 << 20, 1 << 28))

        rotations = _quaternion_matrices(np.asarray(cloud.rotations, dtype=np.float64))
        scales = np.exp(np.asarray(cloud.scales, dtype=np.float64))
        local_factor = rotations * scales[:, None, :]  # R_q @ diag(exp(s))
        opacity = 1.0 / (1.0 + np.exp(-np.asarray(cloud.opacities, dtype=np.float64)))
        # Degree-0 color 0.5 + C0 * f_dc (unclamped, as in 3DGS); RGB-only splats use their colors.
        if cloud.spherical_harmonics is not None:
            dc_colors = 0.5 + SH_C0 * np.asarray(cloud.spherical_harmonics, dtype=np.float64)
        else:
            dc_colors = np.asarray(cloud.colors, dtype=np.float64)
        with torch.no_grad():
            self._positions = torch.as_tensor(cloud.positions, dtype=torch.float32, device=self.device)
            self._local_factor = torch.as_tensor(local_factor, dtype=torch.float32, device=self.device)
            self._log_opacity = torch.as_tensor(
                np.log(np.maximum(opacity, 1e-30)), dtype=torch.float32, device=self.device
            )
            self._dc_colors = torch.as_tensor(dc_colors, dtype=torch.float32, device=self.device)
            self._sh_rest = (
                None
                if sh_count == 0
                else torch.as_tensor(
                    np.ascontiguousarray(np.asarray(cloud.sh_rest)[:, :sh_count, :]),
                    dtype=torch.float32,
                    device=self.device,
                )
            )
        self._pose_key: bytes | None = None
        self._world_means: Any = None
        self._world_cov: Any = None
        self._frame_rotation: Any = None  # (R_b R_l) as a device tensor, for SH view directions
        self._appearance: tuple[float, float, float] | None = None
        offsets = torch.arange(TILE_SIZE, dtype=torch.float32, device=self.device) + 0.5 - TILE_SIZE / 2
        local_y, local_x = torch.meshgrid(offsets, offsets, indexing="ij")
        local_x, local_y = local_x.reshape(-1), local_y.reshape(-1)
        # Pixel features [X^2, Y^2, XY, X, Y, 1] relative to the tile center (row-major pixels).
        self._pixel_features = torch.stack(
            (local_x * local_x, local_y * local_y, local_x * local_y, local_x, local_y, torch.ones_like(local_x)),
            dim=1,
        )

    # -- appearance -------------------------------------------------------------------------

    @property
    def appearance(self) -> tuple[float, float, float] | None:
        return self._appearance

    def set_appearance(self, hue_shift: float, saturation_scale: float, value_scale: float) -> None:
        """Set the HSV transform applied to every per-frame (view-dependent) Gaussian color."""
        values = (float(hue_shift), float(saturation_scale), float(value_scale))
        if not all(math.isfinite(value) for value in values):
            raise BackdropError("Backdrop appearance values must be finite.")
        self._appearance = values

    def reset_appearance(self) -> None:
        self._appearance = None

    # -- geometry ---------------------------------------------------------------------------

    def world_gaussians(self, body_rotation: np.ndarray, body_translation: np.ndarray) -> tuple[Any, Any]:
        """Return world means ``(N, 3)`` and covariances ``(N, 3, 3)`` for a body pose (cached)."""
        torch = self._torch
        rotation = np.asarray(body_rotation, dtype=np.float64).reshape(3, 3)
        translation = np.asarray(body_translation, dtype=np.float64).reshape(3)
        key = rotation.tobytes() + translation.tobytes()
        if key != self._pose_key:
            frame = rotation @ self._local_rotation  # R_b R_l, composed in float64
            with torch.no_grad():
                frame_t = torch.as_tensor(frame, dtype=torch.float32, device=self.device)
                translation_t = torch.as_tensor(translation, dtype=torch.float32, device=self.device)
                self._world_means = (self.scale * self._positions) @ frame_t.T + translation_t
                factor = self.scale * torch.matmul(frame_t, self._local_factor)
                self._world_cov = factor @ factor.transpose(1, 2)
                self._frame_rotation = frame_t
            self._pose_key = key
        return self._world_means, self._world_cov

    def _view_colors(self, index: Any, means: Any, camera_center: Any) -> Any:
        """Per-frame RGB of Gaussians ``index`` (world ``means``) seen from ``camera_center``."""
        torch = self._torch
        colors = self._dc_colors[index]
        if self._sh_rest is not None:
            directions = means - camera_center
            directions = directions / torch.linalg.vector_norm(directions, dim=1, keepdim=True).clamp_min(1e-12)
            # Row form of dir_local = (R_b R_l)^T dir_world.
            local = directions @ self._frame_rotation
            basis = sh_basis_torch(torch, local, self.sh_degree)  # (G, K)
            colors = colors + torch.bmm(basis[:, None, :], self._sh_rest[index]).squeeze(1)
        colors = colors.clamp_min(0.0)
        if self._appearance is not None:
            colors = shift_colors_hsv_torch(torch, colors, *self._appearance)
        return colors

    def view_colors(
        self, camera: BackdropCamera, body_rotation: np.ndarray, body_translation: np.ndarray
    ) -> np.ndarray:
        """Per-Gaussian ``(N, 3)`` colors (SH + appearance) for a camera and body pose."""
        torch = self._torch
        with torch.no_grad():
            means, _ = self.world_gaussians(body_rotation, body_translation)
            center = torch.as_tensor(_camera_center(camera), dtype=torch.float32, device=self.device)
            index = torch.arange(self.gaussian_count, device=self.device)
            return self._view_colors(index, means, center).cpu().numpy()

    # -- rendering --------------------------------------------------------------------------

    def render(
        self,
        camera: BackdropCamera,
        body_rotation: np.ndarray,
        body_translation: np.ndarray,
        native_rgb: np.ndarray,
        native_depth: np.ndarray,
    ) -> np.ndarray:
        width, height = int(camera.width), int(camera.height)
        rgb = np.asarray(native_rgb)
        depth = np.asarray(native_depth)
        if rgb.shape != (height, width, 3) or depth.shape != (height, width):
            raise BackdropError("Native RGB/depth images do not match the backdrop camera size.")
        torch = self._torch
        # The quadratic-form matmul needs full float32 (TF32 would visibly distort footprints).
        precision = torch.get_float32_matmul_precision()
        if precision != "highest":
            torch.set_float32_matmul_precision("highest")
        try:
            return self._render(camera, body_rotation, body_translation, rgb, depth)
        finally:
            if precision != "highest":
                torch.set_float32_matmul_precision(precision)

    def _render(
        self,
        camera: BackdropCamera,
        body_rotation: np.ndarray,
        body_translation: np.ndarray,
        rgb: np.ndarray,
        depth: np.ndarray,
    ) -> np.ndarray:
        torch = self._torch
        with torch.no_grad():
            means, covariances = self.world_gaussians(body_rotation, body_translation)
            native_rgb_t = torch.as_tensor(rgb, device=self.device).to(torch.float32) / 255.0
            native_depth_t = torch.as_tensor(depth, dtype=torch.float32, device=self.device)
            color, transmittance = self._rasterize(camera, means, covariances, native_depth_t)
            image = color + transmittance[..., None] * native_rgb_t
            return torch.round(image.clamp(0.0, 1.0) * 255.0).to(torch.uint8).cpu().numpy()

    def _project(self, camera: BackdropCamera, means: Any, covariances: Any) -> Any | None:
        """Project, cull, and depth-sort Gaussians. Returns packed per-Gaussian attributes."""
        torch = self._torch
        device = self.device
        width, height = camera.width, camera.height
        rotation = torch.as_tensor(camera.rotation, dtype=torch.float32, device=device)
        translation = torch.as_tensor(camera.translation, dtype=torch.float32, device=device)
        points = means @ rotation.T + translation
        z = points[:, 2]
        keep = z > max(float(camera.near), NEAR_EPSILON)
        keep_index = torch.nonzero(keep).squeeze(1)
        if keep_index.numel() == 0:
            return None
        points = points[keep_index]
        z = points[:, 2]
        x, y = points[:, 0], points[:, 1]
        fx, fy, cx, cy = camera.fx, camera.fy, camera.cx, camera.cy
        # Clamp the Jacobian's linearization point to a 1.3x frustum guard band (as in 3DGS).
        lim_left, lim_right = 1.3 * cx / fx, 1.3 * (width - cx) / fx
        lim_top, lim_bottom = 1.3 * cy / fy, 1.3 * (height - cy) / fy
        tx = torch.clamp(x / z, -lim_left, lim_right) * z
        ty = torch.clamp(y / z, -lim_top, lim_bottom) * z
        zero = torch.zeros_like(z)
        jacobian = torch.stack(
            (
                torch.stack((fx / z, zero, -fx * tx / (z * z)), dim=1),
                torch.stack((zero, fy / z, -fy * ty / (z * z)), dim=1),
            ),
            dim=1,
        )  # (G, 2, 3)
        transform = jacobian @ rotation  # J W
        cov = transform @ covariances[keep_index] @ transform.transpose(1, 2)
        cov_a = cov[:, 0, 0] + 0.3
        cov_b = cov[:, 0, 1]
        cov_c = cov[:, 1, 1] + 0.3
        determinant = cov_a * cov_c - cov_b * cov_b
        middle = 0.5 * (cov_a + cov_c)
        lambda_max = middle + torch.sqrt(torch.clamp(middle * middle - determinant, min=0.1))
        radius = torch.ceil(3.0 * torch.sqrt(lambda_max))
        u = fx * x / z + cx
        v = fy * y / z + cy
        tiles_x = (width + TILE_SIZE - 1) // TILE_SIZE
        tiles_y = (height + TILE_SIZE - 1) // TILE_SIZE
        # Bounding boxes in pixel-center space, converted to tile ranges [lo, hi).
        tile_x0 = torch.clamp(torch.floor((u - radius) / TILE_SIZE), 0, tiles_x)
        tile_x1 = torch.clamp(torch.floor((u + radius) / TILE_SIZE) + 1, 0, tiles_x)
        tile_y0 = torch.clamp(torch.floor((v - radius) / TILE_SIZE), 0, tiles_y)
        tile_y1 = torch.clamp(torch.floor((v + radius) / TILE_SIZE) + 1, 0, tiles_y)
        log_opacity = self._log_opacity[keep_index]
        visible = (
            (determinant > 0)
            & (tile_x1 > tile_x0)
            & (tile_y1 > tile_y0)
            & (log_opacity >= math.log(ALPHA_MIN))
            & torch.isfinite(u)
            & torch.isfinite(v)
        )
        selected = torch.nonzero(visible).squeeze(1)
        if selected.numel() == 0:
            return None
        order = torch.argsort(z[selected], stable=True)
        selected = selected[order]
        inverse_det = 1.0 / determinant[selected]
        conic_a = cov_c[selected] * inverse_det
        conic_b = -cov_b[selected] * inverse_det
        conic_c = cov_a[selected] * inverse_det
        gaussian_index = keep_index[selected]
        center = torch.as_tensor(_camera_center(camera), dtype=torch.float32, device=device)
        colors = self._view_colors(gaussian_index, means[gaussian_index], center)
        packed = torch.stack(
            (
                u[selected],
                v[selected],
                conic_a,
                conic_b,
                conic_c,
                log_opacity[selected],
                z[selected],
                colors[:, 0],
                colors[:, 1],
                colors[:, 2],
                torch.ones_like(conic_a),
            ),
            dim=1,
        )
        tiles = torch.stack(
            (tile_x0[selected], tile_x1[selected], tile_y0[selected], tile_y1[selected]), dim=1
        ).to(torch.int64)
        return packed, tiles

    def _rasterize(self, camera: BackdropCamera, means: Any, covariances: Any, native_depth: Any) -> tuple[Any, Any]:
        torch = self._torch
        threshold_ = torch.nn.functional.threshold_
        device = self.device
        width, height = camera.width, camera.height
        tiles_x = (width + TILE_SIZE - 1) // TILE_SIZE
        tiles_y = (height + TILE_SIZE - 1) // TILE_SIZE
        tile_count = tiles_x * tiles_y
        pixels = TILE_SIZE * TILE_SIZE
        color = torch.zeros((height, width, 3), dtype=torch.float32, device=device)
        transmittance = torch.ones((height, width), dtype=torch.float32, device=device)
        projected = self._project(camera, means, covariances)
        if projected is None:
            return color, transmittance
        packed, tiles = projected

        # --- tile binning: (tile, depth)-ordered pair list -------------------------------
        span_x = tiles[:, 1] - tiles[:, 0]
        span_y = tiles[:, 3] - tiles[:, 2]
        per_gaussian = span_x * span_y
        pair_count = int(per_gaussian.sum().item())
        if pair_count > self._max_pairs:
            raise BackdropError(
                f"Backdrop splat covers {pair_count} Gaussian/tile pairs at {width}x{height}, "
                f"above the {self._max_pairs} pair limit for this XPU device."
            )
        gaussian_ids = torch.repeat_interleave(
            torch.arange(len(packed), device=device), per_gaussian, output_size=pair_count
        )
        first_pair = torch.cumsum(per_gaussian, 0) - per_gaussian
        local = torch.arange(pair_count, device=device) - first_pair[gaussian_ids]
        pair_span_x = span_x[gaussian_ids]
        pair_tile = (tiles[gaussian_ids, 2] + local // pair_span_x) * tiles_x + (
            tiles[gaussian_ids, 0] + local % pair_span_x
        )
        # Gaussians are already depth-sorted, so a stable sort by tile keeps depth order per tile.
        pair_tile, pair_order = torch.sort(pair_tile, stable=True)
        pair_gaussian = gaussian_ids[pair_order]
        del gaussian_ids, local, pair_span_x, first_pair, pair_order
        tile_index = torch.arange(tile_count, device=device)
        tile_start = torch.searchsorted(pair_tile, tile_index)
        tile_end = torch.searchsorted(pair_tile, tile_index, right=True)
        tile_pairs = tile_end - tile_start

        # --- per-tile pixel data (padded to whole tiles) ----------------------------------
        padded_h, padded_w = tiles_y * TILE_SIZE, tiles_x * TILE_SIZE
        depth_tiles = torch.full((padded_h, padded_w), -math.inf, dtype=torch.float32, device=device)
        depth_tiles[:height, :width] = torch.nan_to_num(native_depth, nan=math.inf)
        depth_tiles = (
            depth_tiles.reshape(tiles_y, TILE_SIZE, tiles_x, TILE_SIZE).permute(0, 2, 1, 3).reshape(tile_count, pixels)
        )
        tile_max_depth = depth_tiles.max(dim=1).values
        tile_center_x = (tile_index % tiles_x).to(torch.float32) * TILE_SIZE + TILE_SIZE / 2
        tile_center_y = (tile_index // tiles_x).to(torch.float32) * TILE_SIZE + TILE_SIZE / 2

        tile_color = torch.zeros((tile_count, pixels, 3), dtype=torch.float32, device=device)
        tile_transmittance = torch.ones((tile_count, pixels), dtype=torch.float32, device=device)
        # Per-pixel stop threshold on the chunk-relative log transmittance; +inf once a pixel stops.
        # Padding pixels outside the image never contribute and never hold a tile open.
        tile_stop = torch.where(
            torch.isneginf(depth_tiles), math.inf, math.log(TRANSMITTANCE_MIN)
        ).to(torch.float32)
        pointer = torch.zeros(tile_count, dtype=torch.int64, device=device)
        active = torch.nonzero(tile_pairs > 0).squeeze(1)
        features = self._pixel_features
        last_pair = max(pair_count - 1, 0)

        # Tiles per step: at least the minimum chunk depth must fit the element budget.
        max_group = max(1, self._chunk_elements // (pixels * _MIN_CHUNK))

        def composite(active: Any) -> Any:
            """Composite the next depth-ordered chunk of each tile in ``active``; return survivors."""
            active_count = int(active.numel())
            chunk = int(self._chunk_elements // (active_count * pixels))
            chunk = min(_MAX_CHUNK, max(_MIN_CHUNK, 1 << max(chunk.bit_length() - 1, 0)))
            offsets = torch.arange(chunk, device=device)
            pair_index = (tile_start[active] + pointer[active])[:, None] + offsets  # (A, K)
            valid = pair_index < tile_end[active][:, None]
            attributes = packed[pair_gaussian[pair_index.clamp(max=last_pair)]]  # (A, K, 11)
            du = attributes[..., 0] - tile_center_x[active][:, None]
            dv = attributes[..., 1] - tile_center_y[active][:, None]
            conic_a, conic_b, conic_c = attributes[..., 2], attributes[..., 3], attributes[..., 4]
            log_opacity = attributes[..., 5]
            gaussian_depth = attributes[..., 6]
            constant = -0.5 * (conic_a * du * du + conic_c * dv * dv) - conic_b * du * dv + log_opacity
            # Padding entries past a tile's list get alpha = exp(-1e4) = 0.
            constant = torch.where(valid, constant, -1e4)
            coefficients = torch.stack(
                (
                    -0.5 * conic_a,
                    -0.5 * conic_c,
                    -conic_b,
                    conic_a * du + conic_b * dv,
                    conic_c * dv + conic_b * du,
                    constant,
                ),
                dim=1,
            )  # (A, 6, K)
            # alpha = min(0.99, opacity * exp(power)); the conic is positive definite
            # (det > 0, 0.3 px dilation), so power <= 0 up to rounding.
            alpha = torch.matmul(features, coefficients).exp_().clamp_(max=ALPHA_MAX)  # (A, 256, K)
            threshold_(alpha, _ALPHA_SKIP, 0.0)  # skip alpha < 1/255
            log_one_minus = torch.log1p(alpha.neg())
            # Per-pixel occlusion: Gaussians are depth-sorted, so the ones at or behind the native
            # surface form a suffix starting at visible_count. A -1e30 log-transmittance step at
            # that index makes the stop test below mask the whole suffix (and marks the pixel
            # done: every later Gaussian in this tile is occluded at that pixel too).
            sorted_depth = torch.where(valid, gaussian_depth, math.inf)
            visible_count = torch.searchsorted(sorted_depth, depth_tiles[active])  # (A, 256)
            occluded = visible_count < chunk
            log_one_minus.scatter_add_(
                2,
                visible_count.clamp(max=chunk - 1)[:, :, None],
                torch.where(occluded, -1e30, 0.0)[:, :, None],
            )
            log_transmittance = torch.cumsum(log_one_minus, dim=2)  # inclusive, chunk-relative
            stop_threshold = tile_stop[active][:, :, None]
            # Transmittance only decreases, so "T below 1e-4" also selects a suffix.
            masked = log_transmittance < stop_threshold
            any_stopped = masked[:, :, -1]
            # weight_k = alpha_k * T_{k-1} = alpha_k * exp(L_k - log(1 - alpha_k))
            weight = log_transmittance.sub_(log_one_minus).exp_().mul_(alpha).masked_fill_(masked, 0.0)
            del alpha, masked, log_transmittance, log_one_minus
            # A trailing ones column yields sum(weight) = 1 - T_final (telescoping), so the
            # chunk transmittance at the stop point needs no extra reduction.
            chunk_color = torch.matmul(weight, attributes[..., 7:11])  # (A, 256, 4)
            del weight
            chunk_t = torch.clamp(1.0 - chunk_color[..., 3], min=0.0)

            previous_t = tile_transmittance[active]
            tile_color[active] += previous_t[:, :, None] * chunk_color[..., :3]
            tile_transmittance[active] = previous_t * chunk_t
            next_stop = torch.where(
                any_stopped,
                math.inf,
                stop_threshold[:, :, 0] - torch.log(torch.clamp(chunk_t, min=1e-30)),
            )
            tile_stop[active] = next_stop
            pointer[active] += chunk

            remaining = pointer[active] < tile_pairs[active]
            open_pixels = torch.isfinite(next_stop).any(dim=1)
            next_index = (tile_start[active] + pointer[active]).clamp(max=last_pair)
            next_depth = packed[pair_gaussian[next_index], 6]
            reachable = next_depth < tile_max_depth[active]
            return active[remaining & open_pixels & reachable]

        while active.numel() > 0:
            active = torch.cat([composite(group) for group in torch.split(active, max_group)])

        color = (
            tile_color.reshape(tiles_y, tiles_x, TILE_SIZE, TILE_SIZE, 3)
            .permute(0, 2, 1, 3, 4)
            .reshape(padded_h, padded_w, 3)[:height, :width]
        )
        transmittance = (
            tile_transmittance.reshape(tiles_y, tiles_x, TILE_SIZE, TILE_SIZE)
            .permute(0, 2, 1, 3)
            .reshape(padded_h, padded_w)[:height, :width]
        )
        return color, transmittance
