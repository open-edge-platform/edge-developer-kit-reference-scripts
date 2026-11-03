# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""MuseTalk UNet inputs for an avatar: VAE(lower-half-masked face) ++ VAE(face) per frame.

Encoding takes minutes on CPU (~5.5 min for 128 frames), longer than the app's proxy lets the offer
wait, so like the crop boxes it runs as a shared job and is cached as musetalk_latents.npy.
"""

import threading
import time
from pathlib import Path

import cv2
import numpy as np

from modules.base.logger import getLogger
from modules.lipsync.musetalk.musetalk_face_prep import (
    COORDS_FILENAME,
    musetalk_coords_job,
)
from modules.lipsync.musetalk.musetalk_models import (
    FACE_SIZE,
    LATENT_SIZE,
    VAE_ENCODE_BATCH,
    get_shared_vae_encoder,
)

LATENTS_FILENAME = "musetalk_latents.npy"


def musetalk_face_crops(full_frames, coords_list):
    """Every frame's MuseTalk crop, resized to the face size the UNet takes."""
    return [
        cv2.resize(
            frame[y1:y2, x1:x2],
            (FACE_SIZE, FACE_SIZE),
            interpolation=cv2.INTER_LANCZOS4,
        )
        for frame, (y1, y2, x1, x2) in zip(full_frames, coords_list)
    ]


def cached_musetalk_latents(avatar_path, count):
    """The cached latents of ``count`` frames, or None if missing or older than the crop boxes."""
    cache_path = Path(avatar_path) / LATENTS_FILENAME
    coords_path = Path(avatar_path) / COORDS_FILENAME
    if not (
        cache_path.exists()
        and coords_path.exists()
        and cache_path.stat().st_mtime >= coords_path.stat().st_mtime
    ):
        return None
    try:
        latents = np.load(cache_path)
    except (OSError, ValueError) as e:
        # Cut short (a worker stopped while saving it): encode them again.
        getLogger(__file__).warning(f"Ignoring unreadable {cache_path}: {e}")
        return None
    if len(latents) != count:
        return None
    getLogger(__file__).info(f"Loaded cached MuseTalk latents from {cache_path}")
    return latents


def encode_musetalk_latents(face_frames, avatar_path, ov_device, on_progress=None):
    """Per-frame 8-channel UNet latents, cached next to the avatar images."""
    log = getLogger(__file__)
    n = len(face_frames)
    log.info(f"Encoding {n} avatar faces to MuseTalk latents...")
    start = time.perf_counter()
    if on_progress:
        on_progress(0, n)

    ref_imgs = np.empty((n, 3, FACE_SIZE, FACE_SIZE), dtype=np.float32)
    masked_imgs = np.empty_like(ref_imgs)
    for i, face in enumerate(face_frames):
        rgb = cv2.cvtColor(face, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        masked = rgb.copy()
        masked[FACE_SIZE // 2 :] = 0.0  # inpainted mouth region
        ref_imgs[i] = ((rgb - 0.5) / 0.5).transpose(2, 0, 1)
        masked_imgs[i] = ((masked - 0.5) / 0.5).transpose(2, 0, 1)

    entry = get_shared_vae_encoder(ov_device)
    compiled, request, lock = entry["model"], entry["request"], entry["lock"]

    # Channels 0-3: masked face, 4-7: whole face. Both halves of a batch finish before the next,
    # so progress counts finished frames.
    latents = np.empty((n, 8, LATENT_SIZE, LATENT_SIZE), dtype=np.float32)
    for s in range(0, n, VAE_ENCODE_BATCH):
        for channels, images in ((slice(0, 4), masked_imgs), (slice(4, 8), ref_imgs)):
            chunk = images[s : s + VAE_ENCODE_BATCH]
            valid = len(chunk)
            if valid < VAE_ENCODE_BATCH:
                chunk = np.concatenate(
                    [chunk, np.repeat(chunk[-1:], VAE_ENCODE_BATCH - valid, axis=0)]
                )
            with lock:
                result = request.infer({"images": chunk})[compiled.output(0)]
                latents[s : s + valid, channels] = result[:valid]
        if on_progress:
            on_progress(min(s + VAE_ENCODE_BATCH, n), n)
    log.info(f"Encoded avatar latents in {time.perf_counter() - start:.1f}s")

    cache_path = Path(avatar_path) / LATENTS_FILENAME
    try:
        np.save(cache_path, latents)
    except OSError as e:
        log.warning(f"Could not cache MuseTalk latents: {e}")
    return latents


class LatentsJob:
    """One avatar's latents being made (crop boxes first), shared like ``CoordsJob``."""

    def __init__(self):
        self.stage = "crops"
        self.coords_job = None
        self.done = 0
        self.total = 0
        self.latents = None
        self.error = None
        self.finished = threading.Event()

    def _progress(self, done, total):
        self.done, self.total = done, total

    def status(self):
        """``{status: preparing|ready|error, done, total[, stage][, detail]}``.

        While preparing, ``stage`` is ``crops`` then ``latents``; counts are that stage's frames.
        """
        if not self.finished.is_set():
            coords_job = self.coords_job
            if self.stage == "crops" and coords_job is not None:
                crops = coords_job.status()
                done, total = crops.get("done", 0), crops.get("total", 0)
            else:
                done, total = self.done, self.total
            return {
                "status": "preparing",
                "stage": self.stage,
                "done": done,
                "total": total,
            }
        if self.error is not None:
            return {"status": "error", "detail": str(self.error) or repr(self.error)}
        return {"status": "ready", "done": self.total, "total": self.total}

    def wait(self):
        """The latents, once made; raises what making them raised."""
        self.finished.wait()
        if self.error is not None:
            raise self.error
        return self.latents


_running_jobs = {}
_running_jobs_lock = threading.Lock()


def musetalk_latents_job(avatar_path, device="cpu"):
    """The avatar's latents job under way, else a new one on its own thread (instant if cached)."""
    key = str(Path(avatar_path).resolve())
    with _running_jobs_lock:
        job = _running_jobs.get(key)
        if job is None:
            job = LatentsJob()
            _running_jobs[key] = job
            threading.Thread(
                target=_run_latents_job,
                args=(job, key, device),
                name="musetalk-latents",
                daemon=True,
            ).start()
    return job


def _run_latents_job(job, avatar_path, device):
    try:
        job.coords_job = musetalk_coords_job(avatar_path, device)
        coords = job.coords_job.wait()
        job.stage = "latents"
        latents = cached_musetalk_latents(avatar_path, len(coords))
        if latents is None:
            from modules.lipsync.lipsync_avatar import LipsyncAvatar

            full_frames = LipsyncAvatar._read_cv_images(f"{avatar_path}/full_images")
            latents = encode_musetalk_latents(
                musetalk_face_crops(full_frames, coords),
                avatar_path,
                device.upper(),
                job._progress,
            )
        job.latents = latents
    except Exception as e:
        job.error = e
    finally:
        # Later callers read the cache (or try again after a failure).
        with _running_jobs_lock:
            _running_jobs.pop(avatar_path, None)
        job.finished.set()
