# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""HTTP client for the standalone frame generation worker.

The RIFE interpolator runs in its own service (workers/frame-generation) so
its device is configured independently of the lipsync worker. This client
keeps the in-process generator's interpolate_gaps() contract, so the lipsync
inference loop is agnostic to where interpolation actually runs.
"""

import io

import numpy as np
import requests

from modules.base.logger import getLogger

DEFAULT_FRAME_GEN_URL = "http://localhost:8031"


class FrameGenerationClient:
    """Thin client over the frame generation service's binary npz API."""

    def __init__(self, base_url=DEFAULT_FRAME_GEN_URL, timeout=30.0):
        self.base_url = (base_url or DEFAULT_FRAME_GEN_URL).rstrip("/")
        self.timeout = timeout
        self._session = requests.Session()

    def is_ready(self):
        """True when the service is up and past model download/warmup."""
        try:
            resp = self._session.get(f"{self.base_url}/healthcheck", timeout=5.0)
            return resp.status_code == 200
        except requests.RequestException:
            return False

    def benchmark(self, image_size, gap_sizes, rounds=3):
        """Measured interpolated frames/sec on the given gap schedule.

        The service also warms any lazily-compiled static shapes for the
        schedule, so benchmarking the production schedule doubles as warmup.
        Benchmarks compile + run the model, which can take minutes on
        GPU/NPU first time; no timeout is applied here.
        """
        resp = self._session.post(
            f"{self.base_url}/v1/frame-generation/benchmark",
            json={
                "image_size": image_size,
                "gap_sizes": list(gap_sizes),
                "rounds": rounds,
            },
            timeout=(5.0, 900.0),
        )
        resp.raise_for_status()
        return float(resp.json()["fps"])

    def interpolate_gaps(self, gaps):
        """
        Fill several keyframe gaps with interpolated frames.

        Same contract as OpenVINOFrameGenerator.interpolate_gaps:

        Args:
            gaps: list of (frame_a, frame_b, n_frames) tuples, frames as
                HxWx3 arrays in 0..255.

        Returns:
            list: for each gap, a list of n_frames interpolated HxWx3
            float32 frames in 0..255.
        """
        frames_a = np.stack([np.clip(a, 0, 255).astype(np.uint8) for a, _, _ in gaps])
        frames_b = np.stack([np.clip(b, 0, 255).astype(np.uint8) for _, b, _ in gaps])
        counts = np.array([n for _, _, n in gaps], dtype=np.int64)

        payload = io.BytesIO()
        np.savez(payload, frames_a=frames_a, frames_b=frames_b, counts=counts)

        resp = self._session.post(
            f"{self.base_url}/v1/frame-generation/interpolate",
            data=payload.getvalue(),
            headers={"Content-Type": "application/octet-stream"},
            timeout=self.timeout,
        )
        resp.raise_for_status()

        data = np.load(io.BytesIO(resp.content), allow_pickle=False)
        results = []
        for i in range(len(gaps)):
            fill = data[f"gap_{i}"]
            results.append([frame.astype(np.float32) for frame in fill])
        return results


def check_frame_gen_service(base_url):
    """Log a helpful message and return a ready client, or None if down."""
    client = FrameGenerationClient(base_url)
    if client.is_ready():
        return client
    getLogger(__file__).warning(
        f"Frame generation service is not reachable at {client.base_url}. "
        "Start the Frame Generation service (workers/frame-generation) to "
        "enable frame generation."
    )
    return None
