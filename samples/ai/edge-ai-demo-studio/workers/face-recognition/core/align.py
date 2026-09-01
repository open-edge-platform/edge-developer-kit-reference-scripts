# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Five-point face alignment.

Two flavours live here, one per recognition model family:

* :func:`norm_crop` — SFace's 112x112 ArcFace template applied to landmarks in
  source-image coordinates, via the Umeyama least-squares similarity transform
  (the same maths as OpenCV's ``FaceRecognizerSF::alignCrop``).
* :func:`align_roi_landmarks` — the Open Model Zoo variant, ported from the
  ``face_recognition_demo``'s ``FaceIdentifier._align_rois``: it warps an ROI
  crop in place using landmarks relative to that crop, keeping the crop's own
  size and aspect ratio (the reid model resizes afterwards).
"""

from __future__ import annotations

import cv2
import numpy as np

# Reference positions of [left eye, right eye, nose, left mouth, right mouth]
# in the 112x112 aligned crop (the standard ArcFace template).
ARCFACE_DST = np.array(
    [
        [38.2946, 51.6963],
        [73.5318, 51.5014],
        [56.0252, 71.7366],
        [41.5493, 92.3655],
        [70.7299, 92.2041],
    ],
    dtype=np.float32,
)

CROP_SIZE = 112


def _similarity_transform(src: np.ndarray, dst: np.ndarray) -> np.ndarray:
    """Umeyama similarity transform (2x3) mapping ``src`` points onto ``dst``."""
    src = src.astype(np.float64)
    dst = dst.astype(np.float64)
    src_mean = src.mean(axis=0)
    dst_mean = dst.mean(axis=0)
    src_d = src - src_mean
    dst_d = dst - dst_mean
    cov = dst_d.T @ src_d / len(src)
    u, s, vt = np.linalg.svd(cov)
    d = np.sign(np.linalg.det(u) * np.linalg.det(vt))
    diag = np.diag([1.0, d])
    rotation = u @ diag @ vt
    var_src = (src_d**2).sum() / len(src)
    scale = np.trace(np.diag(s) @ diag) / var_src
    translation = dst_mean - scale * rotation @ src_mean
    return np.hstack([scale * rotation, translation[:, None]])


def norm_crop(image: np.ndarray, landmarks: np.ndarray) -> np.ndarray:
    """Align a face to the 112x112 ArcFace template from its 5 landmarks."""
    matrix = _similarity_transform(
        np.asarray(landmarks, dtype=np.float32).reshape(5, 2), ARCFACE_DST
    )
    return cv2.warpAffine(image, matrix, (CROP_SIZE, CROP_SIZE))


# face-reidentification-retail-0095's reference landmarks, expressed as
# fractions of its 96x112 training crop (left eye, right eye, nose tip, left
# and right mouth corner).
OMZ_REFERENCE_LANDMARKS = np.array(
    [
        [30.2946 / 96, 51.6963 / 112],
        [65.5318 / 96, 51.5014 / 112],
        [48.0252 / 96, 71.7366 / 112],
        [33.5493 / 96, 92.3655 / 112],
        [62.7299 / 96, 92.2041 / 112],
    ],
    dtype=np.float64,
)


def _standardize(points: np.ndarray) -> tuple[np.ndarray, float]:
    """Centre ``points`` per column and scale to unit std (in place)."""
    mean = points.mean(axis=0)
    points -= mean
    std = points.std()
    points /= std
    return mean, float(std)


def _omz_transform(src: np.ndarray, dst: np.ndarray) -> np.ndarray:
    """Least-squares similarity transform used by the OMZ face demo."""
    src_mean, src_std = _standardize(src)
    dst_mean, dst_std = _standardize(dst)
    u, _, vt = np.linalg.svd(src.T @ dst)
    rotation = (u @ vt).T

    transform = np.empty((2, 3))
    transform[:, 0:2] = rotation * (dst_std / src_std)
    transform[:, 2] = dst_mean.T - transform[:, 0:2] @ src_mean.T
    return transform


def align_roi_landmarks(crop: np.ndarray, landmarks: np.ndarray) -> np.ndarray:
    """Align a face ROI from landmarks given as fractions of that ROI.

    Returns a new image of the same size as ``crop``, with the face rotated and
    scaled onto :data:`OMZ_REFERENCE_LANDMARKS`.
    """
    height, width = crop.shape[:2]
    scale = np.array((width, height), dtype=np.float64)
    desired = OMZ_REFERENCE_LANDMARKS * scale
    observed = np.asarray(landmarks, dtype=np.float64).reshape(-1, 2) * scale
    # Solving desired -> observed and inverting the map is what the demo does;
    # it samples the source pixel for every destination pixel.
    transform = _omz_transform(desired, observed)
    return cv2.warpAffine(
        crop, transform, (width, height), flags=cv2.WARP_INVERSE_MAP
    )
