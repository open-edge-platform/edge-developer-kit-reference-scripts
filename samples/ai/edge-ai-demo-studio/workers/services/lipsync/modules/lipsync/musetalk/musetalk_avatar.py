# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import time

import cv2
import numpy as np

from modules.base.logger import getLogger
from modules.lipsync.lipsync_avatar import LipsyncAvatar
from modules.lipsync.musetalk.musetalk_face_prep import musetalk_coords_job
from modules.lipsync.musetalk.musetalk_latents import (
    cached_musetalk_latents,
    musetalk_face_crops,
    musetalk_latents_job,
)
from modules.lipsync.musetalk.musetalk_models import (
    FACE_SIZE,
    WHISPER_DIR,
    ensure_musetalk_openvino_models,
    get_shared_musetalk_inference,
    get_shared_whisper_encoder,
)


class MuseTalkAvatar(LipsyncAvatar):
    """MuseTalk session: whisper features drive a single-step latent-inpainting UNet, VAE-decoded."""

    # Whisper features use +/-2 video frames (4 audio chunks) of context,
    # MuseTalk's audio_padding_length_left/right default.
    audio_left_stride = 4
    audio_right_stride = 4
    SEGMENT_CHUNKS = 1500

    def __init__(self, avatar_id, configs, device, use_int8=False, frame_gen_plan=None):
        if use_int8:
            getLogger(__file__).warning(
                "INT8 is not available for MuseTalk yet; using FP16."
            )
        self.unet_entry = None
        self.whisper_entry = None
        self.kf_entry = None
        self.feature_extractor = None

        # Rolling audio segment state for extract_audio_features.
        self._segment = np.zeros(0, dtype=np.float32)
        self._next_frame = 0

        # Feathered paste-back masks, cached per bbox size.
        self._blend_masks = {}

        super().__init__(
            avatar_id=avatar_id,
            configs=configs,
            device=device,
            frame_gen_plan=frame_gen_plan,
        )

    def load_model(self):
        if self.image_size != FACE_SIZE:
            raise ValueError(
                f"MuseTalk generates {FACE_SIZE}x{FACE_SIZE} faces but the avatar "
                f"at {self.avatar_path} uses size {self.image_size}."
            )

        ensure_musetalk_openvino_models(batch_size=self.batch_size)

        # Log-mel extraction is numpy-only; the whisper network itself runs
        # through OpenVINO.
        from transformers import WhisperFeatureExtractor

        self.feature_extractor = WhisperFeatureExtractor.from_pretrained(WHISPER_DIR)
        self.whisper_entry = get_shared_whisper_encoder(self.ov_device)
        self.unet_entry = get_shared_musetalk_inference(self.ov_device, self.batch_size)

    def unload_models(self):
        # Only this session's references; the compiled models stay cached for other sessions.
        self.unet_entry = None
        self.whisper_entry = None
        self.kf_entry = None
        self.frame_gen_plan = None
        self.frame_gen_active = False

    def _prepare_keyframe_inference(self):
        # Keyframe-only inference uses a dedicated UNet + VAE decoder pair
        # compiled for the (smaller) static keyframe batch.
        self.kf_entry = get_shared_musetalk_inference(
            self.ov_device, len(self.frame_gen_plan.keyframes)
        )

    def load_avatar(self, avatar_path):
        """Load with MuseTalk's landmark-derived crop boxes, not wav2lip's s3fd ones.

        Crops and paste-back coordinates must match or the generated mouth lands offset.
        """
        getLogger(__file__).info("Reading Avatar Images (MuseTalk crops)")
        full_frames = self._read_cv_images(f"{avatar_path}/full_images")
        # Shared with a preparation already under way (worker startup, or
        # the app's POST /v1/lipsync/prepare) rather than made twice.
        coords_list = musetalk_coords_job(avatar_path, self.device).wait()

        face_frames = musetalk_face_crops(full_frames, coords_list)
        return full_frames, face_frames, len(face_frames), coords_list

    def _compose_frame(self, combine_frame, res_frame, bbox):
        """Feathered blend of only the generated mouth/jaw region, hiding the crop-rectangle seam.

        Approximates the reference's face-parsing blend without the parsing model.
        """
        y1, y2, x1, x2 = bbox
        w, h = x2 - x1, y2 - y1
        res_frame = cv2.resize(res_frame.astype(np.uint8), (w, h))
        mask = self._get_blend_mask(h, w)
        region = combine_frame[y1:y2, x1:x2].astype(np.float32)
        combine_frame[y1:y2, x1:x2] = (
            region * (1.0 - mask) + res_frame.astype(np.float32) * mask
        ).astype(np.uint8)
        return combine_frame

    def _get_blend_mask(self, h, w):
        mask = self._blend_masks.get((h, w))
        if mask is None:
            margin = max(2, h // 12)
            mask = np.zeros((h, w), dtype=np.float32)
            # The nose sits at the crop midline; keep the original video above
            # it (eyes stay sharp) and fade the generated region in below.
            mask[int(h * 0.45) : h - margin, margin : w - margin] = 1.0
            k = 2 * margin + 1
            mask = cv2.GaussianBlur(mask, (k, k), 0)[..., None]
            self._blend_masks[(h, w)] = mask
        return mask

    def _prepare_face_inputs(self, face_frames, avatar_path):
        """Per-frame 8-channel UNet latents: cached, else shared with the running latents job."""
        latents = cached_musetalk_latents(avatar_path, len(face_frames))
        if latents is None:
            latents = musetalk_latents_job(avatar_path, self.device).wait()
        return latents

    def extract_audio_features(self, audio_frames):
        """Whisper features per new video frame: (50, 384) = 10 tokens (+/-2 frames) x 5 levels.

        Sliced from a rolling 30 s segment at true positions to match MuseTalk's offline
        AudioProcessor, including its lost history right after a segment cut.
        """
        if len(audio_frames) <= self.audio_left_stride + self.audio_right_stride:
            return []

        # The pipeline appends exactly batch_size * 2 chunks per call; older
        # entries were ingested on previous calls.
        new_chunks = audio_frames[-(self.batch_size * 2) :]
        self._segment = np.concatenate([self._segment, *new_chunks])

        chunk_size = self.audio_chunk_size
        n_chunks = len(self._segment) // chunk_size
        # Frame f covers audio chunks [2f, 2f+2) — one whisper token per
        # chunk — and its feature needs 2 frames of lookahead.
        last_frame = (n_chunks - self.audio_right_stride - 2) // 2
        if last_frame < self._next_frame:
            return []

        # The extractor pads to whisper's fixed 30s mel window; the encoder is
        # compiled for that shape.
        mel = self.feature_extractor(
            self._segment, sampling_rate=16000, return_tensors="np"
        ).input_features.astype(np.float32)

        entry = self.whisper_entry
        with entry["lock"]:
            tokens = entry["request"].infer({"audio_mel": mel})[
                entry["model"].output(0)
            ][
                0
            ]  # (1500, 5, 384)
            # Zero left-padding so the first frames of a segment index like
            # the reference (audio_padding_length_left = 2 -> 4 tokens).
            padded = np.concatenate([np.zeros_like(tokens[:4]), tokens])
            features = [
                padded[2 * f : 2 * f + 10].reshape(50, 384).copy()
                for f in range(self._next_frame, last_frame + 1)
            ]
        self._next_frame = last_frame + 1

        # Roll the segment over before it outgrows whisper's window, keeping
        # the context the next frame's feature needs.
        if n_chunks + self.batch_size * 2 > self.SEGMENT_CHUNKS:
            keep_from = max(0, 2 * self._next_frame - 4)
            self._segment = self._segment[keep_from * chunk_size :]
            self._next_frame -= keep_from // 2

        return features

    def _run_lipsync_inference(
        self, feature_batch, start_index, debug=False, positions=None
    ):
        if positions is None:
            positions = range(self.batch_size)
            feature_batch = self._pad_feature_batch(feature_batch)
            entry = self.unet_entry
        else:
            # Keyframe-only inference for frame generation: feature_batch
            # already holds exactly one feature per position.
            entry = self.kf_entry

        # Snapshot the latents so a concurrent reload_avatar can't change the
        # array length between the reflection() index math and the lookup.
        face_inputs = self.face_inputs
        face_inputs_len = len(face_inputs)

        latents = np.stack(
            [
                face_inputs[self.reflection(face_inputs_len, start_index + i)]
                for i in positions
            ]
        )
        audio = np.stack(feature_batch).astype(np.float32)

        t_start = time.perf_counter() if debug else 0
        # The InferRequests are shared by every session and their outputs are valid only until the
        # next infer(), so reads happen under the lock too.
        with entry["lock"]:
            pred_latents = entry["unet_request"].infer(
                {"latent_model_input": latents, "audio_features": audio}
            )[entry["unet"].output(0)]
            images = entry["vae_decoder_request"].infer({"latents": pred_latents})[
                entry["vae_decoder"].output(0)
            ]
            # (B, 3, H, W) RGB in [-1, 1] -> (B, H, W, 3) BGR in [0, 255]
            pred = ((images.transpose(0, 2, 3, 1) / 2 + 0.5).clip(0, 1) * 255.0)[
                ..., ::-1
            ].copy()
        inf_time = time.perf_counter() - t_start if debug else 0

        if debug:
            batch_n = pred.shape[0]
            getLogger(__file__).info(
                f"MuseTalk OV inference: batch_size={batch_n}, total_time={inf_time:.6f}s, avg_per_frame={inf_time / max(batch_n, 1):.6f}s"
            )

        return pred
