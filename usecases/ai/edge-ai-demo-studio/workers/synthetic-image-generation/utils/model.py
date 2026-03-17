import os
import time
import logging
import torch
from PIL import Image
from ultralytics import FastSAM
from transformers import Qwen3ForCausalLM
from diffusers import AutoModel, Flux2KleinPipeline
from diffusers import BitsAndBytesConfig as DiffusersBitsAndBytesConfig
from transformers import BitsAndBytesConfig as TransformersBitsAndBytesConfig

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class ImageGenPrompt:
    SYNTHETIC_PROMPT = """Create an enhanced version of the input image.
All objects, positions, shapes, edges, dimensions, and orientations must remain identical to the original.
No new elements, no missing elements, no deformation, no perspective change.
Only apply image-level improvements such as noise reduction, contrast normalization, color correction, and slight lighting variation.
The output images must be pixel-structure consistent with the original."""
    MISSING_COMPONENT_PROMPT = """Remove the items in the red bounding box."""

class ImageGen:
    def __init__(self, mode: str = "local", model_id: str = "black-forest-labs/FLUX.2-klein-4B", device="xpu", dtype=torch.bfloat16, enable_cpu_offload: bool = False):
        self.mode = mode
        self.model_id = model_id
        self.device = device
        self.dtype = dtype
        self.enable_cpu_offload = enable_cpu_offload
        self.pipeline = None

        if self.mode == "local":
            self._load_model_pipeline()
        else:
            raise NotImplementedError(
                "Only local mode is supported currently.")

    def _load_model_pipeline(self, use_quantized: bool = True):
        logger.info(
            f"Loading model pipeline from {self.model_id} on device {self.device} with dtype {self.dtype}")

        if use_quantized:
            text_encoder_quant_config = TransformersBitsAndBytesConfig(
                load_int_4bit=True,
                bnb_4bit_quant_type="nf4",
                bnb_4bit_compute_dtype=self.dtype
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
                bnb_4bit_compute_dtype=self.dtype
            )
            quant_transformer = AutoModel.from_pretrained(
                self.model_id,
                subfolder="transformer",
                torch_dtype=self.dtype,
                quantization_config=transformer_quant_config,
            ).to(self.device)

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
                self.model_id,
                torch_dtype=self.dtype
            )

        # self.pipeline.set_progress_bar_config(disable=True)
        logger.info("Converting model pipeline to channels_last memory format.")
        self.pipeline.transformer.to(memory_format=torch.channels_last)
        self.pipeline.vae.to(memory_format=torch.channels_last)

        if self.enable_cpu_offload:
            # save some VRAM by offloading the model to CPU
            logger.info("Enabling model CPU offload to save VRAM.")
            self.pipeline.enable_model_cpu_offload()
        logger.info("Model pipeline loaded successfully.")

    def pad_image_to_square(self, image):
        width, height = image.size
        if width == height:
            return image
        max_side = max(width, height)
        new_image = Image.new("RGB", (max_side, max_side))
        new_image.paste(image, ((max_side - width) // 2,
                                (max_side - height) // 2))
        new_width, new_height = new_image.size
        return new_image

    def unpad_image(self, image, original_width, original_height):
        return image.crop((
            (image.width - original_width) // 2,
            (image.height - original_height) // 2,
            (image.width + original_width) // 2,
            (image.height + original_height) // 2
        ))

    def resize_image(self, image, target_size=1024):
        return image.resize((target_size, target_size))

    def inference(self, image: Image.Image, prompt: str, height: int, width: int, seed: int = 42):
        if self.mode == "local":
            st = time.time()
            result_image = self.pipeline(
                prompt=prompt,
                image=image,
                height=height,
                width=width,
                guidance_scale=1.0,
                num_inference_steps=4,
                generator=torch.Generator(device=self.device).manual_seed(seed)
            ).images[0]
            logger.info(f"Image generation completed in {time.time() - st:.2f} seconds.")
            return result_image
        else:
            raise NotImplementedError(
                "Only local mode is supported currently."
            )


class ImageSegmentation:
    def __init__(self, model_id: str = "FastSAM-s.pt", use_openvino: bool = True):
        self.model = FastSAM(f"models/{model_id}")
        self.ov_model = None
        if use_openvino:
            self.model.export(format="openvino")
            self.ov_model = FastSAM(f"models/{model_id.replace('.pt', '_openvino_model/')}")
        
    def inference(self, image_path: str, device: str = "intel:gpu", imgsz: int = 1024, conf: float = 0.4, iou: float = 0.9):
        results = self.ov_model(
            image_path, 
            device=device, 
            retina_masks=True, 
            imgsz=imgsz, 
            conf=conf, 
            iou=iou, 
        )
        return results
    
    def get_mask_results(self, ori_image: Image.Image, results: list, min_area: int = 1000, max_area: int = 10000, save_results: bool = False):
        masked_image_list = []
        for result in results:
            masks = result.masks.data  # mask in matrix format (num_objects x H x W)
            # get the median area of the masks
            areas = [mask.sum().item() for mask in masks]
            if len(areas) > 0:
                median_area = sorted(areas)[len(areas) // 2]
                lower_bound = median_area * 0.5
                upper_bound = median_area * 1.5
                filtered_masks = [mask for mask in masks if lower_bound <= mask.sum().item() <= upper_bound]
                logger.info(f"Total masks detected: {len(filtered_masks)} after filtering by area.")
            else:
                filtered_masks = []

            for i, mask in enumerate(filtered_masks):
                # remove the big mask
                if mask.sum() < min_area or mask.sum() > max_area:
                    continue

                masked_image = ori_image.copy()
                red_mask = Image.new("RGB", masked_image.size, (255, 0, 0))
                mask_image = Image.fromarray((mask.numpy() * 255).astype('uint8')).resize(masked_image.size)
                masked_image = Image.composite(red_mask, masked_image, mask_image)
                masked_image_list.append(masked_image)

                if save_results:
                    os.makedirs("segmentation_outputs", exist_ok=True)
                    masked_image.save(f"segmentation_outputs/segmented_image_with_masks_{i+1}.png")

        return masked_image_list

        
