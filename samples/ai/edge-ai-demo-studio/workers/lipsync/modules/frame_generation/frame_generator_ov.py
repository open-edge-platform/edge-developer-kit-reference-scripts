# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""OpenVINO backend for the RIFE (IFNet) frame interpolator."""

import math
import os
import time

import numpy as np
import openvino as ov

from modules.base.logger import getLogger

DEFAULT_MODEL_PATH = "models/rife/flownet.safetensors"


def convert_rife_to_openvino(model_path=DEFAULT_MODEL_PATH, output_path=None):
    """Convert the RIFE safetensors checkpoint to an OpenVINO IR (FP16).

    Returns the path to the .xml file, converting only if it does not exist.
    """
    if output_path is None:
        output_path = os.path.join(os.path.dirname(model_path), "rife_ov", "rife.xml")
    if os.path.exists(output_path):
        return output_path

    getLogger(__file__).info(f"Converting RIFE model {model_path} to OpenVINO IR...")
    import torch
    from safetensors.torch import load_file

    from modules.frame_generation.interpolation_model import IFNet

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

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    ov.save_model(ov_model, output_path, compress_to_fp16=True)
    getLogger(__file__).info(f"Saved OpenVINO RIFE model: {output_path}")
    return output_path


class OpenVINOFrameGenerator:
    """RIFE (IFNet) frame interpolator running on OpenVINO (CPU/GPU/NPU).

    Drop-in replacement for FrameGenerator: same warm_up() and
    interpolate_gaps() contract, frames as HxWx3 arrays in 0..255.
    """

    def __init__(self, device, model_path=DEFAULT_MODEL_PATH, max_batch=16):
        self.device = device.upper()
        # The NPU driver only compiles this model at batch 1 (batch>=2 fails
        # with ZE_RESULT_ERROR_INVALID_ARGUMENT), so feed it one pair at a time.
        self.max_batch = 1 if device.upper().startswith("NPU") else max_batch
        # NPU has no dynamic-shape support at all; the GPU plugin *accepts*
        # dynamic shapes for this model but silently produces garbage (RIFE's
        # F.interpolate-driven upsampling resolves to wrong spatial sizes),
        # while static shapes match PyTorch to ~70dB. So both compile static
        # variants on demand; only CPU keeps the single dynamic model.
        self.static_shapes = not self.device.startswith("CPU")

        xml_path = convert_rife_to_openvino(model_path)
        getLogger(__file__).info(
            f"Loading OpenVINO RIFE frame generation model on {self.device}"
        )
        self.core = ov.Core()
        self.model = self.core.read_model(xml_path)
        self._requests = {}
        if not self.static_shapes:
            compiled = self.core.compile_model(self.model, self.device)
            self._requests[None] = compiled.create_infer_request()

    def _get_request(self, n, h, w):
        """Infer request for a [n,6,h,w] input; compiles static shapes lazily."""
        if not self.static_shapes:
            return self._requests[None]
        key = (n, h, w)
        if key not in self._requests:
            start = time.perf_counter()
            model = self.model.clone()
            model.reshape([n, 6, h, w])
            compiled = self.core.compile_model(model, self.device)
            self._requests[key] = compiled.create_infer_request()
            getLogger(__file__).info(
                f"Compiled RIFE for shape [{n},6,{h},{w}] on {self.device} "
                f"in {time.perf_counter() - start:.1f}s"
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
        getLogger(__file__).info("Warm up frame generation model")
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
        getLogger(__file__).info(
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
        """
        Fill several keyframe gaps with interpolated frames in batched passes.

        Same recursive, level-synchronous binary subdivision as
        FrameGenerator.interpolate_gaps; see that docstring for details.

        Args:
            gaps: list of (frame_a, frame_b, n_frames) tuples, where frames are
                HxWx3 arrays in 0..255 and n_frames is the number of
                intermediate frames to generate between them.

        Returns:
            list: for each gap, a list of n_frames interpolated HxWx3 frames.
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
