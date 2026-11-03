# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import os
import enum
import secrets
import shutil
import tempfile
import multiprocessing
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from PIL import Image
from datetime import datetime

from typing import Annotated, Any, Callable, Optional
from fastapi import FastAPI, File, Form
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from starlette.background import BackgroundTask
import worker_common

from utils.model import ImageGen, ImageGenPrompt, ImageSegmentation

logger = worker_common.get_logger(__name__)

# Generated projects live in this instance's own data directory.
OUTPUTS_DIR = worker_common.instance_data_dir(".") / "outputs"

DEFAULT_PORT = 8021
APP_WORKFLOW = None

# In-memory jobs: queued -> running -> completed | error, or cancelled. Finished jobs stay readable for
# JOB_TTL_SECONDS (a lost poll must not lose the image), at most MAX_FINISHED_JOBS of them.
_jobs: dict[str, dict] = {}
_jobs_lock = threading.Lock()
JOB_TTL_SECONDS = 60 * 60
MAX_FINISHED_JOBS = 500
FINAL_STATUSES = ("completed", "error", worker_common.CANCELLED)
# One job at a time, in order: the pipeline isn't thread-safe.
_generation_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="image-gen")

# Overall progress (0-1) at the start of each stage; `generating` fills the
# span up to `saving` step by step.
STAGE_PROGRESS = {
    "queued": 0.0,
    "preparing": 0.02,
    "segmenting": 0.05,
    "generating": 0.1,
    "saving": 0.95,
    "done": 1.0,
}

# FastSAM, loaded (and exported to OpenVINO) by the first missing-component
# job; only the generation thread touches it.
_segmentation_model: Optional[ImageSegmentation] = None


def _segmentation() -> ImageSegmentation:
    global _segmentation_model
    if _segmentation_model is None:
        _segmentation_model = ImageSegmentation()
    return _segmentation_model


def _new_job() -> str:
    job_id = str(uuid.uuid4())
    now = time.time()
    with _jobs_lock:
        finished = sorted(
            (item for item in _jobs.items() if item[1]["status"] in FINAL_STATUSES),
            key=lambda item: item[1]["finished"],
        )
        expired = [key for key, job in finished if job["finished"] < now - JOB_TTL_SECONDS]
        excess = [key for key, _ in finished[: max(0, len(finished) - MAX_FINISHED_JOBS)]]
        for key in {*expired, *excess}:
            del _jobs[key]
        _jobs[job_id] = {
            "status": "queued",
            "stage": "queued",
            "step": 0,
            "steps": ImageGen.NUM_INFERENCE_STEPS,
            "progress": 0.0,
            "created": now,
            "started": None,
            "finished": None,
            "result": None,
            "error": None,
            "cancel": worker_common.CancelToken(),
            "future": None,
        }
    return job_id


def _update_job(job_id: str, **changes: Any):
    with _jobs_lock:
        job = _jobs.get(job_id)
        if job is None:
            return
        job.update(changes)
        if "stage" in changes and "progress" not in changes:
            job["progress"] = STAGE_PROGRESS.get(changes["stage"], job["progress"])
        if changes.get("status") in FINAL_STATUSES:
            job["finished"] = time.time()


def _job_body(job_id: str) -> Optional[dict]:
    """What GET /image-gen/job/{job_id} answers with; None for an unknown job."""
    with _jobs_lock:
        job = _jobs.get(job_id)
        if job is None:
            return None
        body: dict[str, Any] = {
            "status": job["status"],
            "stage": job["stage"],
            "step": job["step"],
            "steps": job["steps"],
            "progress": round(job["progress"], 3),
        }
        if job["cancel"].cancelled:
            body["cancel_requested"] = True
        if job["status"] == "queued":
            body["jobs_ahead"] = sum(
                1
                for other in _jobs.values()
                if other["status"] in ("queued", "running")
                and other["created"] < job["created"]
            )
        elif job["status"] == "completed":
            body["message"] = "Image generated successfully."
            body.update(job["result"])
            # Read by the app's Live metrics.
            body["perf"] = {
                "seconds": job["finished"] - (job["started"] or job["created"]),
                "items": 1,
                "steps": job["steps"],
                "started": job["started"] or job["created"],
            }
        elif job["status"] == "error":
            body["error"] = job["error"] or "Unknown error"
        return body


