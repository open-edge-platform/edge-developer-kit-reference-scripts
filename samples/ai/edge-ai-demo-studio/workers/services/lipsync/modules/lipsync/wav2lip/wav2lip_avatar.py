# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import time
import numpy as np

import openvino as ov

from openvino.preprocess import PrePostProcessor
from threading import Lock
from pathlib import Path
from worker_common import (
    models_dir,
    openvino_compile_config,
    openvino_execution_device,
    shared_model_lock,
    staged_model_file,
)
from modules.base.logger import getLogger
from modules.lipsync.lipsync_avatar import LipsyncAvatar

from modules.lipsync.wav2lip.wav2lip256 import audio as audio256

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
        # Static batch per compiled entry: the NPU requires it and the GPU plugin is much slower
        # with dynamic shapes.
        ov_model.reshape(
            {
                "audio_sequences": [batch_size, 1, 80, 16],
                "face_sequences": [batch_size, 6, image_size, image_size],
            }
        )
        # Faces go in as uint8 NHWC and are scaled/transposed on the device: in numpy that took
        # longer than the inference itself on a discrete GPU.
        ppp = PrePostProcessor(ov_model)
        faces = ppp.input("face_sequences")
        faces.tensor().set_element_type(ov.Type.u8).set_layout(ov.Layout("NHWC"))
        faces.preprocess().convert_element_type(ov.Type.f32).scale(255.0)
        faces.model().set_layout(ov.Layout("NCHW"))
        ov_model = ppp.build()
        # Under AUTO, no startup CPU fallback: the warm-up and the FPS
        # measurement time the device OpenVINO selected.
        compiled = core.compile_model(
            ov_model, ov_device, openvino_compile_config(ov_device)
        )
        infer_request = compiled.create_infer_request()
        _warm_up_request(infer_request, batch_size, image_size)
        _COMPILED_MODEL_CACHE[cache_key] = {
            "model": compiled,
            "request": infer_request,
            "lock": Lock(),
        }
        getLogger(__file__).info(
            "OpenVINO Wav2Lip model loaded on "
            f"{openvino_execution_device(compiled, ov_device)}."
        )
        return compiled


def get_shared_inference(model_path, ov_device, batch_size, image_size):
    """(compiled_model, infer_request, lock) shared by every session with the same parameters.

    All inference goes through this one request under the lock, so the NPU sees a single context
    (avoids device-lost hangs).
    """
    compile_wav2lip_model(model_path, ov_device, batch_size, image_size)
    cache_key = (str(model_path), ov_device.upper(), batch_size, image_size)
    entry = _COMPILED_MODEL_CACHE[cache_key]
    return entry["model"], entry["request"], entry["lock"]


def _warm_up_request(infer_request, batch_size, image_size):
    """Prime the compiled model so the first real connection doesn't pay for it."""
    getLogger(__file__).info("Warm up model")
    infer_request.infer(_random_inputs(batch_size, image_size))


def _random_inputs(batch_size, image_size):
    return {
        "audio_sequences": np.random.rand(batch_size, 1, 80, 16).astype(np.float32),
        "face_sequences": (
            np.arange(batch_size * image_size * image_size * 6) % 256
        ).astype(np.uint8).reshape(batch_size, image_size, image_size, 6),
    }


