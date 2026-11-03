# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""HTTP client for the frame generation worker, keeping the in-process interpolate_gaps() contract."""

import io
import os
import time

import numpy as np
import requests
from worker_common import resolve_service_address

from modules.base.logger import getLogger

# Which instance is running, and its address, can change while this worker
# runs, so a looked-up address is only trusted for a short while.
_ADDRESS_TTL_S = 10.0


class FrameGenerationClient:
    """Thin client over the frame generation service's binary npz API."""

    def __init__(self, base_url=None, timeout=30.0):
        # An explicit URL (--frame_gen_url or FRAME_GENERATION_URL) is used
        # as is; otherwise the running Frame Generation instance is looked up.
        fixed = base_url or os.environ.get("FRAME_GENERATION_URL")
        self._fixed_url = fixed.rstrip("/") if fixed else None
        self._resolved_url = None
        self._resolved_at = 0.0
        self.timeout = timeout
        self._session = requests.Session()

    @property
    def base_url(self):
        if self._fixed_url:
            return self._fixed_url
        if (
            self._resolved_url is None
            or time.monotonic() - self._resolved_at > _ADDRESS_TTL_S
        ):
            self._resolved_url = resolve_service_address("frame-generation")
            self._resolved_at = time.monotonic()
        if self._resolved_url is None:
            raise requests.ConnectionError(
                "Frame Generation is not added — no instance to call"
            )
        return self._resolved_url

    def is_ready(self):
        """True when the service is up and past model download/warmup."""
        try:
            resp = self._session.get(f"{self.base_url}/healthcheck", timeout=5.0)
            return resp.status_code == 200
        except requests.RequestException:
            return False

    def benchmark(self, image_size, gap_sizes, rounds=3):
        """Measured interpolated frames/sec on the given gap schedule; also warms the service.

        The first compile can take minutes on GPU/NPU, hence the 15-minute read timeout.
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
        """Fill keyframe gaps ``[(frame_a, frame_b, n_frames)]`` (HxWx3 in 0..255).

        Returns, per gap, n_frames interpolated HxWx3 float32 frames in 0..255.
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
    try:
        where = client.base_url
    except requests.RequestException:
        where = "any address (Frame Generation is not added)"
    getLogger(__file__).warning(
        f"Frame generation service is not reachable at {where}. "
        "Start the Frame Generation service (workers/services/frame-generation) to "
        "enable frame generation."
    )
    return None