def _start_job(job_id: str) -> Optional[worker_common.CancelToken]:
    """Moves a queued job to running; None if it was cancelled or dropped
    while it waited."""
    with _jobs_lock:
        job = _jobs.get(job_id)
        if job is None or job["status"] != "queued":
            return None
        job.update(
            status="running",
            stage="preparing",
            progress=STAGE_PROGRESS["preparing"],
            started=time.time(),
        )
        return job["cancel"]


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
        on_step: Optional[Callable[[int, int], None]] = None,
        on_saving: Optional[Callable[[], None]] = None,
        cancel: Optional[worker_common.CancelToken] = None,
    ):
        """Raises ``JobCancelled`` (nothing written) between denoising steps once ``cancel`` is set."""
        if self.image_gen_model is None:
            raise RuntimeError("Image generation model is not initialized.")

        seed = secrets.randbelow(1000001)
        generated_image = self.image_gen_model.inference(
            image=image,
            prompt=prompt,
            height=self.image_size,
            width=self.image_size,
            seed=seed,
            on_step=on_step,
            cancel=cancel,
        )
        if cancel is not None:
            cancel.check()
        if on_saving is not None:
            on_saving()
        # <save_dir>/<project>/<generation type>/<datetime>-<seed>.png
        target_dir = os.path.join(save_dir, project_name, generation_type)
        os.makedirs(target_dir, exist_ok=True)
        filename = f"{datetime.now().strftime('%Y%m%d%H%M%S')}-{seed}.png"
        generated_image.save(os.path.join(target_dir, filename))

        # Return relative path for frontend usage
        return f"{project_name}/{generation_type}/{filename}"


