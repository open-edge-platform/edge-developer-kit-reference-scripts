# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Super-resolution on OpenVINO: checkpoint -> IR conversion, and tiled inference at static shapes.

Every compile is static: the NPU needs it, the GPU plugin is faster with it, and a Swin model only
exists at one shape. An image within the device's ``WHOLE`` budget runs in one call, at its size
rounded up to ``SHAPE_STEP`` (one compile per such size, cached); a larger one is cut into
``tile``-sized tiles that overlap by ``PAD`` input pixels on every side, so no tile edge shows in
the output.
"""

from __future__ import annotations

import time
from collections import OrderedDict
from pathlib import Path

import numpy as np
import openvino as ov
import openvino.opset13 as ops
from openvino.preprocess import PrePostProcessor
from worker_common import (
    AUTO_DEVICE,
    get_logger,
    openvino_compile_config,
    openvino_core,
    openvino_execution_device,
    shared_model_lock,
    staged_model_file,
)
from worker_common.devices import openvino_device_type
from worker_common.startup import startup_stage

from presets import Preset, checkpoint_path, ir_path, preset_dir

logger = get_logger(__name__)

# Context each tile borrows from its neighbours (input pixels), cropped off its output.
PAD = 16
# Whole-image shapes round up to this, which bounds the compiles a mix of image sizes costs.
SHAPE_STEP = 64
# Compiled shapes kept per worker: tiles, plus whole-image sizes most recently used.
MAX_COMPILED = 6
# Input side of one tile, per device type. A larger tile wastes less on overlap; past this
# size throughput stops rising (measured on a Core Ultra 9 285K, its iGPU and NPU, and an Arc Pro B60).
TILE = {"GPU": 512, "NPU": 256, "CPU": 256}
# Largest image (input pixels, padded) run in one call, per device type. One call skips the tiles'
# overlap and the grid's partial last row and column (an 800x600 image upscales 2x faster whole
# than as four 512-pixel tiles on an Arc iGPU; a 320x240 webcam frame 4-5x faster than as four
# 256-pixel tiles on the CPU), at one compile per image size. The NPU takes seconds to compile a
# size, so it runs whole only sizes that repeat: video and live frames.
WHOLE = {"GPU": 1024 * 1024, "NPU": 640 * 512, "CPU": 640 * 512}
# The one shape a static preset runs at. A tile takes 0.1 s (AuraSR) to 0.8 s (DAT2) on an Arc Pro
# B60, 5-6 s on a CPU.
STATIC_TILE = 256
# Side of the INT8 calibration tiles. Activation ranges do not depend on it, and quantizing
# x4plus on 256-pixel tiles took five minutes on a CPU.
CALIBRATION_SIDE = 128


def ensure_checkpoint(models_root: Path, preset: Preset) -> Path:
    """The preset's .pth (or Open Model Zoo .xml and .bin), downloaded and checked against its sha256."""
    from model_downloader import fetch_url

    target = checkpoint_path(models_root, preset)
    # fetch_url reports the download to the app itself, and keeps a file already there.
    if preset.omz:
        fetch_url(preset.url[: -len(".xml")] + ".bin", dest=target.with_suffix(".bin"), sha256=preset.bin_sha256)
    return fetch_url(preset.url, dest=target, sha256=preset.sha256)


def ensure_ir(models_root: Path, preset: Preset, precision: str, tile: int, calibration=None) -> Path:
    """The preset's IR at ``precision``, converted from the checkpoint on first use."""
    xml = ir_path(models_root, preset, precision, tile)
    if xml.exists():
        return xml
    # Another instance may be converting the same model right now.
    with shared_model_lock(xml):
        if not xml.exists():
            checkpoint = ensure_checkpoint(models_root, preset)
            with startup_stage("preparing", f"OpenVINO {precision.upper()} export of {preset.id}"):
                _convert(checkpoint, xml, preset, precision, tile, calibration)
    return xml


