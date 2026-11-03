# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import os
from pathlib import Path

from worker_common import (
    CancelToken,
    JobCancelled,
    instance_data_dir,
    migrate_legacy_models_dir,
    models_dir,
    use_shared_hf_cache,
)

# Use the shared HF cache under models/ (reached by "Clear model cache"), migrating this worker's old
# one. Must run before huggingface_hub is imported: it reads HF_HOME once, at import.
_hf_moved = use_shared_hf_cache(models_dir("synthetic-image-generation", "huggingface"))

import time
import logging
import torch
from PIL import Image, ImageDraw
from typing import Callable, Optional, Union
from ultralytics import FastSAM
from transformers import Qwen3ForCausalLM
from diffusers import AutoModel, Flux2KleinPipeline, AutoencoderKLFlux2
from diffusers import BitsAndBytesConfig as DiffusersBitsAndBytesConfig
from transformers import BitsAndBytesConfig as TransformersBitsAndBytesConfig

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# FastSAM weights live under models_dir() so "Clear model cache" finds them; the legacy
# worker-relative models/ directory is migrated there.
_WORKER_DIR = Path(__file__).resolve().parent.parent
_MODELS_ROOT = models_dir("synthetic-image-generation")
_migration_msg = migrate_legacy_models_dir(_WORKER_DIR / "models", _MODELS_ROOT)
if _migration_msg:
    logger.info(_migration_msg)
if _hf_moved:
    logger.info(_hf_moved)
_MODELS_ROOT.mkdir(parents=True, exist_ok=True)


class ImageGenPrompt:
    SYNTHETIC_PROMPT = """Create an enhanced version of the input image.
All objects, positions, shapes, edges, dimensions, and orientations must remain identical to the original.
No new elements, no missing elements, no deformation, no perspective change.
Only apply image-level improvements such as noise reduction, contrast normalization, color correction, and slight lighting variation.
The output images must be pixel-structure consistent with the original."""
    MISSING_COMPONENT_PROMPT = """Remove the items in the red bounding box."""


