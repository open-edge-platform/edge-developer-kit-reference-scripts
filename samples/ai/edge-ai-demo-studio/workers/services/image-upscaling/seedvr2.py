# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""SeedVR2 (ByteDance, Apache-2.0) on PyTorch XPU: one-step diffusion restoration of still images.

SeedVR2 has no OpenVINO export, so this runs numz's standalone pipeline
(ComfyUI-SeedVR2_VideoUpscaler, Apache-2.0) with PyTorch. ``workers/upstream.json`` fetches it into
``./thirdparty/seedvr2`` at a pinned commit, with upstream pull request #590's Intel XPU support
applied (``seedvr2-xpu.patch``); start.sh does that before starting this preset. The four phases
run here as numz's CLI runs them for one image (``inference_cli._process_frames_core``): VAE
encode, one DiT step, VAE decode, LAB colour correction, with the transformer and VAE kept in
system memory between images.

SeedVR2 is a video model, but on a 24 GB GPU its batches stay short and it visibly jumps at every
batch boundary, so this worker offers it for still images only (README.md, Measurements).
"""

from __future__ import annotations

import gc
import sys
import time
from pathlib import Path

import numpy as np
import torch
from PIL import Image
from worker_common import JobCancelled, get_logger
from worker_common.devices import resolve_torch_device

from presets import Preset, preset_dir, weight_files

logger = get_logger(__name__)

SOURCE_DIR = Path(__file__).resolve().parent / "thirdparty" / "seedvr2"
# Largest input this worker takes (pixels): an 800x600 photo, upscaled to 3200x2400, peaked at 10.9 GiB
# of PyTorch allocations (15.7 GiB reserved) on an Arc Pro B60 in 24 s.
MAX_INPUT_PIXELS = 800 * 600
# Share of the GPU's memory PyTorch may take. Past it, an allocation fails with an out-of-memory error
# instead of spilling into system memory, where it can starve the rest of the machine.
MEMORY_FRACTION = 0.85
# As measured: the VAE encodes and decodes in 1024-pixel tiles overlapping by 128, which bounds its
# peak; attention is PyTorch SDPA (no flash-attn on XPU).
VAE_TILE = (1024, 1024)
VAE_TILE_OVERLAP = (128, 128)
SEED = 42
# Context entries a new image keeps; the rest is the previous image's (inference_cli.py).
_CONTEXT_KEYS = {
    "dit_device",
    "vae_device",
    "dit_offload_device",
    "vae_offload_device",
    "tensor_offload_device",
    "compute_dtype",
}


def ensure_weights(models_root: Path, preset: Preset) -> None:
    """The transformer and VAE, downloaded and checked against their sha256 (kept when already there)."""
    from model_downloader import fetch_url

    for url, sha256, path in weight_files(models_root, preset):
        fetch_url(url, dest=path, sha256=sha256)


def _pipeline():
    """numz's pipeline modules, from the copy upstream.json fetched beside this file."""
    if not (SOURCE_DIR / "src" / "core" / "generation_phases.py").is_file():
        raise RuntimeError(
            f"SeedVR2's pipeline is missing from {SOURCE_DIR}: run "
            "`workers/upstream-setup.sh fetch services/image-upscaling` (start.sh does)"
        )
    if str(SOURCE_DIR) not in sys.path:
        sys.path.insert(0, str(SOURCE_DIR))
    from src.core import generation_phases, generation_utils
    from src.utils.debug import Debug

    return generation_utils, generation_phases, Debug(enabled=False)