def _convert(checkpoint: Path, xml: Path, preset: Preset, precision: str, tile: int, calibration):
    started = time.perf_counter()
    if preset.omz:
        ov_model = _single_input(openvino_core().read_model(checkpoint), preset.scale)
    else:
        ov_model = _from_pytorch(checkpoint, preset, tile)
    if precision == "int8":
        ov_model = _quantize(ov_model, calibration)
    with staged_model_file(xml) as staged:
        ov.save_model(ov_model, staged, compress_to_fp16=True)
    logger.info(f"Converted {checkpoint.name} to {xml} in {time.perf_counter() - started:.0f}s")


def _from_pytorch(checkpoint: Path, preset: Preset, tile: int):
    import torch
    from spandrel import ModelLoader

    descriptor = ModelLoader().load_from_file(str(checkpoint))
    if descriptor.scale != preset.scale:
        raise ValueError(f"{checkpoint.name} upscales x{descriptor.scale}, the preset says x{preset.scale}")
    side = tile if preset.static else 64
    model = descriptor.model.eval()
    if descriptor.architecture.id == "AuraSR":
        # Tracing reads every attribute, and one property needs the training sizes spandrel
        # leaves unset; the forward pass takes any size.
        model.input_image_size, model.image_size = 64, 256
    with torch.no_grad():
        return ov.convert_model(
            model,
            example_input=torch.rand(1, 3, side, side),
            input=[1, 3, side, side] if preset.static else [1, 3, -1, -1],
        )


def _single_input(model, scale: int):
    """An Open Model Zoo super-resolution IR with the PyTorch models' interface.

    It takes the image twice, as is and bicubic-upscaled, both BGR in 0..255, and answers BGR in
    0..1. The upscale (OpenCV's bicubic, which it was trained with) and the colour order move into
    the graph: one RGB 0..1 input of any size, as the converted checkpoints take.
    """
    image = ops.parameter([1, 3, -1, -1], np.float32, name="image")
    bgr_order = ops.constant(np.array([2, 1, 0], np.int64))
    channels = ops.constant(np.int64(1))
    bgr = ops.gather(ops.multiply(image, np.float32(255.0)), bgr_order, channels)
    bicubic = ops.interpolate(
        bgr,
        ops.constant(np.array([scale, scale], np.float32)),
        mode="cubic",
        shape_calculation_mode="scales",
        axes=ops.constant(np.array([2, 3], np.int64)),
        coordinate_transformation_mode="half_pixel",
        cube_coeff=-0.75,
    )
    for parameter, value in zip((p.get_node() for p in model.inputs), (bgr, bicubic), strict=True):
        for target in list(parameter.output(0).get_target_inputs()):
            target.replace_source_output(value.output(0))
    rgb = ops.gather(model.outputs[0].get_node().input_value(0), bgr_order, channels)
    return ov.Model([ops.result(rgb)], [image], model.get_friendly_name())


def _quantize(ov_model, calibration):
    """INT8 weights and activations (NNCF post-training quantization) from calibration tiles.

    Only the dynamic-shape models get here (``Preset.int8``)."""
    import nncf

    tiles = calibration(CALIBRATION_SIDE) if calibration else []
    if not tiles:
        raise RuntimeError("INT8 needs calibration tiles, and none were given")
    ov_model.reshape([1, 3, CALIBRATION_SIDE, CALIBRATION_SIDE])
    quantized = nncf.quantize(
        ov_model,
        nncf.Dataset(tiles),
        preset=nncf.QuantizationPreset.MIXED,
        subset_size=len(tiles),
    )
    quantized.reshape([1, 3, -1, -1])
    return quantized


def _with_u8_io(model):
    """uint8 NHWC in and out, so scaling, clamping and the layout change run in the graph and a
    transfer moves a quarter of the bytes. +0.5 before the conversion rounds to nearest."""
    ppp = PrePostProcessor(model)
    ppp.input().tensor().set_element_type(ov.Type.u8).set_layout(ov.Layout("NHWC"))
    ppp.input().model().set_layout(ov.Layout("NCHW"))
    ppp.input().preprocess().convert_element_type(ov.Type.f32).scale(255.0)
    ppp.output().model().set_layout(ov.Layout("NCHW"))
    ppp.output().tensor().set_layout(ov.Layout("NHWC")).set_element_type(ov.Type.u8)
    ppp.output().postprocess().custom(
        lambda node: ops.clamp(
            ops.add(ops.multiply(node, np.float32(255.0)), np.float32(0.5)), 0.0, 255.0
        ).output(0)
    )
    return ppp.build()