def measure_wav2lip_inference_fps(model_path, ov_device, batch_size, image_size, runs=5):
    """Median frames/sec at full batch, on the shared request sessions use."""
    _, infer_request, lock = get_shared_inference(
        model_path, ov_device, batch_size, image_size
    )
    inputs = _random_inputs(batch_size, image_size)

    with lock:
        infer_request.infer(inputs)
        times = []
        for _ in range(runs):
            start = time.perf_counter()
            infer_request.infer(inputs)
            times.append(time.perf_counter() - start)

    batch_time = sorted(times)[len(times) // 2]
    fps = batch_size / batch_time
    getLogger(__file__).info(
        f"Wav2Lip inference on {ov_device}: {batch_time:.3f}s per batch of "
        f"{batch_size} => {fps:.1f} FPS"
    )
    return fps


class Wav2lipAvatar(LipsyncAvatar):
    """Wav2Lip session: mel-spectrogram features and one image-to-image OpenVINO model."""

    # 2 audio chunks (one video frame) of mel context on each side.
    audio_left_stride = 2
    audio_right_stride = 2

    # Mel features are cut from the audio window alone (no state), so idle
    # batches can be short.
    idle_batch_frames = 2

    def __init__(self, avatar_id, configs, device, use_int8=False, frame_gen_plan=None):
        self.use_int8 = use_int8
        # Same paths as main.py's CHECKPOINT_PATH/OV_FP16_PATH/OV_INT8_PATH.
        self.checkpoint_path = str(models_dir("wav2lip", "checkpoints", "wav2lipv2.pth"))
        self.ov_model_path = str(
            models_dir("wav2lip", "checkpoints", "wav2lipv2_ov", "wav2lip.xml")
        )
        self.int8_model_path = str(
            models_dir("wav2lip", "checkpoints", "wav2lipv2_ov_int8", "wav2lip.xml")
        )

        self.ov_compiled_model = None
        self.infer_request = None
        self.infer_lock = None

        super().__init__(
            avatar_id=avatar_id,
            configs=configs,
            device=device,
            frame_gen_plan=frame_gen_plan,
        )
        # A process's first mel spectrogram sets librosa up (~0.2 s): here
        # rather than on the first sentence spoken (idle batches make none).
        self.extract_audio_features(
            [np.zeros(self.audio_chunk_size, dtype=np.float32)] * 8
        )

    def unload_models(self):
        # Only this session's references; the compiled model stays cached for other sessions.
        self.infer_request = None
        self.infer_lock = None
        self.ov_compiled_model = None
        self.kf_model = None
        self.kf_request = None
        self.kf_lock = None
        self.frame_gen_plan = None
        self.frame_gen_active = False

    def _convert_to_openvino(self):
        """Convert the checkpoint to OpenVINO IR if not already done (PyTorch imported lazily)."""
        ov_path = Path(self.ov_model_path)
        if ov_path.exists():
            return
        # Another instance may be converting the same file right now.
        with shared_model_lock(ov_path):
            if not ov_path.exists():
                self._convert_checkpoint(ov_path)

    def _convert_checkpoint(self, ov_path: Path):
        import torch

        from modules.lipsync.wav2lip.wav2lip256.models import Wav2Lip as Wav2Lip256

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

        for input_tensor in ov_model.inputs:
            shape = input_tensor.get_partial_shape()
            shape[0] = -1  # dynamic batch
            input_tensor.get_node().set_partial_shape(shape)
        ov_model.validate_nodes_and_infer_types()

        with staged_model_file(ov_path) as staged:
            ov.save_model(ov_model, staged)
        getLogger(__file__).info(f"OpenVINO model saved: {ov_path}")

    def load_model(self):
        self._convert_to_openvino()

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
        self.model_path = model_path
        self.ov_compiled_model, self.infer_request, self.infer_lock = (
            get_shared_inference(
                model_path, self.ov_device, self.batch_size, self.image_size
            )
        )

    def _prepare_keyframe_inference(self):
        # Compiled entries have a static batch, so keyframe-only inference gets its own model
        # sized to the keyframe batch.
        self.kf_model, self.kf_request, self.kf_lock = get_shared_inference(
            self.model_path,
            self.ov_device,
            len(self.frame_gen_plan.keyframes),
            self.image_size,
        )

    def _run_lipsync_inference(self, feature_batch, start_index, debug=False, positions=None):
        if positions is None:
            positions = range(self.batch_size)
            mel_batch = self._pad_feature_batch(feature_batch)
            compiled_model, infer_request, infer_lock = (
                self.ov_compiled_model,
                self.infer_request,
                self.infer_lock,
            )
        else:
            # Keyframe-only inference: one feature per position, on the keyframe-batch request.
            mel_batch = feature_batch
            compiled_model, infer_request, infer_lock = (
                self.kf_model,
                self.kf_request,
                self.kf_lock,
            )

        # Snapshot the frame list so a concurrent reload_avatar can't change
        # the list length between the reflection() index math and the lookup.
        face_frames = self.face_frames
        face_frames_len = len(face_frames)

        faces = np.stack(
            [
                face_frames[self.reflection(face_frames_len, start_index + i)]
                for i in positions
            ]
        )
        # Each face with its lower half blanked, then as it is, stacked on
        # the channel axis; uint8, channels last (see compile_wav2lip_model).
        img_np = np.concatenate((faces, faces), axis=3)
        img_np[:, faces.shape[1] // 2 :, :, :3] = 0
        mel_np = np.asarray(mel_batch, dtype=np.float32)[:, np.newaxis]

        t_start = time.perf_counter() if debug else 0
        # The InferRequest is shared by every session and its outputs are valid only until the next
        # infer(), so the result is read under the lock too.
        with infer_lock:
            result = infer_request.infer(
                {"audio_sequences": mel_np, "face_sequences": img_np}
            )
            pred = result[compiled_model.output(0)].transpose(0, 2, 3, 1) * 255.0
        inf_time = time.perf_counter() - t_start if debug else 0

        if debug:
            batch_n = pred.shape[0]
            getLogger(__file__).info(
                f"Wav2Lip OV inference: batch_size={batch_n}, total_time={inf_time:.6f}s, avg_per_frame={inf_time / max(batch_n, 1):.6f}s"
            )

        return pred

    def extract_audio_features(self, audio_frames):
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
