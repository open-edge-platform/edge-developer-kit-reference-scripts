# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""OpenVINO backend for the RIFE (IFNet) frame interpolator."""

import math
import os
import secrets
import shutil
import time

import numpy as np
import openvino as ov
from worker_common import get_logger, models_dir, shared_model_lock, staged_model_file
from worker_common.devices import (
    AUTO_DEVICE,
    openvino_compile_config,
    openvino_execution_device,
)

logger = get_logger(__name__)

# Under <repo>/models/rife: shared between instances, emptied by the app's "Clear model cache".
DEFAULT_MODEL_PATH = str(models_dir("rife", "flownet.safetensors"))


def download_rife_model(model_path=DEFAULT_MODEL_PATH, source="huggingface"):
    """Fetch the RIFE flownet safetensors weights if not already present."""
    if os.path.exists(model_path):
        return model_path

    # Another instance may be fetching the same file right now.
    with shared_model_lock(model_path):
        if os.path.exists(model_path):
            return model_path

        logger.info("Downloading RIFE frame generation model...")
        from model_downloader import fetch_file

        src = fetch_file(
            "TensorForger/RIFE-safetensors",
            "flownet.safetensors",
            os.path.dirname(model_path) or ".",
            source=source,
        )
        if os.path.abspath(src) != os.path.abspath(model_path):
            with staged_model_file(model_path) as staged:
                shutil.copy(src, staged)
    logger.info(f"RIFE model ready at {model_path}")
    return model_path


def convert_rife_to_openvino(model_path=DEFAULT_MODEL_PATH, output_path=None):
    """Convert the RIFE safetensors checkpoint to an OpenVINO IR (FP16).

    Returns the path to the .xml file, converting only if it does not exist.
    """
    if output_path is None:
        output_path = os.path.join(os.path.dirname(model_path), "rife_ov", "rife.xml")
    if os.path.exists(output_path):
        return output_path
    # Another instance may be converting the same file right now.
    with shared_model_lock(output_path):
        if not os.path.exists(output_path):
            _convert_rife(model_path, output_path)
    return output_path


def _convert_rife(model_path, output_path):
    logger.info(f"Converting RIFE model {model_path} to OpenVINO IR...")
    import torch
    from safetensors.torch import load_file

    from modules.interpolation_model import IFNet

    model = IFNet()
    model.load_state_dict(load_file(model_path))
    model.eval()

    example = torch.rand(1, 6, 256, 256)
    ov_model = ov.convert_model(model, example_input=example)

    # Batch, height and width vary at runtime (face crops vs full frames and
    # level-synchronous subdivision batches); only the 6 channels are fixed.
    for input_tensor in ov_model.inputs:
        shape = input_tensor.get_partial_shape()
        shape[0] = -1
        shape[2] = -1
        shape[3] = -1
        input_tensor.get_node().set_partial_shape(shape)
    ov_model.validate_nodes_and_infer_types()

    with staged_model_file(output_path) as staged:
        ov.save_model(ov_model, staged, compress_to_fp16=True)
    logger.info(f"Saved OpenVINO RIFE model: {output_path}")


