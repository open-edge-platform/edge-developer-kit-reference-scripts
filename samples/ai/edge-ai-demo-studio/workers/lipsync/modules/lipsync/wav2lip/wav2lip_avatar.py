# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import torch
import pickle  # nosec B403 -- reading the pickle file created by another script only
import os
import cv2
import copy
import time
import numpy as np
import io

import openvino as ov

from threading import Thread, Lock
from tqdm import tqdm
from pathlib import Path
from queue import Queue
from glob import glob
from modules.base.logger import getLogger
from modules.base.avatar import Avatar, text_wrapper
from modules.base.constants import CONSTANTS

from modules.lipsync.wav2lip.wav2lip256.models import Wav2Lip as Wav2Lip256
from modules.lipsync.wav2lip.wav2lip256 import audio as audio256
from modules.texttospeech.kokoro_tts import AudioState

_COMPILED_MODEL_CACHE = {}
_CACHE_LOCK = Lock()


def compile_wav2lip_model(model_path, ov_device, batch_size, image_size):
    ov_device = ov_device.upper()
    cache_key = (str(model_path), ov_device, batch_size, image_size)
    with _CACHE_LOCK:
        entry = _COMPILED_MODEL_CACHE.get(cache_key)
        if entry is not None:
            getLogger(__file__).info(
                f"Reusing cached OpenVINO Wav2Lip model on {ov_device}."
            )
            return entry["model"]

        getLogger(__file__).info(f"Loading OpenVINO Wav2Lip model on {ov_device}...")
        core = ov.Core()
        ov_model = core.read_model(model_path)
        if ov_device == "NPU":
            ov_model.reshape(
                {
                    "audio_sequences": [batch_size, 1, 80, 16],
                    "face_sequences": [batch_size, 6, image_size, image_size],
                }
            )
        compiled = core.compile_model(ov_model, ov_device)
        infer_request = compiled.create_infer_request()
        _warm_up_request(infer_request, batch_size, image_size)
        _COMPILED_MODEL_CACHE[cache_key] = {
            "model": compiled,
            "request": infer_request,
            "lock": Lock(),
        }
        getLogger(__file__).info("OpenVINO Wav2Lip model loaded.")
        return compiled


def get_shared_inference(model_path, ov_device, batch_size, image_size):
    """Return the (compiled_model, infer_request, lock) triple shared by every
    session using the same model parameters. All inference must go through this
    single request under the lock so the NPU only ever sees one inference
    context, avoiding device-lost hangs."""
    compile_wav2lip_model(model_path, ov_device, batch_size, image_size)
    cache_key = (str(model_path), ov_device.upper(), batch_size, image_size)
    entry = _COMPILED_MODEL_CACHE[cache_key]
    return entry["model"], entry["request"], entry["lock"]


def _warm_up_request(infer_request, batch_size, image_size):
    """Run a single dummy inference to prime the compiled model. Called once when
    the model is compiled so the first real connection doesn't pay this cost."""
    getLogger(__file__).info("Warm up model")
    img_batch = np.random.rand(batch_size, 6, image_size, image_size).astype(np.float32)
    mel_batch = np.random.rand(batch_size, 1, 80, 16).astype(np.float32)
    infer_request.infer({"audio_sequences": mel_batch, "face_sequences": img_batch})


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


