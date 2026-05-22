# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import requests
from concurrent.futures import ThreadPoolExecutor

import queue
from decord import VideoReader, cpu
import openvino_genai as ov_genai
from openvino import Tensor
import numpy as np


def encode_video(video_path: str,
                 max_num_frames: int = 64,
                 resolution: list = []) -> list:
    def uniform_sample(l: list, n: int) -> list:
        gap = len(l) / n
        idxs = [int(i * gap + gap / 2) for i in range(n)]
        return [l[i] for i in idxs]

    if len(resolution) != 0:
        vr = VideoReader(video_path, width=resolution[0],
                         height=resolution[1], ctx=cpu(0))
    else:
        vr = VideoReader(video_path, ctx=cpu(0))

    frame_idx = [i for i in range(0, len(vr), max(1, int(len(vr) / max_num_frames)))]
    if len(frame_idx) > max_num_frames:
        frame_idx = uniform_sample(frame_idx, max_num_frames)
    frames = vr.get_batch(frame_idx).asnumpy()

    frames = [Tensor(v.astype('uint8')) for v in frames]
    print('Num frames sampled:', len(frames))
    return frames    
