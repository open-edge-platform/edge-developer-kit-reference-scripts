# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""MuseTalk-convention face crop boxes for avatar directories.

MuseTalk's UNet regenerates the lower half of its 256x256 crop, so it was
trained on landmark-derived boxes with the nose bridge (landmark 29) exactly
on the crop's vertical midline (musetalk/utils/preprocessing.py):

    x1, x2 = min/max landmark x           (face silhouette width)
    y2     = max landmark y + margin      (just below the chin)
    y1     = nose_y - (chin_y - nose_y)   (nose mirrored -> nose at center)

Feeding it the wav2lip avatars' raw s3fd detector boxes shifts the generated
mouth/jaw away from the real one, so each avatar gets its own MuseTalk coords,
computed once with the bundled FAN landmark model and cached in the avatar
directory. PyTorch is only imported for this one-time preparation.
"""

import pickle  # nosec B403 -- writing/reading our own coordinate cache
import sys
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


def ensure_musetalk_coords(avatar_path, device="cpu"):
    """(y1, y2, x1, x2) MuseTalk crop boxes for every avatar frame, cached as
    musetalk_coords.pkl next to the avatar images."""
    coords_path = Path(avatar_path) / COORDS_FILENAME
    if coords_path.exists():
        from modules.lipsync.lipsync_avatar import safe_pickle_load

        return safe_pickle_load(coords_path)

    coords = _compute_musetalk_coords(avatar_path, device)
    try:
        with open(coords_path, "wb") as f:
            pickle.dump(coords, f)
    except OSError as e:
        getLogger(__file__).warning(f"Could not cache MuseTalk coords: {e}")
    return coords


def _compute_musetalk_coords(avatar_path, device):
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

    torch_device = _torch_device(device)
    detector = FaceAlignment(LandmarksType._2D, flip_input=False, device=torch_device)
    # The published 2DFAN4 archive is a TorchScript module.
    fan = load_url(FAN_WEIGHTS_URL, map_location="cpu")
    fan.to(torch_device).eval()

    coords, last_box = [], None
    for frame in tqdm(frames):
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

    del detector, fan
    log.info(f"MuseTalk crop boxes ready ({len(coords)} frames).")
    return coords


def _fan_landmarks(frame_bgr, box, fan, torch_device, fa_crop, get_preds_fromhm):
    """68-point landmarks for one face, following face_alignment's pipeline:
    center/scale from the detector box, 256x256 crop, FAN heatmaps, decoded
    back to image coordinates."""
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