def create_app() -> FastAPI:
    app = worker_common.create_app(
        "Synthetic Image Generation Service",
        description="API service for synthetic image generation tasks.",
        version="1.0.0",
        healthcheck=False,
        # Called straight from the demo page on the app's port.
        allow_origins=["http://localhost:8080", "http://127.0.0.1:8080"],
    )
    app.mount("/outputs", StaticFiles(directory=OUTPUTS_DIR), name="outputs")

    @app.get("/healthcheck")
    async def healthcheck():
        """Health check endpoint."""
        return JSONResponse({"status": "ok"})

    @app.get("/image-gen/history")
    def get_generation_history():
        output_dir = OUTPUTS_DIR
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
        safe_path = os.path.abspath(os.path.join(OUTPUTS_DIR, file_path))
        outputs_abs = os.path.abspath(OUTPUTS_DIR)

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
        """Background worker for image generation, run on the generation thread."""

        def fail(message: str):
            logger.error(f"Job {job_id} failed: {message}")
            _update_job(job_id, status="error", error=message)

        cancel = _start_job(job_id)
        if cancel is None:
            return
        try:
            if generation_type == GenerationType.SYNTHETIC:
                prompt = ImageGenPrompt.SYNTHETIC_PROMPT
            elif generation_type == GenerationType.MISSING_COMPONENT:
                prompt = ImageGenPrompt.MISSING_COMPONENT_PROMPT
            elif generation_type == GenerationType.CUSTOM:
                prompt = custom_prompt
            else:
                fail("Invalid generation type.")
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
                cancel.check()
                _update_job(job_id, stage="segmenting")
                base_image_for_seg = (
                    preprocessed_image[0]
                    if isinstance(preprocessed_image, list)
                    else preprocessed_image
                )
                image_seg = _segmentation()
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
                    fail("No valid segmentation masks found for missing component generation.")
                    return

            gen_type_str = generation_type.value
            if generation_type == GenerationType.CUSTOM and custom_type:
                gen_type_str = f"{generation_type.value}_{custom_type}"

            generating = STAGE_PROGRESS["generating"]
            span = STAGE_PROGRESS["saving"] - generating

            def on_step(done: int, steps: int):
                _update_job(
                    job_id,
                    step=done,
                    steps=steps,
                    progress=generating + span * done / max(steps, 1),
                )

            cancel.check()
            _update_job(job_id, stage="generating")
            image_path = APP_WORKFLOW.generate_image(
                image=preprocessed_image,
                prompt=prompt,
                generation_type=gen_type_str,
                project_name=project_name,
                save_dir=str(OUTPUTS_DIR),
                on_step=on_step,
                on_saving=lambda: _update_job(job_id, stage="saving"),
                cancel=cancel,
            )

            mask_path = None
            if selected_mask_image is not None:
                base, ext = os.path.splitext(image_path)
                mask_relative_path = f"{base}-mask{ext}"
                mask_save_path = os.path.join(OUTPUTS_DIR, mask_relative_path)
                selected_bbox_image.save(mask_save_path)
                mask_path = mask_relative_path

            result = {"image": image_path}
            if mask_path:
                result["mask_image"] = mask_path

            _update_job(job_id, status="completed", stage="done", result=result)
            logger.info(f"Job {job_id} completed successfully.")

        except worker_common.JobCancelled:
            logger.info(f"Job {job_id} cancelled.")
            _update_job(job_id, status=worker_common.CANCELLED)

        except Exception as e:
            fail(str(e) or e.__class__.__name__)

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
        """Queues a generation; follow it with GET /image-gen/job/{job_id}/events."""
        job_id = _new_job()
        future = _generation_executor.submit(
            _run_generation_job,
            job_id,
            file,
            reference_file,
            generation_type,
            objective,
            custom_prompt,
            custom_type,
            project_name,
        )
        # Kept so cancelling a queued job also takes it off the thread's
        # queue, with the images it holds.
        _update_job(job_id, future=future)
        return {"job_id": job_id}

    @app.get("/image-gen/job/{job_id}")
    def get_job_status(job_id: str):
        body = _job_body(job_id)
        if body is None:
            return JSONResponse({"error": "Job not found"}, status_code=404)
        return body

    @app.delete("/image-gen/job/{job_id}")
    def cancel_job(job_id: str):
        """Cancel a job: a queued one at once, a running one at its next safe point (nothing saved)."""
        with _jobs_lock:
            job = _jobs.get(job_id)
            if job is None:
                return JSONResponse({"error": "Job not found"}, status_code=404)
            if job["status"] not in FINAL_STATUSES:
                job["cancel"].cancel()
                if job["status"] == "queued":
                    job.update(status=worker_common.CANCELLED, finished=time.time())
                    if job["future"] is not None:
                        job["future"].cancel()
        return _job_body(job_id)

    @app.get("/image-gen/job/{job_id}/events")
    async def get_job_events(job_id: str):
        """The job's status as Server-Sent Events on each change, ending with the final one."""
        if _job_body(job_id) is None:
            return JSONResponse({"error": "Job not found"}, status_code=404)
        return worker_common.sse_response(
            worker_common.watch_status(
                lambda: _job_body(job_id),
                lambda status: status["status"] in FINAL_STATUSES,
            )
        )

    @app.get("/projects")
    def list_projects():
        output_dir = OUTPUTS_DIR
        if not os.path.exists(output_dir):
            return {"projects": []}

        projects = []
        for item in os.listdir(output_dir):
            if os.path.isdir(os.path.join(output_dir, item)):
                projects.append(item)
        return {"projects": sorted(projects)}

    @app.post("/projects/create")
    def create_project(project_name: Annotated[str, Form()]):
        safe_name = "".join(
            [c for c in project_name if c.isalnum() or c in (" ", "-", "_")]
        ).strip()
        if not safe_name:
            return {"error": "Invalid project name"}

        project_path = os.path.join(OUTPUTS_DIR, safe_name)
        if os.path.exists(project_path):
            return {"message": "Project already exists", "project_name": safe_name}

        os.makedirs(project_path, exist_ok=True)
        return {"message": "Project created successfully", "project_name": safe_name}

    @app.delete("/projects/delete/{project_name}")
    def delete_project(project_name: str):
        safe_name = os.path.basename(project_name)
        project_path = os.path.abspath(os.path.join(OUTPUTS_DIR, safe_name))
        outputs_abs = os.path.abspath(OUTPUTS_DIR)

        if not project_path.startswith(outputs_abs):
            return {"error": "Invalid project path"}

        if os.path.exists(project_path) and os.path.isdir(project_path):
            shutil.rmtree(project_path)
            return {"message": "Project deleted successfully"}
        else:
            return {"error": "Project not found"}

    @app.get("/projects/export/{project_name}")
    def export_project(project_name: str):
        safe_name = os.path.basename(project_name)
        project_path = os.path.abspath(os.path.join(OUTPUTS_DIR, safe_name))
        outputs_abs = os.path.abspath(OUTPUTS_DIR)

        if not project_path.startswith(outputs_abs):
            return {"error": "Invalid project path"}

        if not os.path.exists(project_path) or not os.path.isdir(project_path):
            return {"error": "Project not found"}

        temp_dir = tempfile.mkdtemp()
        archive_base = os.path.join(temp_dir, safe_name)

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
    return worker_common.base_parser(
        "Synthetic Image Generation FastAPI Server", default_port=DEFAULT_PORT, device=False
    ).parse_args()


def main():
    global APP_WORKFLOW
    args = parse_args()
    logger.info("Starting up synthetic image generation service ...")
    os.makedirs(OUTPUTS_DIR, exist_ok=True)
    APP_WORKFLOW = Workflow()
    APP_WORKFLOW.init_image_generation_workflow()

    app = create_app()

    multiprocessing.freeze_support()
    # Legacy per-worker port variable, still honoured.
    args.port = int(os.environ.get("SYNTHETIC_IMAGE_GENERATION_PORT", args.port))
    worker_common.serve(app, args, log_level="info")
    return 0


if __name__ == "__main__":
    exit(main())
