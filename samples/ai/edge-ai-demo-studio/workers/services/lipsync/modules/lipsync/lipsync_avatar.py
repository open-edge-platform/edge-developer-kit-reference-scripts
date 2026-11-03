# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Model-agnostic streaming lipsync pipeline: audio queues and pacing, the lip_sync inference loop
(incl. keyframe-only inference with frame generation), frame merging and avatar (re)loading.
"""

import pickle  # nosec B403 -- reading the pickle file created by another script only
import os
import copy
import time

import cv2
import numpy as np

from glob import glob
from queue import Full, Queue
from threading import Event, Lock, Thread
from typing import Optional
from tqdm import tqdm

from worker_common import instance_data_dir

from modules.base.logger import getLogger
from modules.base.avatar import Avatar, text_wrapper
from modules.base.constants import CONSTANTS
from modules.texttospeech.kokoro_tts import AudioState


def put_unless_stopped(queue: Queue, item, signal_event: Optional[Event]) -> bool:
    """``queue.put`` that gives up (returns False) once ``signal_event`` is set.

    At session end the draining thread exits, so a blocking put would hang the stopping ``join``.
    """
    while True:
        try:
            queue.put(item, timeout=0.5)
            return True
        except Full:
            if signal_event is not None and signal_event.is_set():
                return False


class SafeUnpickler(pickle.Unpickler):
    """Unpickler limited to builtins and numpy types, so coords.pkl can't execute arbitrary code."""

    def find_class(self, module, name):
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

        # Includes numpy internals needed for deserialization.
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

            if hasattr(np, name):
                return getattr(np, name)
            elif module in ["numpy._core.multiarray", "numpy.core.multiarray"]:
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

        raise pickle.UnpicklingError(
            f"Global '{module}.{name}' is forbidden for security reasons"
        )


def safe_pickle_load(file_path):
    """Safely load a pickle file using the restricted unpickler."""
    with open(file_path, "rb") as f:
        return SafeUnpickler(f).load()


def default_batch_size(device: str) -> int:
    """Frames per lipsync inference when the config sets none: 8 on the NPU, 16 elsewhere.

    Core Ultra X7 358H NPU, Wav2Lip INT8: ~10 ms/frame at 8 vs ~30 ms at 16, and the first talking
    frame comes sooner. (A 285K NPU is too slow at either size and plays smoother at 16.)
    """
    return 8 if device.upper().split(".")[0] == "NPU" else 16


