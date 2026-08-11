# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Model-agnostic streaming lipsync pipeline.

LipsyncAvatar owns everything that does not depend on the lipsync model:
the audio chunk queues and pacing, per-batch audio feature extraction
scheduling, the lip_sync inference loop (including keyframe-only inference
with RIFE frame generation), merging the inferred face crop back into the
full frame, and avatar image loading / hot-reload.
"""

import pickle  # nosec B403 -- reading the pickle file created by another script only
import os
import copy
import time

import cv2
import numpy as np

from glob import glob
from queue import Queue
from threading import Lock, Thread
from tqdm import tqdm

from modules.base.logger import getLogger
from modules.base.avatar import Avatar, text_wrapper
from modules.base.constants import CONSTANTS
from modules.texttospeech.kokoro_tts import AudioState


class SafeUnpickler(pickle.Unpickler):
    """
    A safe unpickler that restricts the types that can be loaded during deserialization.
    This prevents arbitrary code execution vulnerabilities in pickle.load().

    Only allows basic Python types that are expected for coordinate data:
    - Numbers (int, float)
    - Collections (list, tuple)
    - Basic Python builtins
    """

    def find_class(self, module, name):
        # Only allow safe builtins for coordinate data
        safe_builtins = {
            "list",
            "tuple",
            "int",
            "float",
            "bool",
            "str",
            "dict",
            "set",
            "frozenset",
            "complex",
        }

        if module == "builtins" and name in safe_builtins:
            return getattr(__builtins__, name)

        # Allow numpy types that might be in coordinate data
        # This includes both public API and internal types needed for deserialization
        numpy_modules = {
            "numpy",
            "numpy.core",
            "numpy._core",
            "numpy.core.multiarray",
            "numpy._core.multiarray",
            "numpy.core.numeric",
            "numpy._core.numeric",
        }

        safe_numpy_types = {
            "ndarray",
            "dtype",
            "int64",
            "float64",
            "int32",
            "float32",
            "int8",
            "int16",
            "uint8",
            "uint16",
            "uint32",
            "uint64",
            "scalar",
            "_reconstruct",
            "_flagdict",
            "flagsobj",
        }

        if module in numpy_modules and name in safe_numpy_types:
            import numpy as np

            # Handle internal numpy types that may not be directly accessible
            if hasattr(np, name):
                return getattr(np, name)
            elif module in ["numpy._core.multiarray", "numpy.core.multiarray"]:
                # For internal multiarray types, import the specific module
                try:
                    import numpy.core.multiarray as ma

                    if hasattr(ma, name):
                        return getattr(ma, name)
                except ImportError:
                    pass
                try:
                    import numpy._core.multiarray as ma

                    if hasattr(ma, name):
                        return getattr(ma, name)
                except ImportError:
                    pass

        # Forbid everything else to prevent arbitrary code execution
        raise pickle.UnpicklingError(
            f"Global '{module}.{name}' is forbidden for security reasons"
        )


def safe_pickle_load(file_path):
    """Safely load a pickle file using the restricted unpickler."""
    with open(file_path, "rb") as f:
        return SafeUnpickler(f).load()


class LipsyncAvatar(Avatar):
    """Base class for streaming lipsync sessions: audio chunks in, lipsynced
    full frames out. Subclasses provide the model-specific pieces."""

    # Audio context (in audio chunks, 2 chunks per video frame) kept on each
    # side of a batch when extracting audio features. Subclasses override to
    # match their model's receptive field.
    audio_left_stride = 2
    audio_right_stride = 2

    def __init__(self, avatar_id, configs, device, frame_gen_plan=None):
        super().__init__(avatar_id=avatar_id)

        self.configs = configs

        self.language_code = "en_us"
        self.device = device
        self.ov_device = device.upper()
        self.batch_size = self.configs.get("batch_size", 16)
        self.image_width = self.configs.get("image", {}).get("width", 868)
        self.image_height = self.configs.get("image", {}).get("height", 1080)

        self.audio_fps = CONSTANTS.AUDIO_FPS * 2
        self.audio_chunk_size = CONSTANTS.AUDIO_CHUNK_SIZE

        self.result_frame_queue = Queue(self.batch_size * 2)
        self.combined_frame_queue = Queue()
        self.message_queue = Queue()

        self.audio_input_queue = Queue()
        self.audio_output_queue = Queue()
        self.audio_feature_queue = Queue(2)
        self.audio_frames = []

        # Avatar image directories are produced by the wav2lip avatar
        # generator and shared by every lipsync model.
        self.avatar_path = self.configs.get("wav2lip", {}).get(
            "avatar_path", "./data/avatars/wav2lip_avatar1"
        )
        self.image_size = int(self.avatar_path.split("_")[-1])

        self.stop_infer = False

        # Per-utterance frame stats, reset when a new request starts and
        # reported with the processing_complete status.
        self.frames_inferred = 0
        self.frames_interpolated = 0

        # Talking audio chunks ingested from audio_input_queue but not yet
        # merged into an output frame. The internal queues between the
        # pipeline threads are invisible to a queue-emptiness check, so this
        # counter is what makes "processing complete" truthful.
        self.pending_talk_chunks = 0
        self._pending_lock = Lock()

        self.load_model()

        # Frame generation: infer only the plan's keyframe positions and fill
        # the frames in between with RIFE interpolation.
        self.frame_gen_plan = (
            frame_gen_plan if frame_gen_plan and frame_gen_plan.enabled else None
        )
        if self.frame_gen_plan:
            self._prepare_keyframe_inference()

        self.cv_frames, self.face_frames, self.face_frames_len, self.coords_list = (
            self.load_avatar(self.avatar_path)
        )
        assert self.face_frames_len > 0, "No face frames found in the avatar directory."
        self.face_inputs = self._prepare_face_inputs(self.face_frames, self.avatar_path)

    # ------------------------------------------------------------------
    # Model-specific interface
    # ------------------------------------------------------------------

    def load_model(self):
        """Compile the lipsync model(s) for self.ov_device."""
        raise NotImplementedError

    def unload_models(self):
        """Drop this session's model references (shared caches stay loaded)."""

    def extract_audio_features(self, audio_frames):
        """Turn a window of raw audio chunks into a list of per-video-frame
        features consumed by _run_lipsync_inference. Returns [] while the
        window is too short (fewer than left + right stride chunks)."""
        raise NotImplementedError

    def _run_lipsync_inference(
        self, feature_batch, start_index, debug=False, positions=None
    ):
        """Infer face frames for one batch.

        Args:
            feature_batch: per-frame audio features; padded to batch_size when
                positions is None.
            start_index: global frame index of the first frame in the batch,
                used to pick avatar face frames via reflection().
            positions: when set, the batch positions to infer (keyframe-only
                inference for frame generation) with exactly one feature per
                position.

        Returns:
            Array-like of face frames (H, W, 3) float BGR in [0, 255].
        """
        raise NotImplementedError

    def _prepare_face_inputs(self, face_frames, avatar_path):
        """Precompute per-face-frame model inputs (e.g. VAE latents) for the
        avatar at avatar_path. Called after every avatar (re)load. Base
        pipeline keeps None."""
        return None

    def _compose_frame(self, combine_frame, res_frame, bbox):
        """Paste an inferred face crop back into the full frame at bbox
        (y1, y2, x1, x2). Subclasses may override to blend instead of paste."""
        y1, y2, x1, x2 = bbox
        res_frame = cv2.resize(res_frame.astype(np.uint8), (x2 - x1, y2 - y1))
        combine_frame[y1:y2, x1:x2] = res_frame
        return combine_frame

    def _prepare_keyframe_inference(self):
        """Set up keyframe-only inference for the frame generation plan.
        Subclasses that support frame generation compile the keyframe-batch
        model variant here; the default disables the plan."""
        getLogger(__file__).warning(
            f"{type(self).__name__} does not support frame generation; disabling."
        )
        self.frame_gen_plan = None

    # ------------------------------------------------------------------
    # Shared pipeline
    # ------------------------------------------------------------------

    def __del__(self):
        getLogger(__file__).info("Avatar deleted")
        self.unload_models()

    def _pad_feature_batch(self, feature_batch):
        """Pad a feature batch to batch_size by repeating the last feature.

        The audio pipeline can yield fewer features than batch_size (e.g. on
        the very first talking batch, before the stride leftover stabilizes).
        The models are compiled for a static batch, so pad by repeating the
        last feature; extra frames still pair with real audio downstream.
        """
        feature_batch = list(feature_batch)[: self.batch_size]
        if len(feature_batch) < self.batch_size:
            feature_batch += [feature_batch[-1]] * (
                self.batch_size - len(feature_batch)
            )
        return feature_batch

    @staticmethod
    def _read_cv_images(images_path):
        image_pattern = f"{images_path}/*.[jpJP][pnPN]*[gG]"
        input_images_list = sorted(
            glob(image_pattern),
            key=lambda x: int(os.path.splitext(os.path.basename(x))[0]),
        )
        return [cv2.imread(image_path) for image_path in tqdm(input_images_list)]

    def load_avatar(self, avatar_path):
        getLogger(__file__).info("Reading Avatar Images")

        _read_cv_images = self._read_cv_images

        self.full_images_path = f"{avatar_path}/full_images"
        self.face_images_path = f"{avatar_path}/face_images"
        self.coords_path = f"{avatar_path}/coords.pkl"

        full_cv_frame_list = _read_cv_images(self.full_images_path)
        face_cv_frame_list = _read_cv_images(self.face_images_path)
        coords_list = safe_pickle_load(self.coords_path)

        return (
            full_cv_frame_list,
            face_cv_frame_list,
            len(face_cv_frame_list),
            coords_list,
        )

    def reload_avatar(self, avatar_path):
        """Hot-swap the avatar skin on a running session.

        The lip_sync / merge threads keep reading while we swap, so the new
        lists are assigned in one statement and those threads take local
        snapshots before indexing (see _run_lipsync_inference /
        merge_video_audio).
        """
        new_size = int(avatar_path.split("_")[-1])
        if new_size != self.image_size:
            raise ValueError(
                f"Avatar size {new_size} does not match loaded model size "
                f"{self.image_size}; cannot hot-reload."
            )

        cv_frames, face_frames, face_frames_len, coords_list = self.load_avatar(
            avatar_path
        )
        if face_frames_len == 0:
            raise ValueError(f"No face frames found in {avatar_path}")
        face_inputs = self._prepare_face_inputs(face_frames, avatar_path)

        self.avatar_path = avatar_path
        self.cv_frames, self.face_frames, self.face_frames_len, self.coords_list = (
            cv_frames,
            face_frames,
            face_frames_len,
            coords_list,
        )
        self.face_inputs = face_inputs
        getLogger(__file__).info(f"Avatar hot-reloaded from {avatar_path}")

    def _run_keyframed_inference(self, feature_batch, start_index, debug=False):
        """Lipsync inference on keyframe positions only, with RIFE filling the
        frames in between, returning a full batch of face frames in order.

        The frame generation plan fixes the keyframe layout (both batch
        endpoints are always keyframes), so each interpolated frame is anchored
        by two real inferences within the same batch and no state is carried
        across batches.
        """
        plan = self.frame_gen_plan
        positions = plan.keyframes

        feature_batch = self._pad_feature_batch(feature_batch)
        kf_features = [feature_batch[p] for p in positions]

        t_start = time.perf_counter() if debug else 0
        kf_pred = self._run_lipsync_inference(
            kf_features, start_index, debug=False, positions=positions
        )

        gaps, spans = [], []
        for j in range(len(positions) - 1):
            n_frames = positions[j + 1] - positions[j] - 1
            if n_frames > 0:
                gaps.append((kf_pred[j], kf_pred[j + 1], n_frames))
                spans.append((positions[j] + 1, n_frames))

        if gaps:
            # The generator is shared by every session and its inference
            # context is not thread-safe.
            with plan.lock:
                fills = plan.generator.interpolate_gaps(gaps)
        else:
            fills = []

        frames = [None] * self.batch_size
        for j, p in enumerate(positions):
            frames[p] = kf_pred[j]
        for (start, n_frames), fill in zip(spans, fills):
            frames[start : start + n_frames] = fill[:n_frames]

        if debug:
            total = time.perf_counter() - t_start
            getLogger(__file__).info(
                f"Frame gen batch: {len(positions)} inferred + "
                f"{self.batch_size - len(positions)} interpolated in {total:.3f}s "
                f"=> {self.batch_size / total:.1f} FPS"
            )
        return frames

    def text_to_speech(self):
        if self.stop_infer == True:
            for _ in range(self.batch_size * 2):
                (audio_frame, metadata), state = (
                    np.zeros(self.audio_chunk_size, dtype=np.float32),
                    None,
                ), AudioState.SILENT

                with self.audio_input_queue.mutex:
                    self.audio_input_queue.queue.clear()

                self.audio_output_queue.put((audio_frame, state, metadata))
                self.audio_frames.append(audio_frame)
            self.stop_infer = False

        else:
            for _ in range(self.batch_size * 2):
                try:
                    (audio_frame, metadata), state = (
                        self.audio_input_queue.get(block=False, timeout=1),
                        AudioState.TALKING,
                    )
                    with self._pending_lock:
                        self.pending_talk_chunks += 1
                except Exception:
                    (audio_frame, metadata), state = (
                        np.zeros(self.audio_chunk_size, dtype=np.float32),
                        None,
                    ), AudioState.SILENT

                self.audio_output_queue.put((audio_frame, state, metadata))
                self.audio_frames.append(audio_frame)

        features = self.extract_audio_features(self.audio_frames)

        if features:
            self.audio_feature_queue.put(features)
            self.audio_frames = self.audio_frames[
                -(self.audio_left_stride + self.audio_right_stride) :
            ]

    def lip_sync(self, signal_event, debug=False):
        index = 0

        while not signal_event.is_set():
            feature_batch = []

            try:
                feature_batch = self.audio_feature_queue.get(block=True, timeout=1)
            except Exception:
                continue

            audio_frames, is_no_speech = [], True
            for _ in range(self.batch_size * 2):
                audio_frame, state, metadata = self.audio_output_queue.get()
                audio_frames.append((audio_frame, state, metadata))
                if state == AudioState.TALKING:
                    is_no_speech = False

            if is_no_speech == True:
                for i in range(self.batch_size):
                    batched_audio_frames = audio_frames[i * 2 : i * 2 + 2]
                    self.result_frame_queue.put(
                        (
                            None,
                            self.reflection(self.face_frames_len, index),
                            batched_audio_frames,
                        )
                    )
                    index = index + 1
            else:
                if self.frame_gen_plan:
                    pred = self._run_keyframed_inference(feature_batch, index, debug)
                    n_keyframes = len(self.frame_gen_plan.keyframes)
                    self.frames_inferred += n_keyframes
                    self.frames_interpolated += self.batch_size - n_keyframes
                else:
                    pred = self._run_lipsync_inference(feature_batch, index, debug)
                    self.frames_inferred += self.batch_size

                for i, res_frame in enumerate(pred):
                    batched_audio_frames = audio_frames[i * 2 : i * 2 + 2]
                    self.result_frame_queue.put(
                        (
                            res_frame,
                            self.reflection(self.face_frames_len, index),
                            batched_audio_frames,
                        )
                    )
                    index = index + 1

    def merge_video_audio(self, signal_event):
        while not signal_event.is_set():
            try:
                res_frame, idx, audio_frame = self.result_frame_queue.get(
                    block=True, timeout=1
                )
            except:
                continue

            # Snapshot lists and clamp idx: a hot-reload may have swapped in a
            # skin with fewer frames than the idx computed at enqueue time.
            cv_frames = self.cv_frames
            coords_list = self.coords_list
            if idx >= len(cv_frames):
                idx %= len(cv_frames)

            n_talking = sum(1 for af in audio_frame[:2] if af[1] == AudioState.TALKING)
            try:
                if n_talking == 0:
                    combine_frame = cv_frames[idx]
                else:
                    bbox = coords_list[min(idx, len(coords_list) - 1)]
                    combine_frame = copy.deepcopy(cv_frames[idx])
                    try:
                        combine_frame = self._compose_frame(
                            combine_frame, res_frame, bbox
                        )
                    except Exception:
                        continue

                    _, _, metadata = audio_frame[0]

                    if metadata is not None:
                        message = metadata.get("message", "")
                        language_code = metadata.get("language_code", "en-US")
                        combine_frame = text_wrapper(
                            combine_frame, message, language_code, self.image_width
                        )

                self.combined_frame_queue.put((combine_frame, audio_frame))
            finally:
                # Even a dropped frame accounts for its chunks, or the
                # pending count would never reach zero.
                if n_talking:
                    with self._pending_lock:
                        self.pending_talk_chunks -= n_talking

    def start(self, signal_event):
        Thread(target=self.lip_sync, args=(signal_event,)).start()
        Thread(target=self.merge_video_audio, args=(signal_event,)).start()

    def reset(self):
        self.stop_infer = False

    def reset_frame_stats(self):
        self.frames_inferred = 0
        self.frames_interpolated = 0

    def stop(self):
        self.stop_infer = True
