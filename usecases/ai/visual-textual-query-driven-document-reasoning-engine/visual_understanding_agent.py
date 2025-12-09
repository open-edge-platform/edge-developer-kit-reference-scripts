# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import gc
import logging
import os
import subprocess  # nosec B404
from io import BytesIO
from pathlib import Path
from threading import Thread
from typing import List, Optional, Tuple

import torch
from PIL import Image
from qwen_vl_utils import process_vision_info
from transformers import TextIteratorStreamer

import config
from model_registry import MODEL_REGISTRY as model_registry


def _pil_to_bytes(image: Image.Image) -> bytes:
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


class VisualUnderstandingAgent:
    def __init__(
        self,
        model_id: str,
        precision: Optional[
            str
        ] = "fp16",  # or "int8", "int4" for openvino quantized models
        device: str = torch.device("cpu"),  # or "GPU.1"  if using openvino
    ):
        self.model_id = model_id
        self.device = device
        self.model = None
        self.processor = None
        self.tokenizer = None
        self.precision = precision
        self.min_pixels = 256 * 28 * 28
        self.max_pixels = 1280 * 28 * 28
        self.models_parent_directory = Path("models")
        self.models_parent_directory.mkdir(parents=True, exist_ok=True)
        self._initialize_model_processor()

    def _initialize_model_processor(self):
        for entry in model_registry:
            if self.model_id in entry["model_ids"]:
                model_dir = Path("models") / Path(self.model_id.split("/")[-1])
                self._check_download_model(model_dir)
                
                # Add library_name for OpenVINO models to avoid inference errors
                model_kwargs = {"device": self.device}
                if entry["model_class"].__name__ == "OVModelForVisualCausalLM":
                    model_kwargs["library_name"] = "transformers"
                
                self.model = entry["model_class"].from_pretrained(
                    model_dir / self.precision.upper(), **model_kwargs
                )
                self.processor = entry["processor_class"].from_pretrained(
                    model_dir / self.precision.upper(),
                    min_pixels=self.min_pixels,
                    max_pixels=self.max_pixels,
                )
                self.tokenizer = entry["tokenizer_class"].from_pretrained(
                    model_dir / self.precision.upper()
                )
                self.processor.chat_template = self.tokenizer.chat_template

    def _optimum_cli(
        self,
        model_id: str,
        output_dir: Path,
        additional_args: dict[str, str] = None,
        debug_logs: bool = False,
    ):
        """
        Export model to OpenVINO format using optimum-cli.
        
        Security measures implemented:
        - Command built as a list (not string) to prevent injection attacks
        - No shell=True to avoid shell metacharacter exploits
        - All inputs are from trusted sources:
          * model_id: comes from MODEL_REGISTRY (hardcoded trusted list)
          * output_dir: internally constructed Path object
          * additional_args: controlled by internal code (weight-format parameter)
        
        Args:
            model_id: HuggingFace model identifier (from trusted MODEL_REGISTRY)
            output_dir: Directory to save the exported model (internally constructed)
            additional_args: Additional CLI arguments (e.g., {"weight-format": "int4"})
            debug_logs: Enable debug logging
            
        Raises:
            subprocess.CalledProcessError: If model export fails
        """
        transformers_loglevel = None
        if debug_logs:
            transformers_loglevel = os.environ.pop("TRANSFORMERS_VERBOSITY", None)
            os.environ["TRANSFORMERS_VERBOSITY"] = "debug"

        print("Downloading the VLM model... Please wait...")

        try:
            # Build command as a list (secure - prevents command injection)
            # All arguments are from trusted sources (see docstring)
            command = [
                "optimum-cli",
                "export",
                "openvino",
                "--model",
                str(model_id),
                str(output_dir),
            ]
            
            # Add optional arguments securely
            if additional_args is not None:
                for arg, value in additional_args.items():
                    command.append(f"--{arg}")
                    if value:
                        command.append(str(value))

            print("Exporting model, please wait...\n")
            
            # Execute with security measures:
            # - Command is a list (not string concatenation)
            # - shell=False (default) prevents shell injection
            # - All arguments from trusted sources
            # nosec B603: Subprocess call is secure (list args, no shell, trusted inputs)
            process = subprocess.Popen(  # nosec B603
                command,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                bufsize=1,
                universal_newlines=True,
            )

            # Stream output to console
            for line in process.stdout:
                line = line.strip()
                if line:
                    print(line)

            return_code = process.wait()
            if return_code != 0:
                raise subprocess.CalledProcessError(return_code, command)

        except subprocess.CalledProcessError as exc:
            logger = logging.getLogger()
            logger.exception("Export failed with error:")
            raise exc

        finally:
            if transformers_loglevel is not None:
                os.environ["TRANSFORMERS_VERBOSITY"] = transformers_loglevel

    def _check_download_model(self, model_dir: Path):
        if not (model_dir / self.precision.upper()).exists():
            self._optimum_cli(
                self.model_id,
                model_dir / self.precision.upper(),
                additional_args={"weight-format": self.precision.lower()},
            )

    def identify_component(
        self, component_image: Image.Image, description: Optional[str] = None
    ) -> str:
        messages = [
            {
                "role": "system",
                "content": config.component_identification_system_prompt_template.format(
                    component_list=str(config.component_list)
                ),
            },
            {
                "role": "user",
                "content": [
                    {"type": "image", "image": component_image},
                    {
                        "type": "text",
                        "text": f"Description: {description or 'No description provided.'}",
                    },
                ],
            },
        ]

        text = self.processor.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True
        )
        image_inputs, video_inputs = process_vision_info(messages)
        inputs = self.processor(
            text=[text],
            images=image_inputs,
            videos=video_inputs,
            padding=True,
            return_tensors="pt",
        )

        generated_ids = self.model.generate(
            **inputs,
            max_new_tokens=20,
            do_sample=False,
            eos_token_id=self.processor.tokenizer.eos_token_id,
        )

        trimmed_ids = generated_ids[:, inputs["input_ids"].shape[1] :]
        response = self.processor.batch_decode(
            trimmed_ids,
            skip_special_tokens=True,
            clean_up_tokenization_spaces=False,
        )[0].strip()

        print(f"Response of component identification: {response}")

        for c in config.component_list:
            if c.lower() in response.lower():
                return c

        return "unknown"

    def generate_response(
        self,
        query: str,
        gallery: List[Tuple[Image.Image, str]],
        is_iterate_images: bool = True,
    ):
        full_response = []

        for idx, (page, page_label) in enumerate(gallery):
            messages = [
                {
                    "role": "system",
                    "content": config.chatbot_system_prompt_template,
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "image": page,
                        },
                        {
                            "type": "text",
                            "text": config.chatbot_query_template.format(
                                query=query, page_label=page_label
                            ),
                        },
                    ],
                },
            ]

            text = self.processor.apply_chat_template(
                messages, tokenize=False, add_generation_prompt=True
            )
            image_inputs, video_inputs = process_vision_info(messages)
            inputs = self.processor(
                text=[text],
                images=image_inputs,
                videos=video_inputs,
                padding=True,
                return_tensors="pt",
            )

            full_response.append(f"Page {idx + 1}:\n\n")

            streamer = TextIteratorStreamer(
                self.processor.tokenizer,
                timeout=120.0,
                skip_prompt=True,
                skip_special_tokens=True,
            )

            generate_kwargs = dict(
                inputs,
                max_new_tokens=512,
                streamer=streamer,
            )

            generation_thread = Thread(
                target=self.model.generate, kwargs=generate_kwargs
            )
            generation_thread.start()

            try:
                for token in streamer:
                    full_response.append(token)
                    yield "".join(full_response)
            except Exception as e:
                print(f"[Generation error on page {idx + 1}]: {e}")
            finally:
                print(f"Thread for page {idx + 1} generation completed.")
                # Ensure thread cleanup
                generation_thread.join()

                # Force memory cleanup (no xpu cache method in OV, just force collection)
                del inputs, image_inputs, video_inputs, text, messages, streamer
                gc.collect()

            full_response.append("\n\n")
