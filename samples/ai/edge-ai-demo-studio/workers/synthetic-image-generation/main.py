import os
import enum
import secrets
import logging
import uvicorn
import shutil
import tempfile
import argparse
import multiprocessing
import threading
import uuid
from io import BytesIO
from PIL import Image
from datetime import datetime

from typing import Annotated, Optional
from fastapi import FastAPI, File, Form
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from starlette.background import BackgroundTask

from utils.model import ImageGen, ImageGenPrompt, ImageSegmentation

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DEFAULT_PORT = 8021
APP_WORKFLOW = None

# In-memory job store for async generation
_jobs: dict[str, dict] = {}
# Serialize inference — the pipeline is not thread-safe
_generation_lock = threading.Lock()


def remove_temp_dir(path: str):
    if os.path.exists(path):
        shutil.rmtree(os.path.dirname(path))


class GenerationType(enum.Enum):
    SYNTHETIC = "SYNTHETIC"
    MISSING_COMPONENT = "MISSING_COMPONENT"
    CUSTOM = "CUSTOM"


class Workflow:
    def __init__(self, image_size=1024):
        self.image_size = image_size
        self.image_gen_model = None

    def init_image_generation_workflow(self):
        try:
            self.image_gen_model = ImageGen(mode="local", enable_cpu_offload=False)
        except Exception as e:
            raise RuntimeError("Image generation workflow initialization failed.")

    def preprocess_image(self, image: Image.Image):
        preprocessed_image = self.image_gen_model.pad_image_to_square(image)
        preprocessed_image = self.image_gen_model.resize_image(
            preprocessed_image, target_size=self.image_size
        )
        return preprocessed_image

    def generate_image(
        self,
        image: Image.Image,
        prompt: str,
        generation_type: str = "SYNTHETIC",
        num_generations: int = 1,
        project_name: str = "default",
        save_dir: str = "./outputs",
    ):
        if self.image_gen_model is None:
            raise RuntimeError("Image generation model is not initialized.")

        # New structure: outputs/project_name/generation_type/
        target_dir = os.path.join(save_dir, project_name, generation_type)
        os.makedirs(target_dir, exist_ok=True)

        seed = secrets.randbelow(1000001)
        generated_image = self.image_gen_model.inference(
            image=image,
            prompt=prompt,
            height=self.image_size,
            width=self.image_size,
            seed=seed,
        )
        # New filename: datetime-seed.png
        filename = f"{datetime.now().strftime('%Y%m%d%H%M%S')}-{seed}.png"
        generated_image.save(os.path.join(target_dir, filename))

        # Return relative path for frontend usage
        return f"{project_name}/{generation_type}/{filename}"