class OpenVINOFrameGenerator:
    """RIFE (IFNet) frame interpolator running on OpenVINO (CPU/GPU/NPU).

    Frames are HxWx3 arrays in 0..255; see warm_up() and interpolate_gaps().
    """

    def __init__(self, device, model_path=DEFAULT_MODEL_PATH, max_batch=16):
        self.device = (device or AUTO_DEVICE).strip().upper()
        # The NPU driver only compiles this model at batch 1 (batch>=2 fails
        # with ZE_RESULT_ERROR_INVALID_ARGUMENT), so feed it one pair at a time.
        # AUTO only uses an NPU named in its priority list.
        self.max_batch = 1 if self.device.startswith("NPU") else max_batch
        # NPU has no dynamic shapes, and the GPU plugin accepts them but silently produces garbage
        # (RIFE's F.interpolate upsampling resolves to wrong sizes); static shapes match PyTorch to
        # ~70dB. So all but CPU compile static variants on demand, AUTO included: the device it
        # picks is only known once compiled.
        self.static_shapes = not self.device.startswith("CPU")
        # No startup CPU fallback under AUTO: warm_up() and the benchmark
        # time the device OpenVINO selected (see openvino_compile_config).
        self._config = openvino_compile_config(self.device)
        # The device OpenVINO reports compiling on (AUTO's pick); updated by every compile.
        self.execution_device = self.device

        xml_path = convert_rife_to_openvino(model_path)
        logger.info(
            f"Loading OpenVINO RIFE frame generation model on {self.device}"
        )
        self.core = ov.Core()
        self.model = self.core.read_model(xml_path)
        self._requests = {}
        if not self.static_shapes:
            compiled = self._compile(self.model)
            self._requests[None] = compiled.create_infer_request()

    def _compile(self, model):
        compiled = self.core.compile_model(model, self.device, self._config)
        self.execution_device = openvino_execution_device(compiled, self.device)
        return compiled

    def _get_request(self, n, h, w):
        """Infer request for a [n,6,h,w] input; compiles static shapes lazily."""
        if not self.static_shapes:
            return self._requests[None]
        key = (n, h, w)
        if key not in self._requests:
            start = time.perf_counter()
            model = self.model.clone()
            model.reshape([n, 6, h, w])
            compiled = self._compile(model)
            self._requests[key] = compiled.create_infer_request()
            logger.info(
                f"Compiled RIFE for shape [{n},6,{h},{w}] on "
                f"{self.execution_device} in {time.perf_counter() - start:.1f}s"
            )
        return self._requests[key]

    def _run_model(self, x):
        """[N,6,H,W] float32 -> [N,3,H,W] float32 midpoints via OpenVINO."""
        n, _, h, w = x.shape
        if not self.static_shapes:
            request = self._get_request(n, h, w)
            # Copy: the output tensor buffer is reused by the next infer call,
            # while interpolate_gaps keeps slices across model calls.
            return request.infer({0: x})[0].copy()

        outputs = []
        for lo in range(0, n, self.max_batch):
            chunk = x[lo : lo + self.max_batch]
            # Pad the batch up to a power of two so only log2(max_batch)+1
            # static variants ever get compiled per resolution.
            n_pad = 1 << max(0, (len(chunk) - 1).bit_length())
            if n_pad > len(chunk):
                pad = np.zeros((n_pad - len(chunk),) + chunk.shape[1:], np.float32)
                chunk = np.concatenate([chunk, pad])
            request = self._get_request(n_pad, h, w)
            outputs.append(
                request.infer({0: chunk})[0][: min(self.max_batch, n - lo)].copy()
            )
        return np.concatenate(outputs)

    def warm_up(self, image_size, timed_runs=3):
        """Warm up the model and return the measured seconds per interpolated frame."""
        logger.info("Warm up frame generation model")
        pair = np.concatenate(
            [
                np.ones((1, 3, image_size, image_size), np.float32),
                np.zeros((1, 3, image_size, image_size), np.float32),
            ],
            axis=1,
        )
        self._run_model(pair)

        times = []
        for _ in range(timed_runs):
            start = time.perf_counter()
            self._run_model(pair)
            times.append(time.perf_counter() - start)

        frame_time = sorted(times)[len(times) // 2]
        logger.info(
            f"RIFE frame generation: {frame_time:.6f}s per interpolated frame"
        )
        return frame_time

    def _frames_to_array(self, frames):
        """List of HxWx3 frames (0..255) -> [N,3,H',W'] float32 array in [0,1],
        padded so H' and W' are multiples of 32 (required by IFNet strides)."""
        batch = np.stack([frame.astype(np.float32) for frame in frames]) / 255.0
        t = np.ascontiguousarray(batch.transpose(0, 3, 1, 2))
        _, _, h, w = t.shape
        ph = (32 - h % 32) % 32
        pw = (32 - w % 32) % 32
        if ph or pw:
            t = np.pad(t, ((0, 0), (0, 0), (0, ph), (0, pw)))
        return t

    def _array_to_frames(self, t, h, w):
        """[N,3,H',W'] array in [0,1] -> list of HxWx3 float32 frames (0..255)."""
        arr = t[:, :, :h, :w].clip(0, 1).transpose(0, 2, 3, 1) * 255.0
        return list(arr)

    def _midpoints(self, a, b):
        """Batched RIFE midpoints between frame pairs: [N,3,H,W] x2 -> [N,3,H,W]."""
        return self._run_model(np.concatenate([a, b], axis=1))

    def interpolate_gaps(self, gaps):
        """Fill each ``(frame_a, frame_b, n_frames)`` gap with ``n_frames`` interpolated frames.

        Level-synchronous binary subdivision: each pass batches the midpoints of every outstanding
        pair across all gaps; each gap then takes evenly spaced slots of its full tree.
        """
        h, w = gaps[0][0].shape[:2]
        a_batch = self._frames_to_array([gap[0] for gap in gaps])
        b_batch = self._frames_to_array([gap[1] for gap in gaps])

        totals, slots = [], []
        for _, _, n_frames in gaps:
            depth = max(1, math.ceil(math.log2(n_frames + 1)))
            totals.append(2**depth - 1)
            slots.append([None] * totals[-1])

        level = [
            (gi, a_batch[gi : gi + 1], b_batch[gi : gi + 1], 0, totals[gi])
            for gi in range(len(gaps))
        ]
        while level:
            mids = self._midpoints(
                np.concatenate([item[1] for item in level]),
                np.concatenate([item[2] for item in level]),
            )
            next_level = []
            for i, (gi, a, b, lo, hi) in enumerate(level):
                mid_slot = (lo + hi) // 2
                mid = mids[i : i + 1]
                slots[gi][mid_slot] = mid
                if mid_slot - lo > 0:
                    next_level.append((gi, a, mid, lo, mid_slot))
                if hi - (mid_slot + 1) > 0:
                    next_level.append((gi, mid, b, mid_slot + 1, hi))
            level = next_level

        results = []
        for gi, (_, _, n_frames) in enumerate(gaps):
            total = totals[gi]
            if n_frames == 1:
                indices = [total // 2]
            else:
                indices = [
                    round(i * (total - 1) / (n_frames - 1)) for i in range(n_frames)
                ]
            chosen = np.concatenate([slots[gi][i] for i in indices])
            results.append(self._array_to_frames(chosen, h, w))
        return results


def measure_framegen_fps(generator, image_size, gap_sizes, rounds=3):
    """Median interpolated frames/sec on a gap schedule; also compiles its static shapes."""
    frames = [
        np.frombuffer(
            secrets.token_bytes(image_size * image_size * 3), dtype=np.uint8
        )
        .reshape(image_size, image_size, 3)
        .astype(np.float32)
        for _ in range(len(gap_sizes) + 1)
    ]
    gaps = [(frames[i], frames[i + 1], n) for i, n in enumerate(gap_sizes)]

    generator.interpolate_gaps(gaps)
    times = []
    for _ in range(rounds):
        start = time.perf_counter()
        results = generator.interpolate_gaps(gaps)
        times.append(time.perf_counter() - start)

    produced = sum(len(r) for r in results)
    return produced / sorted(times)[len(times) // 2]