class ImageGen:
    # FLUX.2-klein is distilled to a few denoising steps.
    NUM_INFERENCE_STEPS = 4

    def __init__(
        self,
        mode: str = "local",
        model_id: str = "black-forest-labs/FLUX.2-klein-4B",
        device="xpu",
        dtype=torch.bfloat16,
        enable_cpu_offload: bool = False,
    ):
        self.mode = mode
        self.model_id = model_id
        self.device = device
        self.dtype = dtype
        self.enable_cpu_offload = enable_cpu_offload
        self.pipeline = None

        if self.mode == "local":
            if "FLUX.2-klein" in self.model_id:
                self._load_flux2_model_pipeline()
            else:
                raise NotImplementedError(
                    "Only FLUX.2-klein models are supported currently."
                )
        else:
            raise NotImplementedError("Only local mode is supported currently.")

    def _load_flux2_model_pipeline(
        self, use_quantized: bool = True, optimize_decoder: bool = False
    ):
        logger.info(
            f"Loading model pipeline from {self.model_id} on device {self.device} with dtype {self.dtype}"
        )

        if use_quantized:
            text_encoder_quant_config = TransformersBitsAndBytesConfig(
                load_int_4bit=True,
                bnb_4bit_quant_type="nf4",
                bnb_4bit_compute_dtype=self.dtype,
            )
            quant_text_encoder = Qwen3ForCausalLM.from_pretrained(
                self.model_id,
                subfolder="text_encoder",
                torch_dtype=self.dtype,
                quantization_config=text_encoder_quant_config,
            ).to(self.device)

            transformer_quant_config = DiffusersBitsAndBytesConfig(
                load_int_4bit=True,
                bnb_4bit_quant_type="nf4",
                bnb_4bit_compute_dtype=self.dtype,
            )
            quant_transformer = AutoModel.from_pretrained(
                self.model_id,
                subfolder="transformer",
                torch_dtype=self.dtype,
                quantization_config=transformer_quant_config,
            ).to(self.device)

            if optimize_decoder:
                quant_vae = AutoencoderKLFlux2.from_pretrained(
                    "black-forest-labs/FLUX.2-small-decoder", torch_dtype=self.dtype
                ).to(self.device)
            else:
                quant_vae = AutoModel.from_pretrained(
                    self.model_id,
                    subfolder="vae",
                    torch_dtype=self.dtype,
                ).to(self.device)

            self.pipeline = Flux2KleinPipeline.from_pretrained(
                self.model_id,
                transformer=quant_transformer,
                text_encoder=quant_text_encoder,
                vae=quant_vae,
                torch_dtype=self.dtype,
            )
        else:
            self.pipeline = Flux2KleinPipeline.from_pretrained(
                self.model_id, torch_dtype=self.dtype
            )

        logger.info("Converting model pipeline to channels_last memory format.")
        self.pipeline.transformer.to(memory_format=torch.channels_last)
        self.pipeline.vae.to(memory_format=torch.channels_last)

        if self.enable_cpu_offload:
            logger.info("Enabling model CPU offload to save VRAM.")
            self.pipeline.enable_model_cpu_offload()
        logger.info("Model pipeline loaded successfully.")

    def pad_image_to_square(self, image):
        width, height = image.size
        if width == height:
            return image
        max_side = max(width, height)
        new_image = Image.new("RGB", (max_side, max_side))
        new_image.paste(image, ((max_side - width) // 2, (max_side - height) // 2))
        new_width, new_height = new_image.size
        return new_image

    def unpad_image(self, image, original_width, original_height):
        return image.crop(
            (
                (image.width - original_width) // 2,
                (image.height - original_height) // 2,
                (image.width + original_width) // 2,
                (image.height + original_height) // 2,
            )
        )

    def resize_image(self, image, target_size=1024):
        return image.resize((target_size, target_size))

    def inference(
        self,
        image: Union[Image.Image, list[Image.Image]],
        prompt: str,
        height: int,
        width: int,
        seed: int = 42,
        on_step: Optional[Callable[[int, int], None]] = None,
        cancel: Optional[CancelToken] = None,
    ):
        """``on_step(done, steps)`` runs per denoising step; a set ``cancel`` raises ``JobCancelled``."""
        if self.mode == "local":
            st = time.time()
            steps = self.NUM_INFERENCE_STEPS

            def step_end(_pipeline, step_index, _timestep, callback_kwargs):
                if cancel is not None:
                    cancel.check()
                if on_step is not None:
                    on_step(step_index + 1, steps)
                return callback_kwargs

            if cancel is not None:
                cancel.check()
            # Cancel by raising from the step callback, not via `_interrupt`, which would still decode
            # the half-denoised latents. The next call resets the scheduler state itself; the model
            # hooks are freed below.
            try:
                result_image = self.pipeline(
                    prompt=prompt,
                    image=image,
                    height=height,
                    width=width,
                    guidance_scale=1.0,
                    num_inference_steps=steps,
                    generator=torch.Generator(device=self.device).manual_seed(seed),
                    callback_on_step_end=(
                        step_end if on_step is not None or cancel is not None else None
                    ),
                ).images[0]
            except JobCancelled:
                self.pipeline.maybe_free_model_hooks()
                logger.info(
                    f"Image generation cancelled after {time.time() - st:.2f} seconds."
                )
                raise
            logger.info(
                f"Image generation completed in {time.time() - st:.2f} seconds."
            )
            return result_image
        else:
            raise NotImplementedError("Only local mode is supported currently.")


class ImageSegmentation:
    def __init__(self, model_id: str = "FastSAM-s.pt", use_openvino: bool = True):
        self.model = FastSAM(str(_MODELS_ROOT / model_id))
        self.ov_model = None
        if use_openvino:
            ov_dir = _MODELS_ROOT / model_id.replace(".pt", "_openvino_model")
            # The export is slow and gives the same IR every time: reuse it.
            if not (ov_dir / model_id.replace(".pt", ".xml")).exists():
                self.model.export(format="openvino")
            self.ov_model = FastSAM(str(ov_dir))

    def inference(
        self,
        image_path: str,
        device: str = "intel:gpu",
        imgsz: int = 1024,
        conf: float = 0.4,
        iou: float = 0.9,
    ):
        results = self.ov_model(
            image_path,
            device=device,
            retina_masks=True,
            imgsz=imgsz,
            conf=conf,
            iou=iou,
        )
        return results

    def get_mask_results(
        self,
        ori_image: Image.Image,
        results: list,
        min_area: int = 1000,
        max_area: int = 10000,
        save_results: bool = True,
    ):
        masked_image_list = []
        for result in results:
            masks = result.masks.data  # mask in matrix format (num_objects x H x W)
            # Component-sized masks first, then the typical size among them; the reverse order would
            # drop every candidate when the commonest object is bigger than `max_area`.
            candidates = [
                mask for mask in masks if min_area <= mask.sum().item() <= max_area
            ]
            areas = [mask.sum().item() for mask in candidates]
            if len(areas) > 0:
                median_area = sorted(areas)[len(areas) // 2]
                lower_bound = median_area * 0.5
                upper_bound = median_area * 1.5
                filtered_masks = [
                    mask
                    for mask in candidates
                    if lower_bound <= mask.sum().item() <= upper_bound
                ]
            else:
                filtered_masks = []
            logger.info(
                f"Masks detected: {len(masks)}, {len(candidates)} component-sized, "
                f"{len(filtered_masks)} of typical size."
            )

            for i, mask in enumerate(filtered_masks):
                # Filled red overlay (for inference)
                masked_image = ori_image.copy()
                red_mask = Image.new("RGB", masked_image.size, (255, 0, 0))
                mask_image = Image.fromarray(
                    (mask.numpy() * 255).astype("uint8")
                ).resize(masked_image.size)
                masked_image = Image.composite(red_mask, masked_image, mask_image)

                # Bounding box outline (for display and saving)
                mask_h, mask_w = mask.shape
                img_w, img_h = ori_image.size
                coords = mask.nonzero()
                x_min = int(coords[:, 1].min().item() * img_w / mask_w)
                x_max = int(coords[:, 1].max().item() * img_w / mask_w)
                y_min = int(coords[:, 0].min().item() * img_h / mask_h)
                y_max = int(coords[:, 0].max().item() * img_h / mask_h)
                bbox_image = ori_image.copy()
                draw = ImageDraw.Draw(bbox_image)
                draw.rectangle(
                    [x_min, y_min, x_max, y_max], outline=(255, 0, 0), width=3
                )

                masked_image_list.append((masked_image, bbox_image))

                if save_results:
                    seg_dir = instance_data_dir(".") / "segmentation_outputs"
                    os.makedirs(seg_dir, exist_ok=True)
                    bbox_image.save(
                        os.path.join(seg_dir, f"segmented_image_with_masks_{i+1}.png")
                    )

        return masked_image_list
