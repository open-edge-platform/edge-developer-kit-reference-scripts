# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import time
from pathlib import Path

import cv2
import numpy as np

from modules.base.logger import getLogger
from modules.lipsync.lipsync_avatar import LipsyncAvatar
from modules.lipsync.musetalk.musetalk_face_prep import (
    COORDS_FILENAME,
    ensure_musetalk_coords,
)
from modules.lipsync.musetalk.musetalk_models import (
    FACE_SIZE,
    LATENT_SIZE,
    VAE_ENCODE_BATCH,
    WHISPER_DIR,
    ensure_musetalk_openvino_models,
    get_shared_musetalk_inference,
    get_shared_vae_encoder,
    get_shared_whisper_encoder,
)


class MuseTalkAvatar(LipsyncAvatar):
    """MuseTalk lipsync session: whisper audio features drive a single-step
    latent-inpainting UNet whose output the VAE decodes into face crops.
    """

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
        # Only drop this session's references; the compiled models, their
        # shared InferRequests and locks stay in the module cache so
        # other/future sessions keep reusing them.
        self.unet_entry = None
        self.whisper_entry = None
        self.kf_entry = None
        self.frame_gen_plan = None

    def _prepare_keyframe_inference(self):
        # Keyframe-only inference uses a dedicated UNet + VAE decoder pair
        # compiled for the (smaller) static keyframe batch.
        self.kf_entry = get_shared_musetalk_inference(
            self.ov_device, len(self.frame_gen_plan.keyframes)
        )

    def load_avatar(self, avatar_path):
        """MuseTalk uses its own nose-centered, landmark-derived crop boxes
        (see musetalk_face_prep) instead of the wav2lip s3fd boxes; the crops
        and paste-back coordinates must match or the generated mouth lands
        offset from the real one."""
        getLogger(__file__).info("Reading Avatar Images (MuseTalk crops)")
        full_frames = self._read_cv_images(f"{avatar_path}/full_images")
        coords_list = ensure_musetalk_coords(avatar_path, self.device)

        face_frames = [
            cv2.resize(
                frame[y1:y2, x1:x2],
                (FACE_SIZE, FACE_SIZE),
                interpolation=cv2.INTER_LANCZOS4,
            )
            for frame, (y1, y2, x1, x2) in zip(full_frames, coords_list)
        ]
        return full_frames, face_frames, len(face_frames), coords_list

    def _compose_frame(self, combine_frame, res_frame, bbox):
        """Feathered alpha blend instead of a hard paste: only the generated
        mouth/jaw region (lower part of the nose-centered crop) replaces the
        original pixels, with blurred edges. Approximates the reference's
        face-parsing blend without the extra parsing model and removes the
        visible crop-rectangle seam."""
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
        """Per-frame 8-channel UNet latents: VAE(masked face) ++ VAE(face).

        Encoding every avatar frame takes a while, so the result is cached
        next to the avatar images and invalidated when the MuseTalk crop
        boxes are regenerated.
        """
        cache_path = Path(avatar_path) / "musetalk_latents.npy"
        coords_path = Path(avatar_path) / COORDS_FILENAME
        if (
            cache_path.exists()
            and coords_path.exists()
            and cache_path.stat().st_mtime >= coords_path.stat().st_mtime
        ):
            latents = np.load(cache_path)
            if len(latents) == len(face_frames):
                getLogger(__file__).info(
                    f"Loaded cached MuseTalk latents from {cache_path}"
                )
                return latents

        getLogger(__file__).info(
            f"Encoding {len(face_frames)} avatar faces to MuseTalk latents..."
        )
        start = time.perf_counter()

        n = len(face_frames)
        ref_imgs = np.empty((n, 3, FACE_SIZE, FACE_SIZE), dtype=np.float32)
        masked_imgs = np.empty_like(ref_imgs)
        for i, face in enumerate(face_frames):
            rgb = cv2.cvtColor(face, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
            masked = rgb.copy()
            masked[FACE_SIZE // 2 :] = 0.0  # inpainted mouth region
            ref_imgs[i] = ((rgb - 0.5) / 0.5).transpose(2, 0, 1)
            masked_imgs[i] = ((masked - 0.5) / 0.5).transpose(2, 0, 1)

        entry = get_shared_vae_encoder(self.ov_device)
        compiled, request, lock = entry["model"], entry["request"], entry["lock"]

        def encode(images):
            out = np.empty((n, 4, LATENT_SIZE, LATENT_SIZE), dtype=np.float32)
            for s in range(0, n, VAE_ENCODE_BATCH):
                chunk = images[s : s + VAE_ENCODE_BATCH]
                valid = len(chunk)
                if valid < VAE_ENCODE_BATCH:
                    chunk = np.concatenate(
                        [chunk, np.repeat(chunk[-1:], VAE_ENCODE_BATCH - valid, axis=0)]
                    )
                with lock:
                    result = request.infer({"images": chunk})[compiled.output(0)]
                    out[s : s + valid] = result[:valid]
            return out

        latents = np.concatenate([encode(masked_imgs), encode(ref_imgs)], axis=1)
        getLogger(__file__).info(
            f"Encoded avatar latents in {time.perf_counter() - start:.1f}s"
        )

        try:
            np.save(cache_path, latents)
        except OSError as e:
            getLogger(__file__).warning(f"Could not cache MuseTalk latents: {e}")
        return latents

    def extract_audio_features(self, audio_frames):
        """Whisper features for each new video frame: (50, 384) = 10 audio
        tokens (the frame's 2 tokens +/-2 frames of context) stacked across
        the encoder's 5 hidden-state levels.

        Features are sliced out of a rolling 30s segment at their true segment
        positions so they match what MuseTalk's offline AudioProcessor
        produces; frames right after a segment rollover briefly lose deep
        history, exactly like the reference's hard 30s segment cuts.
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
        # Serialize access: the shared InferRequests are used by every session,
        # and their output tensors stay valid only until the next infer() call,
        # so the calls and the result reads must happen under the lock.
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