class Wav2lipAvatar(Avatar):
    def __init__(self, avatar_id, configs, device, use_int8=False):
        super().__init__(avatar_id=avatar_id)

        self.configs = configs

        self.language_code = "en_us"
        self.device = device
        self.ov_device = device.upper()
        self.use_int8 = use_int8
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
        self.audio_left_stride = 2
        self.audio_right_stride = 2
        self.audio_frames = []

        self.wav2lip_avatar_path = self.configs.get("wav2lip", {}).get(
            "avatar_path", "./data/avatars/wav2lip_avatar1"
        )
        self.image_size = int(self.wav2lip_avatar_path.split("_")[-1])
        self.checkpoint_path = "models/wav2lip/checkpoints/wav2lipv2.pth"
        self.ov_model_path = "models/wav2lip/checkpoints/wav2lipv2_ov/wav2lip.xml"
        self.int8_model_path = (
            "models/wav2lip/checkpoints/wav2lipv2_ov_int8/wav2lip.xml"
        )

        self.stop_infer = False

        self.ov_compiled_model = None
        self.infer_request = None
        self.infer_lock = None
        self.load_model()

        self.cv_frames, self.face_frames, self.face_frames_len, self.coords_list = (
            self.load_avatar(self.wav2lip_avatar_path)
        )

        assert self.face_frames_len > 0, "No face frames found in the avatar directory."

    def unload_models(self):
        # Only drop this session's references; the compiled model, its shared
        # InferRequest and lock stay in the cache so other/future sessions keep
        # reusing them.
        self.infer_request = None
        self.infer_lock = None
        self.ov_compiled_model = None

    def __del__(self):
        getLogger(__file__).info("Avatar deleted")
        self.unload_models()

    def _convert_to_openvino(self):
        """Convert PyTorch checkpoint to OpenVINO IR if not already done."""
        ov_path = Path(self.ov_model_path)
        if ov_path.exists():
            return

        getLogger(__file__).info("Converting Wav2Lip model to OpenVINO IR...")
        pt_model = Wav2Lip256()
        checkpoint = torch.load(
            self.checkpoint_path,
            map_location=lambda storage, loc: storage,
            weights_only=True,
        )
        state_dict = checkpoint["state_dict"]
        new_state_dict = {k.replace("module.", ""): v for k, v in state_dict.items()}
        pt_model.load_state_dict(new_state_dict)
        pt_model.eval()

        mel_dummy = torch.FloatTensor(np.random.rand(self.batch_size, 1, 80, 16))
        img_dummy = torch.FloatTensor(
            np.random.rand(self.batch_size, 6, self.image_size, self.image_size)
        )
        example_inputs = {
            "audio_sequences": mel_dummy,
            "face_sequences": img_dummy,
        }

        ov_model = ov.convert_model(pt_model, example_input=example_inputs)

        # Set dynamic batch dimension for flexible inference
        for input_tensor in ov_model.inputs:
            shape = input_tensor.get_partial_shape()
            shape[0] = -1  # dynamic batch
            input_tensor.get_node().set_partial_shape(shape)
        ov_model.validate_nodes_and_infer_types()

        ov_path.parent.mkdir(parents=True, exist_ok=True)
        ov.save_model(ov_model, str(ov_path))
        getLogger(__file__).info(f"OpenVINO model saved: {ov_path}")

    def load_model(self):
        self._convert_to_openvino()

        # Prefer the INT8 model when requested and available (e.g. for NPU).
        model_path = self.ov_model_path
        precision = "FP16"
        if self.use_int8:
            if Path(self.int8_model_path).exists():
                model_path = self.int8_model_path
                precision = "INT8"
            else:
                getLogger(__file__).warning(
                    f"INT8 requested but model not found at {self.int8_model_path}; "
                    "falling back to FP16. Run the worker with --int8 to generate it."
                )

        getLogger(__file__).info(f"Using OpenVINO Wav2Lip {precision} model.")
        self.ov_compiled_model, self.infer_request, self.infer_lock = (
            get_shared_inference(
                model_path, self.ov_device, self.batch_size, self.image_size
            )
        )

    def load_avatar(self, avatar_path):
        getLogger(__file__).info("Reading Avatar Images")

        def _read_cv_images(images_path):
            image_pattern = f"{images_path}/*.[jpJP][pnPN]*[gG]"
            input_images_list = sorted(
                glob(image_pattern),
                key=lambda x: int(os.path.splitext(os.path.basename(x))[0]),
            )
            frames = [cv2.imread(image_path) for image_path in tqdm(input_images_list)]
            return frames

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

        self.wav2lip_avatar_path = avatar_path
        self.cv_frames, self.face_frames, self.face_frames_len, self.coords_list = (
            cv_frames,
            face_frames,
            face_frames_len,
            coords_list,
        )
        getLogger(__file__).info(f"Avatar hot-reloaded from {avatar_path}")

    def _run_lipsync_inference(self, mel_batch, start_index, debug=False):
        # The audio pipeline can yield fewer mel chunks than batch_size (e.g.
        # 14 on the very first talking batch, before the stride leftover
        # stabilizes). The model concatenates audio and face embeddings, so the
        # two batches must match — and NPU is compiled for a static batch.
        # Pad by repeating the last chunk; extra frames still pair with real
        # audio frames downstream.
        mel_batch = list(mel_batch)[: self.batch_size]
        if len(mel_batch) < self.batch_size:
            mel_batch += [mel_batch[-1]] * (self.batch_size - len(mel_batch))

        # Snapshot the frame list so a concurrent reload_avatar can't change
        # the list length between the reflection() index math and the lookup.
        face_frames = self.face_frames
        face_frames_len = len(face_frames)

        img_batch = []
        for i in range(self.batch_size):
            idx = self.reflection(face_frames_len, start_index + i)
            face = face_frames[idx]
            img_batch.append(face)

        img_batch, mel_batch = np.asarray(img_batch), np.asarray(mel_batch)
        img_masked = img_batch.copy()
        img_masked[:, face.shape[0] // 2 :] = 0

        img_batch = np.concatenate((img_masked, img_batch), axis=3) / 255.0
        mel_batch = np.reshape(
            mel_batch,
            [len(mel_batch), mel_batch.shape[1], mel_batch.shape[2], 1],
        )

        img_np = np.transpose(img_batch, (0, 3, 1, 2)).astype(np.float32)
        mel_np = np.transpose(mel_batch, (0, 3, 1, 2)).astype(np.float32)

        t_start = time.perf_counter() if debug else 0
        # Serialize NPU access: the shared InferRequest is used by every session,
        # and its output tensors stay valid only until the next infer() call, so
        # both the call and the result read must happen under the lock.
        with self.infer_lock:
            result = self.infer_request.infer(
                {"audio_sequences": mel_np, "face_sequences": img_np}
            )
            pred = (
                result[self.ov_compiled_model.output(0)].transpose(0, 2, 3, 1) * 255.0
            )
        inf_time = time.perf_counter() - t_start if debug else 0

        if debug:
            batch_n = pred.shape[0]
            getLogger(__file__).info(
                f"Wav2Lip OV inference: batch_size={batch_n}, total_time={inf_time:.6f}s, avg_per_frame={inf_time / max(batch_n, 1):.6f}s"
            )

        return pred

    def process_audio_to_mel_chunks(self, audio_frames):
        if len(audio_frames) <= self.audio_left_stride + self.audio_right_stride:
            return []

        inputs = np.concatenate(audio_frames)
        mel = audio256.melspectrogram(inputs)

        left = max(0, self.audio_left_stride * 80 / self.audio_fps)
        mel_idx_multiplier = 80.0 * 2 / self.audio_fps

        mel_step_size, i, mel_chunks = 16, 0, []
        while (
            i
            < (len(audio_frames) - self.audio_left_stride - self.audio_right_stride) / 2
        ):
            start_idx = int(left + i * mel_idx_multiplier)
            if start_idx + mel_step_size > len(mel[0]):
                mel_chunks.append(mel[:, len(mel[0]) - mel_step_size :])
            else:
                mel_chunks.append(mel[:, start_idx : start_idx + mel_step_size])
            i += 1

        return mel_chunks

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
                except Exception:
                    (audio_frame, metadata), state = (
                        np.zeros(self.audio_chunk_size, dtype=np.float32),
                        None,
                    ), AudioState.SILENT

                self.audio_output_queue.put((audio_frame, state, metadata))
                self.audio_frames.append(audio_frame)

        mel_chunks = self.process_audio_to_mel_chunks(self.audio_frames)

        if mel_chunks:
            self.audio_feature_queue.put(mel_chunks)
            self.audio_frames = self.audio_frames[
                -(self.audio_left_stride + self.audio_right_stride) :
            ]

    def lip_sync(self, signal_event, debug=False):
        index = 0

        while not signal_event.is_set():
            mel_batch = []

            try:
                mel_batch = self.audio_feature_queue.get(block=True, timeout=1)
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
                pred = self._run_lipsync_inference(mel_batch, index, debug)

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

            first_af, second_af = audio_frame[:2]
            if first_af[1] != AudioState.TALKING and second_af[1] != AudioState.TALKING:
                combine_frame = cv_frames[idx]
            else:
                bbox = coords_list[min(idx, len(coords_list) - 1)]
                combine_frame = copy.deepcopy(cv_frames[idx])
                y1, y2, x1, x2 = bbox
                try:
                    res_frame = cv2.resize(
                        res_frame.astype(np.uint8), (x2 - x1, y2 - y1)
                    )
                except:
                    continue

                combine_frame[y1:y2, x1:x2] = res_frame

                _, _, metadata = audio_frame[0]

                if metadata is not None:
                    message = metadata.get("message", "")
                    language_code = metadata.get("language_code", "en-US")
                    combine_frame = text_wrapper(
                        combine_frame, message, language_code, self.image_width
                    )

            self.combined_frame_queue.put((combine_frame, audio_frame))

    def start(self, signal_event):
        Thread(target=self.lip_sync, args=(signal_event,)).start()
        Thread(target=self.merge_video_audio, args=(signal_event,)).start()

    def reset(self):
        self.stop_infer = False

    def stop(self):
        self.stop_infer = True