class SeedVR2Upscaler:
    """One SeedVR2 preset on one Intel GPU, with ``upscaler.Upscaler``'s interface for main.py.

    Not thread-safe: callers serialise ``upscale``.
    """

    def __init__(self, models_root: Path, preset: Preset, device: str):
        self.preset = preset
        self.scale = preset.scale
        self.precision = "fp16"
        self.image_only = True
        self.max_input_pixels = MAX_INPUT_PIXELS
        # The app offers XPU; AUTO or GPU (a deployment file) mean the same Intel GPU here.
        requested = "xpu" if (device or "").strip().upper() in ("", "AUTO", "GPU", "XPU") else device
        self.torch_device = resolve_torch_device(requested)
        if not self.torch_device.startswith("xpu"):
            raise RuntimeError(f"{preset.id} needs an Intel GPU with PyTorch XPU (--device XPU); none was found")
        index = int(self.torch_device.partition(":")[2] or torch.xpu.current_device())
        self.execution_device = "XPU" if index == 0 else f"XPU.{index}"
        self._index = index
        logger.info(f"{preset.id} on xpu:{index} ({torch.xpu.get_device_name(index)})")
        torch.xpu.set_per_process_memory_fraction(MEMORY_FRACTION, index)

        self._model_dir = preset_dir(models_root, preset)
        ensure_weights(models_root, preset)
        self._utils, self._phases, self._debug = _pipeline()
        self._ctx = None

    def _context(self, cancel):
        """The generation context: devices set once, the previous image's state dropped."""
        if self._ctx is None:
            device = f"xpu:{self._index}"
            # Kept in system memory between phases and images (numz's CLI with --cache_dit --cache_vae).
            self._ctx = self._utils.setup_generation_context(
                dit_device=device,
                vae_device=device,
                dit_offload_device="cpu",
                vae_offload_device="cpu",
                tensor_offload_device="cpu",
                debug=self._debug,
            )
        else:
            for key in [k for k in self._ctx if k not in _CONTEXT_KEYS]:
                del self._ctx[key]
        # Checked between batches in every phase: a cancelled job stops there (JobCancelled).
        self._ctx["interrupt_fn"] = cancel.check if cancel is not None else None
        return self._ctx

    def _run(self, rgb: np.ndarray, progress, cancel) -> np.ndarray:
        utils, phases, debug = self._utils, self._phases, self._debug
        h, w = rgb.shape[:2]
        resolution = self.scale * min(h, w)  # SeedVR2's target: the output's short side
        ctx = self._context(cancel)
        runner, cache_context = utils.prepare_runner(
            dit_model=Path(self.preset.url).name,
            vae_model=Path(self.preset.extra_files[0][0]).name,
            model_dir=str(self._model_dir),
            debug=debug,
            ctx=ctx,
            dit_cache=True,
            vae_cache=True,
            dit_id="dit",
            vae_id="vae",
            block_swap_config={"blocks_to_swap": 0, "swap_io_components": False, "offload_device": "cpu"},
            encode_tiled=True,
            encode_tile_size=VAE_TILE,
            encode_tile_overlap=VAE_TILE_OVERLAP,
            decode_tiled=True,
            decode_tile_size=VAE_TILE,
            decode_tile_overlap=VAE_TILE_OVERLAP,
            attention_mode="sdpa",
        )
        ctx["cache_context"] = cache_context
        ctx["text_embeds"] = utils.load_text_embeddings(
            utils.script_directory, ctx["dit_device"], ctx["compute_dtype"], debug
        )
        frames = torch.from_numpy(rgb).to(torch.float16).div_(255).unsqueeze(0)  # [1, H, W, 3]
        frames, _ = utils.compute_generation_info(
            ctx=ctx, images=frames, resolution=resolution, batch_size=1, seed=SEED, debug=debug
        )

        def step(done, stage):
            if progress:
                progress(done, 4, stage=stage)

        step(0, "Encoding")
        ctx = phases.encode_all_batches(
            runner,
            ctx=ctx,
            images=frames,
            debug=debug,
            batch_size=1,
            seed=SEED,
            resolution=resolution,
            color_correction="lab",
        )
        step(1, "Restoring")
        ctx = phases.upscale_all_batches(runner, ctx=ctx, debug=debug, seed=SEED, cache_model=True)
        step(2, "Decoding")
        ctx = phases.decode_all_batches(runner, ctx=ctx, debug=debug, cache_model=True)
        step(3, "Colour correction")
        ctx = phases.postprocess_all_batches(ctx=ctx, debug=debug, color_correction="lab", batch_size=1)
        out = ctx["final_video"][0].float().clamp_(0, 1).mul_(255).round_().to(torch.uint8).cpu().numpy()
        for key in ("final_video", "all_latents", "all_upscaled_latents", "batch_samples"):
            ctx[key] = None
        return out

    def upscale(self, image: np.ndarray, progress=None, cancel=None, repeated=False) -> np.ndarray:
        """``image`` (H, W, 3 uint8 RGB) -> (H*scale, W*scale, 3 uint8 RGB).

        ``progress(done, total, stage=...)`` runs between the four phases; a cancelled ``cancel``
        raises JobCancelled at the next check. ``repeated`` is accepted for the interface.
        """
        h, w = image.shape[:2]
        if h * w > self.max_input_pixels:
            raise ValueError(
                f"{self.preset.id} takes images of at most {self.max_input_pixels / 1e6:.2f} megapixels "
                f"(800x600); this one is {w}x{h}"
            )
        failed = None
        # Out of memory and cancelled are re-raised fresh: a kept traceback would hold the failed
        # run's tensors on the GPU until the job thread let go of it.
        try:
            out = self._run(image, progress, cancel)
        except torch.OutOfMemoryError:
            failed = RuntimeError(
                f"Out of GPU memory upscaling a {w}x{h} image: free the GPU of other work, or use a smaller image"
            )
        except JobCancelled:
            failed = JobCancelled()
        except Exception as e:  # noqa: BLE001 - re-raised below, after the cleanup
            failed = e
        if failed is not None:
            # Outside the except block, which holds the traceback until it ends.
            self._ctx = None
            gc.collect()
            torch.xpu.empty_cache()
            raise failed
        size = (w * self.scale, h * self.scale)
        if out.shape[1::-1] != size:
            # The pipeline rounds odd sizes internally; the caller expects exactly scale x.
            out = np.asarray(Image.fromarray(out).resize(size, Image.Resampling.LANCZOS))
        return out

    def warm_up(self) -> float:
        """Load both models and run the first kernels on a small image; returns its seconds.

        main.py runs this inside its loading-model startup stage.
        """
        started = time.perf_counter()
        self.upscale(np.full((64, 64, 3), 128, np.uint8))
        seconds = time.perf_counter() - started
        logger.info(f"{self.preset.id}: warm-up (model load and first run) took {seconds:.1f}s")
        return seconds
