# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import time
import numpy as np

import openvino as ov

from threading import Lock
from pathlib import Path
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
        # The batch is fixed per compiled entry, so always reshape to a static
        # batch: NPU requires it, and the GPU plugin is dramatically slower
        # with dynamic shapes.
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


def measure_wav2lip_inference_fps(model_path, ov_device, batch_size, image_size, runs=5):
    """Median frames/sec of the shared compiled Wav2Lip model at full batch.

    Uses (and warms) the same shared inference request the sessions will use,
    so the number reflects what lip_sync actually gets on this device.
    """
    _, infer_request, lock = get_shared_inference(
        model_path, ov_device, batch_size, image_size
    )
    img_batch = np.random.rand(batch_size, 6, image_size, image_size).astype(np.float32)
    mel_batch = np.random.rand(batch_size, 1, 80, 16).astype(np.float32)
    inputs = {"audio_sequences": mel_batch, "face_sequences": img_batch}

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
    """Wav2Lip lipsync session: mel-spectrogram audio features and a single
    image-to-image OpenVINO model."""

    # 2 audio chunks (one video frame) of mel context on each side.
    audio_left_stride = 2
    audio_right_stride = 2

    def __init__(self, avatar_id, configs, device, use_int8=False, frame_gen_plan=None):
        self.use_int8 = use_int8
        self.checkpoint_path = "models/wav2lip/checkpoints/wav2lipv2.pth"
        self.ov_model_path = "models/wav2lip/checkpoints/wav2lipv2_ov/wav2lip.xml"
        self.int8_model_path = (
            "models/wav2lip/checkpoints/wav2lipv2_ov_int8/wav2lip.xml"
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

    def unload_models(self):
        # Only drop this session's references; the compiled model, its shared
        # InferRequest and lock stay in the cache so other/future sessions keep
        # reusing them.
        self.infer_request = None
        self.infer_lock = None
        self.ov_compiled_model = None
        self.kf_model = None
        self.kf_request = None
        self.kf_lock = None
        self.frame_gen_plan = None
        self.frame_gen_active = False

    def _convert_to_openvino(self):
        """Convert PyTorch checkpoint to OpenVINO IR if not already done.

        The only place this session code touches PyTorch; imported lazily so
        the running service stays OpenVINO-only once the IR exists.
        """
        ov_path = Path(self.ov_model_path)
        if ov_path.exists():
            return

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
        self.model_path = model_path
        self.ov_compiled_model, self.infer_request, self.infer_lock = (
            get_shared_inference(
                model_path, self.ov_device, self.batch_size, self.image_size
            )
        )

    def _prepare_keyframe_inference(self):
        # Every compiled entry has a static batch, so keyframe-only inference
        # uses a dedicated model sized to the keyframe batch; that is what
        # makes it cheaper than a full batch.
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
            # Keyframe-only inference for frame generation: feature_batch
            # already holds exactly one chunk per position, and the request is
            # sized (or dynamic enough) for that batch.
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

        img_batch = []
        for i in positions:
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