def _pad_to(image: np.ndarray, top: int, bottom: int, left: int, right: int) -> np.ndarray:
    # Mirrored edges give the border tiles natural context; numpy repeats the reflection when the
    # padding is wider than the image.
    mode = "reflect" if min(image.shape[:2]) > 1 else "edge"
    return np.pad(image, ((top, bottom), (left, right), (0, 0)), mode=mode)


def _round_up(value: int, step: int) -> int:
    return -(-value // step) * step


class Upscaler:
    """One preset compiled for one device. Not thread-safe: callers serialise ``upscale``."""

    def __init__(self, models_root: Path, preset: Preset, device: str, precision: str, calibration=None):
        self.preset = preset
        self.scale = preset.scale
        self.device = (device or AUTO_DEVICE).strip().upper()
        kind = openvino_device_type(self.device.split(".", 1)[0])
        # The app offers these FP16 only.
        if precision == "int8" and not preset.int8:
            logger.warning(f"{preset.id} has no INT8 export; using FP16")
            precision = "fp16"
        self.precision = precision
        # AUTO is sized for the GPU it normally selects.
        self.tile = STATIC_TILE if preset.static else TILE.get(kind, TILE["GPU"])
        self._whole = 0 if preset.static else WHOLE.get(kind, WHOLE["GPU"])
        self._slow_compile = kind == "NPU"
        # The NPU runs the float graph faster than one converting uint8 itself (-17%).
        self._u8_io = kind != "NPU"
        # Only the CPU gains from several tiles in flight (+30-45%); a GPU or NPU is busy with one.
        self._parallel_tiles = kind == "CPU"
        self._config = openvino_compile_config(
            self.device, model_dir=preset_dir(models_root, preset) / f"openvino-{precision}"
        )
        self.execution_device = self.device
        xml = ensure_ir(models_root, preset, precision, self.tile, calibration)
        self._core = openvino_core()
        self._model = self._core.read_model(xml)
        # (h, w, parallel) -> (compiled model, its requests), least recently used first.
        self._compiled: OrderedDict[tuple[int, int, bool], tuple[ov.CompiledModel, ov.AsyncInferQueue]] = OrderedDict()

    def _requests_for(self, h: int, w: int, tiles: bool = False) -> ov.AsyncInferQueue:
        """Requests for one [1, 3, h, w] input: several for ``tiles`` on the CPU, else one."""
        parallel = tiles and self._parallel_tiles
        key = (h, w, parallel)
        if key in self._compiled:
            self._compiled.move_to_end(key)
            return self._compiled[key][1]
        started = time.perf_counter()
        model = self._model.clone()
        if not self.preset.static:
            model.reshape([1, 3, h, w])
        if self._u8_io:
            model = _with_u8_io(model)
        # A whole image is one call: THROUGHPUT would give it a fraction of the CPU's cores.
        config = {"PERFORMANCE_HINT": "THROUGHPUT" if parallel else "LATENCY", **self._config}
        compiled = self._core.compile_model(model, self.device, config)
        self.execution_device = openvino_execution_device(compiled, self.device)
        logger.info(
            f"Compiled {self.preset.id} for {w}x{h} on {self.execution_device} "
            f"in {time.perf_counter() - started:.1f}s"
        )
        # 0 is the device's optimal number of requests for the hint.
        requests = ov.AsyncInferQueue(compiled, 0 if parallel else 1)
        self._compiled[key] = (compiled, requests)
        while len(self._compiled) > MAX_COMPILED:
            self._compiled.popitem(last=False)
        return requests

    def _to_input(self, patch: np.ndarray) -> np.ndarray:
        if self._u8_io:
            return np.ascontiguousarray(patch[None])
        return np.ascontiguousarray(patch.transpose(2, 0, 1)[None], dtype=np.float32) / 255.0

    def _from_output(self, out: np.ndarray) -> np.ndarray:
        if self._u8_io:
            return out[0]
        return (out[0].transpose(1, 2, 0) * 255.0 + 0.5).clip(0, 255).astype(np.uint8)

    def _infer_one(self, h: int, w: int, patch: np.ndarray) -> np.ndarray:
        request = self._requests_for(h, w)[0]
        request.infer({0: self._to_input(patch)})
        # A copy: the next inference reuses the request's output buffer.
        return self._from_output(request.get_output_tensor(0).data).copy()

    def warm_up(self) -> float:
        """Compile the tile shape and run every request twice; returns seconds per tile.

        Each request's first inference is slow (~10x on the CPU): the first image must not pay
        for it. The second round is timed.
        """
        queue = self._requests_for(self.tile, self.tile, tiles=True)
        queue.set_callback(lambda request, userdata: None)
        tile = self._to_input(np.zeros((self.tile, self.tile, 3), np.uint8))
        for _ in range(2):
            started = time.perf_counter()
            for _ in range(len(queue)):
                queue.start_async({0: tile})
            queue.wait_all()
        seconds = (time.perf_counter() - started) / len(queue)
        logger.info(f"{self.preset.id}: {seconds * 1000:.0f} ms per {self.tile}x{self.tile} tile, {len(queue)} at a time")
        return seconds

    def _runs_whole(self, h: int, w: int, repeated: bool) -> bool:
        if self._slow_compile and not repeated:
            return False
        return _round_up(h, SHAPE_STEP) * _round_up(w, SHAPE_STEP) <= self._whole

    def upscale(self, image: np.ndarray, progress=None, cancel=None, repeated=False) -> np.ndarray:
        """``image`` (H, W, 3 uint8 RGB) -> (H*scale, W*scale, 3 uint8 RGB).

        ``progress(done, total)`` runs after each tile; a cancelled ``cancel`` raises JobCancelled
        between tiles. ``repeated``: more images of this size will follow (video, live frames),
        which makes a compile for it worth its time on any device.
        """
        h, w = image.shape[:2]
        s = self.scale
        if self._runs_whole(h, w, repeated):
            ph, pw = _round_up(h, SHAPE_STEP), _round_up(w, SHAPE_STEP)
            out = self._infer_one(ph, pw, _pad_to(image, 0, ph - h, 0, pw - w))
            if cancel:
                cancel.check()
            if progress:
                progress(1, 1)
            return np.ascontiguousarray(out[: h * s, : w * s])

        t = self.tile
        stride = t - 2 * PAD
        rows, cols = -(-h // stride), -(-w // stride)
        padded = _pad_to(image, PAD, PAD + rows * stride - h, PAD, PAD + cols * stride - w)
        output = np.empty((rows * stride * s, cols * stride * s, 3), np.uint8)
        queue = self._requests_for(t, t, tiles=True)
        done = [0]
        total = rows * cols
        keep = slice(PAD * s, (PAD + stride) * s)

        def on_done(request, origin):
            y, x = origin
            out = self._from_output(request.get_output_tensor(0).data)
            output[y * s : (y + stride) * s, x * s : (x + stride) * s] = out[keep, keep]
            done[0] += 1

        queue.set_callback(on_done)
        try:
            for r in range(rows):
                for c in range(cols):
                    if cancel:
                        cancel.check()
                    y, x = r * stride, c * stride
                    queue.start_async({0: self._to_input(padded[y : y + t, x : x + t])}, (y, x))
                    if progress:
                        progress(done[0], total)
        finally:
            queue.wait_all()
        # A small image's tiles may all be in flight before a cancel arrives.
        if cancel:
            cancel.check()
        if progress:
            progress(total, total)
        return np.ascontiguousarray(output[: h * s, : w * s])