def create_app() -> FastAPI:
    app = FastAPI(
        title="Synthetic Image Generation Service",
        description="API service for synthetic image generation tasks.",
        version="1.0.0",
    )

    allowed_origins = [
        "http://localhost:8080",
        "http://127.0.0.1:8080",
    ]

    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.mount("/outputs", StaticFiles(directory="outputs"), name="outputs")

    @app.get("/healthcheck")
    async def healthcheck():
        """Health check endpoint."""
        return JSONResponse({"status": "ok"})

    @app.get("/image-gen/history")
    def get_generation_history():
        output_dir = "outputs"
        if not os.path.exists(output_dir):
            return {"images": []}

        images = []
        for root, dirs, files in os.walk(output_dir):
            for filename in files:
                if filename.lower().endswith((".png", ".jpg", ".jpeg")):
                    # Exclude mask images (used internally for side-by-side preview)
                    stem = os.path.splitext(filename)[0]
                    if stem.endswith("-mask"):
                        continue
                    rel_dir = os.path.relpath(root, output_dir)
                    if rel_dir == ".":
                        images.append(filename)
                    else:
                        images.append(os.path.join(rel_dir, filename))

        return {"images": sorted(images, reverse=True)}

    @app.delete("/image-gen/delete/{file_path:path}")
    def delete_generated_image(file_path: str):
        # Verify path is within outputs directory to prevent traversal
        safe_path = os.path.abspath(os.path.join("outputs", file_path))
        outputs_abs = os.path.abspath("outputs")

        if not safe_path.startswith(outputs_abs):
            return {"error": "Invalid file path."}

        if os.path.exists(safe_path):
            os.remove(safe_path)
            return {"message": "Image deleted successfully."}
        else:
            logger.error(f"File not found for deletion: {safe_path}")
            return {"error": "File not found."}

    def _run_generation_job(
        job_id: str,
        image_bytes: bytes,
        reference_bytes: Optional[bytes],
        generation_type: GenerationType,
        objective: str,
        custom_prompt: str,
        custom_type: str,
        project_name: str,
    ):
        """Background worker for image generation."""
        with _generation_lock:
            try:
                if generation_type == GenerationType.SYNTHETIC:
                    prompt = ImageGenPrompt.SYNTHETIC_PROMPT
                elif generation_type == GenerationType.MISSING_COMPONENT:
                    prompt = ImageGenPrompt.MISSING_COMPONENT_PROMPT
                elif generation_type == GenerationType.CUSTOM:
                    prompt = custom_prompt
                else:
                    _jobs[job_id] = {**_jobs[job_id], "status": "error", "error": "Invalid generation type."}
                    return

                image = Image.open(BytesIO(image_bytes)).convert("RGB")
                preprocessed_image = APP_WORKFLOW.preprocess_image(image)

                if generation_type == GenerationType.CUSTOM and reference_bytes is not None:
                    reference_image = Image.open(BytesIO(reference_bytes)).convert("RGB")
                    preprocessed_reference = APP_WORKFLOW.preprocess_image(reference_image)
                    preprocessed_image = [preprocessed_image, preprocessed_reference]
                    prompt = (
                        prompt
                        + " Incorporate the visual style, color palette, texture, and lighting characteristics of the provided reference image."
                    )

                selected_mask_image = None
                selected_bbox_image = None
                if generation_type == GenerationType.MISSING_COMPONENT:
                    base_image_for_seg = (
                        preprocessed_image[0]
                        if isinstance(preprocessed_image, list)
                        else preprocessed_image
                    )
                    image_seg = ImageSegmentation()
                    results = image_seg.inference(image_path=base_image_for_seg)
                    masked_image_list = image_seg.get_mask_results(
                        ori_image=base_image_for_seg,
                        results=results,
                        min_area=1000,
                        max_area=10000,
                        save_results=False,
                    )
                    if len(masked_image_list) > 0:
                        selected = secrets.choice(masked_image_list)
                        selected_mask_image, selected_bbox_image = selected
                        if isinstance(preprocessed_image, list):
                            preprocessed_image = [selected_mask_image] + preprocessed_image[1:]
                        else:
                            preprocessed_image = selected_mask_image
                    else:
                        _jobs[job_id] = {
                            **_jobs[job_id],
                            "status": "error",
                            "error": "No valid segmentation masks found for missing component generation.",
                        }
                        return

                gen_type_str = generation_type.value
                if generation_type == GenerationType.CUSTOM and custom_type:
                    gen_type_str = f"{generation_type.value}_{custom_type}"

                image_path = APP_WORKFLOW.generate_image(
                    image=preprocessed_image,
                    prompt=prompt,
                    generation_type=gen_type_str,
                    project_name=project_name,
                )

                mask_path = None
                if selected_mask_image is not None:
                    base, ext = os.path.splitext(image_path)
                    mask_relative_path = f"{base}-mask{ext}"
                    mask_save_path = os.path.join("outputs", mask_relative_path)
                    selected_bbox_image.save(mask_save_path)
                    mask_path = mask_relative_path

                result = {"image": image_path}
                if mask_path:
                    result["mask_image"] = mask_path

                _jobs[job_id] = {**_jobs[job_id], "status": "completed", "result": result}
                logger.info(f"Job {job_id} completed successfully.")

            except Exception as e:
                logger.error(f"Job {job_id} failed: {e}")
                _jobs[job_id] = {**_jobs[job_id], "status": "error", "error": str(e)}

    @app.post("/image-gen/generate")
    def upload_image_and_generate(
        file: Annotated[bytes, File()],
        generation_type: Annotated[GenerationType, Form()],
        objective: Annotated[str, Form()] = "",
        custom_prompt: Annotated[str, Form()] = "",
        custom_type: Annotated[str, Form()] = "",
        project_name: Annotated[str, Form()] = "default",
        reference_file: Annotated[Optional[bytes], File()] = None,
    ):
        job_id = str(uuid.uuid4())
        _jobs[job_id] = {"status": "pending"}

        thread = threading.Thread(
            target=_run_generation_job,
            args=(
                job_id,
                file,
                reference_file,
                generation_type,
                objective,
                custom_prompt,
                custom_type,
                project_name,
            ),
            daemon=True,
        )
        thread.start()

        return {"job_id": job_id}

    @app.get("/image-gen/job/{job_id}")
    def get_job_status(job_id: str):
        job = _jobs.get(job_id)
        if job is None:
            return JSONResponse({"error": "Job not found"}, status_code=404)

        if job["status"] == "pending":
            return {"status": "pending"}
        elif job["status"] == "completed":
            result = job["result"]
            # Clean up completed job from memory
            del _jobs[job_id]
            return {
                "status": "completed",
                "message": "Image generated successfully.",
                **result,
            }
        elif job["status"] == "error":
            error = job.get("error", "Unknown error")
            del _jobs[job_id]
            return {"status": "error", "error": error}

    @app.get("/projects")
    def list_projects():
        output_dir = "outputs"
        if not os.path.exists(output_dir):
            return {"projects": []}

        projects = []
        for item in os.listdir(output_dir):
            if os.path.isdir(os.path.join(output_dir, item)):
                projects.append(item)
        return {"projects": sorted(projects)}

    @app.post("/projects/create")
    def create_project(project_name: Annotated[str, Form()]):
        # Basic validation
        safe_name = "".join(
            [c for c in project_name if c.isalnum() or c in (" ", "-", "_")]
        ).strip()
        if not safe_name:
            return {"error": "Invalid project name"}

        project_path = os.path.join("outputs", safe_name)
        if os.path.exists(project_path):
            return {"message": "Project already exists", "project_name": safe_name}

        os.makedirs(project_path, exist_ok=True)
        return {"message": "Project created successfully", "project_name": safe_name}

    @app.delete("/projects/delete/{project_name}")
    def delete_project(project_name: str):
        # Safety check
        safe_name = os.path.basename(project_name)
        project_path = os.path.abspath(os.path.join("outputs", safe_name))
        outputs_abs = os.path.abspath("outputs")

        if not project_path.startswith(outputs_abs):
            return {"error": "Invalid project path"}

        if os.path.exists(project_path) and os.path.isdir(project_path):
            shutil.rmtree(project_path)
            return {"message": "Project deleted successfully"}
        else:
            return {"error": "Project not found"}

    @app.get("/projects/export/{project_name}")
    def export_project(project_name: str):
        # Safety check
        safe_name = os.path.basename(project_name)
        project_path = os.path.abspath(os.path.join("outputs", safe_name))
        outputs_abs = os.path.abspath("outputs")

        if not project_path.startswith(outputs_abs):
            return {"error": "Invalid project path"}

        if not os.path.exists(project_path) or not os.path.isdir(project_path):
            return {"error": "Project not found"}

        # Create a temporary directory
        temp_dir = tempfile.mkdtemp()
        archive_base = os.path.join(temp_dir, safe_name)

        # Create zip file
        shutil.make_archive(archive_base, "zip", root_dir=project_path)
        zip_path = archive_base + ".zip"
        return FileResponse(
            path=zip_path,
            filename=f"{safe_name}.zip",
            media_type="application/zip",
            background=BackgroundTask(remove_temp_dir, path=zip_path),
        )

    return app


def parse_args():
    parser = argparse.ArgumentParser(
        description="Synthetic Image Generation FastAPI Server"
    )
    parser.add_argument(
        "--port",
        type=int,
        default=DEFAULT_PORT,
        help="Port for the FastAPI server to listen on",
    )
    return parser.parse_args()


def main():
    global APP_WORKFLOW
    args = parse_args()
    logger.info("Starting up synthetic image generation service ...")
    os.makedirs("outputs", exist_ok=True)
    APP_WORKFLOW = Workflow()
    APP_WORKFLOW.init_image_generation_workflow()

    app = create_app()

    multiprocessing.freeze_support()
    uvicorn.run(
        app,
        host=os.environ.get("SERVER_HOST", "127.0.0.1"),
        port=int(os.environ.get("SYNTHETIC_IMAGE_GENERATION_PORT", args.port)),
        log_level="info",
    )
    return 0


if __name__ == "__main__":
    exit(main())
