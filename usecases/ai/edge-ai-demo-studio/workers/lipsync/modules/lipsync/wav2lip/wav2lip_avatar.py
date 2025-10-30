# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import torch
import pickle  # nosec B403 -- reading the pickle file created by another script only
import os
import cv2
import copy
import time
import numpy as np
import io

from threading import Thread
from tqdm import tqdm
from queue import Queue
from glob import glob
from modules.base.logger import getLogger
from modules.base.avatar import Avatar, text_wrapper
from modules.base.constants import CONSTANTS

from modules.lipsync.wav2lip.wav2lip256.models import Wav2Lip as Wav2Lip256
from modules.lipsync.wav2lip.wav2lip256 import audio as audio256
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
    """
    Safely load a pickle file using the restricted unpickler.

    Args:
        file_path (str): Path to the pickle file to load

    Returns:
        The deserialized object (restricted to safe types only)

    Raises:
        pickle.UnpicklingError: If the file contains unsafe types
    """
    with open(file_path, "rb") as f:
        return SafeUnpickler(f).load()


class Wav2lipAvatar(Avatar):
    def __init__(self, avatar_id, configs, device):
        super().__init__(avatar_id=avatar_id)

        self.configs = configs

        self.language_code = "en_us"
        self.device = device
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
        self.checkpoint_path = f"models/wav2lip/checkpoints/wav2lipv2.pth"

        self.stop_infer = False

        self.model = self.load_model()
        self.cv_frames, self.face_frames, self.face_frames_len, self.coords_list = (
            self.load_avatar(self.wav2lip_avatar_path)
        )

        assert self.face_frames_len > 0, "No face frames found in the avatar directory."

        self.warm_up()

    def unload_models(self):
        torch.xpu.empty_cache()

    def __del__(self):
        getLogger(__file__).info("Avatar deleted")
        self.unload_models()

    def load_model(self):
        self.model = Wav2Lip256()

        if self.device == "xpu":
            checkpoint = torch.load(
                self.checkpoint_path, map_location=self.device, weights_only=True
            )
        else:
            checkpoint = torch.load(
                self.checkpoint_path, map_location=lambda storage, loc: storage
            )
        state_dict = checkpoint["state_dict"]
        new_state_dict = {}
        for k, v in state_dict.items():
            new_state_dict[k.replace("module.", "")] = v
        self.model.load_state_dict(new_state_dict)

        self.model = self.model.to(device=self.device)
        self.model.eval()

        return self.model

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

    @torch.no_grad()
    def warm_up(self, batch_size=16):
        getLogger().info("Warm up model")
        img_batch = torch.ones(batch_size, 6, self.image_size, self.image_size).to(
            self.device
        )
        mel_batch = torch.ones(batch_size, 1, 80, 16).to(self.device)
        self.model(mel_batch, img_batch)

    @torch.no_grad()
    def _run_lipsync_inference(self, mel_batch, start_index, debug=False):
        """
        Modularized lipsync inference logic that can be reused for different input types.

        Args:
            mel_batch: Mel-spectrogram batch for audio features
            start_index: Starting frame index for face selection
            debug: Whether to enable debug timing logs

        Returns:
            numpy.ndarray: Predicted lip-synced face frames
        """
        # Prepare image batch
        img_batch = []
        for i in range(self.batch_size):
            idx = self.reflection(self.face_frames_len, start_index + i)
            face = self.face_frames[idx]
            img_batch.append(face)

        img_batch, mel_batch = np.asarray(img_batch), np.asarray(mel_batch)
        img_masked = img_batch.copy()
        img_masked[:, face.shape[0] // 2 :] = 0

        img_batch = np.concatenate((img_masked, img_batch), axis=3) / 255.0
        mel_batch = np.reshape(
            mel_batch,
            [len(mel_batch), mel_batch.shape[1], mel_batch.shape[2], 1],
        )

        img_batch = torch.FloatTensor(np.transpose(img_batch, (0, 3, 1, 2))).to(
            self.device
        )
        mel_batch = torch.FloatTensor(np.transpose(mel_batch, (0, 3, 1, 2))).to(
            self.device
        )

        # Run model and optionally measure inference time when debugging
        if debug:
            t_start = time.perf_counter()
            pred_tensor = self.model(mel_batch, img_batch)
            t_end = time.perf_counter()
            inf_time = t_end - t_start
        else:
            pred_tensor = self.model(mel_batch, img_batch)

        pred = pred_tensor.cpu().numpy().transpose(0, 2, 3, 1) * 255.0

        if debug:
            try:
                batch_n = int(pred_tensor.size(0))
            except Exception:
                batch_n = pred.shape[0] if hasattr(pred, "shape") else 0
            avg_per_frame = inf_time / max(batch_n, 1)
            getLogger(__file__).info(
                f"Wav2Lip inference: batch_size={batch_n}, total_time={inf_time:.6f}s, avg_per_frame={avg_per_frame:.6f}s"
            )

        return pred

    def process_audio_to_mel_chunks(self, audio_frames):
        """
        Convert audio frames to mel-spectrogram chunks for lipsync inference.

        Args:
            audio_frames: List of audio frame arrays

        Returns:
            list: Mel-spectrogram chunks ready for inference
        """
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

    @torch.no_grad()
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

        # Use the helper method to process audio to mel chunks
        mel_chunks = self.process_audio_to_mel_chunks(self.audio_frames)

        if mel_chunks:
            self.audio_feature_queue.put(mel_chunks)
            self.audio_frames = self.audio_frames[
                -(self.audio_left_stride + self.audio_right_stride) :
            ]

    @torch.no_grad()
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
                # Use modularized lipsync inference
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

            first_af, second_af = audio_frame[:2]
            if first_af[1] != AudioState.TALKING and second_af[1] != AudioState.TALKING:
                combine_frame = self.cv_frames[idx]
            else:
                bbox = self.coords_list[idx]
                combine_frame = copy.deepcopy(self.cv_frames[idx])
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

            # combine_frame = cv2.putText(combine_frame, self.avatar_id, (0, 25), cv2.FONT_HERSHEY_COMPLEX, 1, (255, 255, 255), 1, cv2.LINE_AA)
            self.combined_frame_queue.put((combine_frame, audio_frame))

    def start(self, signal_event):
        Thread(target=self.lip_sync, args=(signal_event,)).start()
        Thread(target=self.merge_video_audio, args=(signal_event,)).start()

    def reset(self):
        self.stop_infer = False

    def stop(self):
        self.stop_infer = True
