# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""MuseTalk-convention face crop boxes for avatar directories.

MuseTalk was trained on landmark boxes with the nose bridge on the crop's vertical midline
(musetalk/utils/preprocessing.py); wav2lip's s3fd boxes would shift the generated mouth. Boxes
are computed once with the bundled FAN model and cached in the avatar directory.
"""

import pickle  # nosec B403 -- writing/reading our own coordinate cache
import sys
import threading
from pathlib import Path

import numpy as np

from modules.base.logger import getLogger

# The wav2lip256 face_detection package imports itself as a top-level
# `face_detection` module, so its directory must be importable.
sys.path.append(str(Path(__file__).resolve().parents[1] / "wav2lip" / "wav2lip256"))

# 2DFAN4 weights from the face-alignment project (the bundled FAN network is
# vendored from it, so the state dict matches).
FAN_WEIGHTS_URL = (
    "https://www.adrianbulat.com/downloads/python-fan/2DFAN4-cd938726ad.zip"
)
EXTRA_MARGIN = 10  # MuseTalk v1.5 --extra_margin: extend the crop below the chin
COORDS_FILENAME = "musetalk_coords.pkl"


def ensure_musetalk_coords(avatar_path, device="cpu", on_progress=None, cancel=None):
    """(y1, y2, x1, x2) MuseTalk crop boxes for every avatar frame, cached as musetalk_coords.pkl.

    ``cancel`` is checked before the models load and before every frame; nothing is cached then.
    """
    coords_path = Path(avatar_path) / COORDS_FILENAME
    if coords_path.exists():
        from modules.lipsync.lipsync_avatar import safe_pickle_load

        return safe_pickle_load(coords_path)

    coords = _compute_musetalk_coords(avatar_path, device, on_progress, cancel)
    try:
        with open(coords_path, "wb") as f:
            pickle.dump(coords, f)
    except OSError as e:
        getLogger(__file__).warning(f"Could not cache MuseTalk coords: {e}")
    return coords


class CoordsJob:
    """One avatar's crop boxes being made, shared by everyone who needs them."""

    def __init__(self):
        self.done = 0
        self.total = 0
        self.coords = None
        self.error = None
        self.finished = threading.Event()

    def _progress(self, done, total):
        self.done, self.total = done, total

    def status(self):
        """``{status: preparing|ready|error, done, total[, detail]}``."""
        if not self.finished.is_set():
            return {"status": "preparing", "done": self.done, "total": self.total}
        if self.error is not None:
            return {"status": "error", "detail": str(self.error) or repr(self.error)}
        return {"status": "ready", "done": self.total, "total": self.total}

    def wait(self):
        """The crop boxes, once made; raises what making them raised."""
        self.finished.wait()
        if self.error is not None:
            raise self.error
        return self.coords


_running_jobs = {}
_running_jobs_lock = threading.Lock()


def musetalk_coords_job(avatar_path, device="cpu"):
    """The avatar's crop-box job under way, else a new one on its own thread (instant if cached).

    On CPU this takes minutes, longer than the app's proxy lets a connection wait.
    """
    key = str(Path(avatar_path).resolve())
    with _running_jobs_lock:
        job = _running_jobs.get(key)
        if job is None:
            job = CoordsJob()
            _running_jobs[key] = job
            threading.Thread(
                target=_run_coords_job,
                args=(job, key, device),
                name="musetalk-coords",
                daemon=True,
            ).start()
    return job


def _run_coords_job(job, avatar_path, device):
    try:
        job.coords = ensure_musetalk_coords(avatar_path, device, job._progress)
    except Exception as e:
        job.error = e
    finally:
        # Later callers read the cache (or try again after a failure).
        with _running_jobs_lock:
            _running_jobs.pop(avatar_path, None)
        job.finished.set()


def _compute_musetalk_coords(avatar_path, device, on_progress=None, cancel=None):
    import cv2
    import torch
    from torch.utils.model_zoo import load_url
    from tqdm import tqdm

    from modules.lipsync.lipsync_avatar import LipsyncAvatar
    from modules.lipsync.wav2lip.wav2lip_avatar_generator import _torch_device
    from modules.lipsync.wav2lip.wav2lip256.face_detection import (
        FaceAlignment,
        LandmarksType,
    )
    from modules.lipsync.wav2lip.wav2lip256.face_detection.utils import (
        crop as fa_crop,
        get_preds_fromhm,
    )

    log = getLogger(__file__)
    log.info(f"Computing MuseTalk face crop boxes for {avatar_path}...")

    frames = LipsyncAvatar._read_cv_images(f"{avatar_path}/full_images")
    if not frames:
        raise ValueError(f"No full_images found in {avatar_path}")

    if cancel is not None:
        cancel.check()
    torch_device = _torch_device(device)
    detector = FaceAlignment(LandmarksType._2D, flip_input=False, device=torch_device)
    # The published 2DFAN4 archive is a TorchScript module.
    fan = load_url(FAN_WEIGHTS_URL, map_location="cpu")
    fan.to(torch_device).eval()

    coords, last_box = [], None
    for index, frame in enumerate(tqdm(frames)):
        if cancel is not None:
            cancel.check()
        if on_progress:
            on_progress(index, len(frames))
        box = detector.get_detections_for_batch(np.asarray([frame]))[0]
        if box is None:
            if last_box is None:
                raise ValueError(
                    "Face not detected in the avatar's first frame; cannot "
                    "prepare MuseTalk crops."
                )
            coords.append(coords[-1])
            continue
        last_box = box

        landmarks = _fan_landmarks(
            frame, box, fan, torch_device, fa_crop, get_preds_fromhm
        )
        lm = landmarks.astype(np.int32)

        # musetalk/utils/preprocessing.py: nose bridge (landmark 29) mirrored
        # about the chin distance -> nose on the crop's vertical midline.
        nose_y = int(lm[29, 1])
        chin_y = int(lm[:, 1].max())
        y1 = max(0, nose_y - (chin_y - nose_y))
        y2 = min(chin_y + EXTRA_MARGIN, frame.shape[0])
        x1 = int(lm[:, 0].min())
        x2 = int(lm[:, 0].max())

        if y2 - y1 <= 0 or x2 - x1 <= 0 or x1 < 0:
            # Degenerate landmark box: fall back to the detector box, as the
            # reference does.
            x1, y1, x2, y2 = box
        coords.append((int(y1), int(y2), int(x1), int(x2)))

    if on_progress:
        on_progress(len(frames), len(frames))
    del detector, fan
    log.info(f"MuseTalk crop boxes ready ({len(coords)} frames).")
    return coords


def _fan_landmarks(frame_bgr, box, fan, torch_device, fa_crop, get_preds_fromhm):
    """68-point landmarks for one face, following face_alignment's crop/heatmap pipeline."""
    import torch

    x1, y1, x2, y2 = box
    center = torch.FloatTensor([(x2 + x1) / 2.0, (y2 + y1) / 2.0])
    center[1] = center[1] - (y2 - y1) * 0.12
    scale = (x2 - x1 + y2 - y1) / 195.0

    inp = fa_crop(frame_bgr[..., ::-1].copy(), center, scale)  # RGB crop
    inp = (
        torch.from_numpy(inp.transpose((2, 0, 1)))
        .float()
        .div(255.0)
        .unsqueeze(0)
        .to(torch_device)
    )
    with torch.no_grad():
        out = fan(inp)
    heatmaps = (out[-1] if isinstance(out, (list, tuple)) else out).detach().cpu()
    _, pts_img = get_preds_fromhm(heatmaps, center, scale)
    return pts_img.view(68, 2).numpy()