class LipsyncAvatar(Avatar):
    """Base streaming lipsync session: audio chunks in, lipsynced frames out."""

    # Audio context (in chunks, 2 per video frame) kept on each side of a batch for feature
    # extraction; subclasses match their model's receptive field.
    audio_left_stride = 2
    audio_right_stride = 2

    # Batch size while no speech is queued, for models whose features carry no state across
    # batches: arriving speech waits behind at most one. None keeps full batches.
    idle_batch_frames = None

    def __init__(self, avatar_id, configs, device, frame_gen_plan=None):
        super().__init__(avatar_id=avatar_id)

        self.configs = configs

        self.language_code = "en_us"
        self.device = device
        self.ov_device = device.upper()
        self.batch_size = self.configs.get("batch_size") or default_batch_size(device)
        # Seconds one talking batch takes to infer (moving average; 0 until the
        # first one): how many frames playback must have queued meanwhile.
        self.batch_inference_seconds = 0.0
        self.image_width = self.configs.get("image", {}).get("width", 868)
        self.image_height = self.configs.get("image", {}).get("height", 1080)

        self.audio_fps = CONSTANTS.AUDIO_FPS * 2
        self.audio_chunk_size = CONSTANTS.AUDIO_CHUNK_SIZE

        self.result_frame_queue = Queue(self.batch_size * 2)
        self.combined_frame_queue = Queue()
        self.message_queue = Queue()

        self.audio_input_queue = Queue()
        self.audio_output_queue = Queue()
        # (frames, features) per batch.
        self.audio_feature_queue = Queue(2)
        # Frames of the batch lip_sync took from audio_feature_queue (in
        # inference, say) not yet handed to result_frame_queue.
        self.frames_in_lip_sync = 0
        self.audio_frames = []

        # Avatar dirs come from the wav2lip generator and serve every model. ensure_default_avatar()
        # sets avatar_path before ready, so the fallback is rarely used.
        self.avatar_path = self.configs.get("wav2lip", {}).get(
            "avatar_path"
        ) or str(instance_data_dir(".") / "data" / "avatars" / "wav2lip_avatar1")
        self.image_size = int(self.avatar_path.split("_")[-1])

        self.stop_infer = False

        # Per-utterance frame stats, reset when a new request starts and
        # reported with the processing_complete status.
        self.frames_inferred = 0
        self.frames_interpolated = 0

        # Talking chunks taken from audio_input_queue but not yet merged into a frame: the
        # internal queues are invisible to an emptiness check, so this makes "complete" truthful.
        self.pending_talk_chunks = 0
        self._pending_lock = Lock()

        # Audio chunks text_to_speech handed to the pipeline and lip_sync took
        # out of it, in order. The ones before stale_chunks_end were queued
        # before the last stop(): they play as silence on idle frames.
        self.chunks_queued = 0
        self.chunks_taken = 0
        self.stale_chunks_end = 0

        self.load_model()

        # When active, infer only the plan's keyframes and interpolate the rest. The plan may be
        # built after this session connects (set_frame_generation); frame_gen_active is per request.
        self.frame_gen_plan = None
        self.frame_gen_active = False
        if frame_gen_plan and frame_gen_plan.enabled:
            self._adopt_frame_gen_plan(frame_gen_plan)

        self.cv_frames, self.face_frames, self.face_frames_len, self.coords_list = (
            self.load_avatar(self.avatar_path)
        )
        assert self.face_frames_len > 0, "No face frames found in the avatar directory."
        self.face_inputs = self._prepare_face_inputs(self.face_frames, self.avatar_path)

    # Model-specific interface

    def load_model(self):
        """Compile the lipsync model(s) for self.ov_device."""
        raise NotImplementedError

    def unload_models(self):
        """Drop this session's model references (shared caches stay loaded)."""

    def extract_audio_features(self, audio_frames):
        """Per-video-frame features for a window of audio chunks; [] while it is too short."""
        raise NotImplementedError

    def _run_lipsync_inference(
        self, feature_batch, start_index, debug=False, positions=None
    ):
        """Infer face frames (H, W, 3) float BGR in [0, 255] for one batch.

        ``start_index`` is the global index of the first frame (picks faces via reflection()). With
        ``positions`` (keyframe-only inference) there is one feature per position; otherwise the
        batch is padded to batch_size.
        """
        raise NotImplementedError

    def _prepare_face_inputs(self, face_frames, avatar_path):
        """Precompute per-face-frame model inputs (e.g. VAE latents) after each avatar (re)load."""
        return None

    def _compose_frame(self, combine_frame, res_frame, bbox):
        """Paste an inferred face crop into the full frame at bbox (y1, y2, x1, x2)."""
        y1, y2, x1, x2 = bbox
        res_frame = cv2.resize(res_frame.astype(np.uint8), (x2 - x1, y2 - y1))
        combine_frame[y1:y2, x1:x2] = res_frame
        return combine_frame

    def _prepare_keyframe_inference(self):
        """Compile the keyframe-batch model for frame generation; the default disables the plan."""
        getLogger(__file__).warning(
            f"{type(self).__name__} does not support frame generation; disabling."
        )
        self.frame_gen_plan = None

    # Shared pipeline

    def _adopt_frame_gen_plan(self, plan):
        self.frame_gen_plan = plan
        self._prepare_keyframe_inference()

    def set_frame_generation(self, active, plan=None):
        """Toggle frame generation for upcoming utterances, adopting ``plan`` if none yet.

        Read per batch, so overlapping requests resolve to the last one. Returns whether active.
        """
        if active and self.frame_gen_plan is None and plan and plan.enabled:
            self._adopt_frame_gen_plan(plan)
        # _prepare_keyframe_inference may have vetoed the plan (unsupported
        # model), so re-check it before activating.
        self.frame_gen_active = bool(active) and self.frame_gen_plan is not None
        return self.frame_gen_active

    def __del__(self):
        getLogger(__file__).info("Avatar deleted")
        self.unload_models()

    def _pad_feature_batch(self, feature_batch):
        """Pad to batch_size by repeating the last feature: models are compiled for a static batch,
        and the first talking batch can come up short."""
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

        The lists are assigned in one statement; the pipeline threads index local snapshots.
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
        """Infer keyframes only and fill the frames between with RIFE; returns a full batch in order.

        Both batch endpoints are keyframes, so no state carries across batches.
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

    def text_to_speech(self, signal_event: Optional[Event] = None):
        if self.stop_infer == True:
            with self.audio_input_queue.mutex:
                self.audio_input_queue.queue.clear()
            self.stop_infer = False
            idle = True
        else:
            idle = self.audio_input_queue.empty()

        if idle and self.idle_batch_frames:
            self._queue_idle_batch(signal_event)
            return

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
            self.chunks_queued += 1
            self.audio_frames.append(audio_frame)

        features = self.extract_audio_features(self.audio_frames)

        if features:
            if not put_unless_stopped(
                self.audio_feature_queue, (self.batch_size, features), signal_event
            ):
                return
            self.audio_frames = self.audio_frames[
                -(self.audio_left_stride + self.audio_right_stride) :
            ]

    def _queue_idle_batch(self, signal_event):
        """Queue idle_batch_frames silent frames (no features; they aren't inferred).

        The audio window keeps only the context the next talking batch looks back on.
        """
        silence = np.zeros(self.audio_chunk_size, dtype=np.float32)
        n_chunks = self.idle_batch_frames * 2
        for _ in range(n_chunks):
            self.audio_output_queue.put((silence, AudioState.SILENT, None))
        self.chunks_queued += n_chunks
        keep = self.audio_left_stride + self.audio_right_stride
        self.audio_frames = (self.audio_frames + [silence] * n_chunks)[-keep:]
        put_unless_stopped(
            self.audio_feature_queue, (self.idle_batch_frames, None), signal_event
        )

    def lip_sync(self, signal_event, debug=False):
        index = 0

        while not signal_event.is_set():
            try:
                n_frames, feature_batch = self.audio_feature_queue.get(
                    block=True, timeout=1
                )
            except Exception:
                continue
            self.frames_in_lip_sync = n_frames

            first_chunk = self.chunks_taken
            audio_frames = [
                self.audio_output_queue.get() for _ in range(n_frames * 2)
            ]
            self.chunks_taken += len(audio_frames)
            audio_frames = self._silence_stale(audio_frames, first_chunk)
            is_no_speech = not any(
                state == AudioState.TALKING for _, state, _ in audio_frames
            )

            if is_no_speech == True:
                for i in range(n_frames):
                    batched_audio_frames = audio_frames[i * 2 : i * 2 + 2]
                    if not put_unless_stopped(
                        self.result_frame_queue,
                        (
                            None,
                            self.reflection(self.face_frames_len, index),
                            batched_audio_frames,
                        ),
                        signal_event,
                    ):
                        return
                    self.frames_in_lip_sync -= 1
                    index = index + 1
            else:
                started = time.perf_counter()
                if self.frame_gen_plan and self.frame_gen_active:
                    pred = self._run_keyframed_inference(feature_batch, index, debug)
                    n_keyframes = len(self.frame_gen_plan.keyframes)
                    self.frames_inferred += n_keyframes
                    self.frames_interpolated += self.batch_size - n_keyframes
                else:
                    pred = self._run_lipsync_inference(feature_batch, index, debug)
                    self.frames_inferred += self.batch_size
                took = time.perf_counter() - started
                self.batch_inference_seconds = (
                    took
                    if self.batch_inference_seconds == 0
                    else 0.8 * self.batch_inference_seconds + 0.2 * took
                )
                # Stopped while this batch was inferred.
                audio_frames = self._silence_stale(audio_frames, first_chunk)

                for i, res_frame in enumerate(pred):
                    batched_audio_frames = audio_frames[i * 2 : i * 2 + 2]
                    if not put_unless_stopped(
                        self.result_frame_queue,
                        (
                            res_frame,
                            self.reflection(self.face_frames_len, index),
                            batched_audio_frames,
                        ),
                        signal_event,
                    ):
                        return
                    self.frames_in_lip_sync -= 1
                    index = index + 1

    def _silence_stale(self, audio_frames, first_chunk):
        """Silence talking chunks queued before the last stop(), so they never play after it."""
        stale = self.stale_chunks_end - first_chunk
        if stale <= 0:
            return audio_frames
        silenced = []
        for i, (audio_frame, state, metadata) in enumerate(audio_frames):
            if i < stale and state == AudioState.TALKING:
                audio_frame, state = np.zeros_like(audio_frame), AudioState.SILENT
                with self._pending_lock:
                    self.pending_talk_chunks -= 1
            silenced.append((audio_frame, state, metadata))
        return silenced

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
        # Beyond what is queued: the batch text_to_speech may be filling right
        # now, from the input queue it clears only on its next call.
        self.stale_chunks_end = self.chunks_queued + self.batch_size * 2
        self.stop_infer = True
