# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import asyncio
import json
import mimetypes
import os
import shutil
import subprocess  # nosec B404
import zipfile
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, AsyncIterator, Callable, Literal
from uuid import uuid4

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, Response, StreamingResponse
from pydantic import BaseModel, Field

from .files import (
	add_directory_to_archive as _add_directory_to_archive,
	create_zip_response as _create_zip_response,
	managed_path as _managed_path,
)
from .jobs import Asset, Job, JobKind, JobStatus, JobStore
from .runner import JobRunner

PROJECT_ROOT = Path(os.getenv("HUMANOID_RL_HOME", Path(__file__).resolve().parents[4])).resolve()
DATA_ROOT = Path(os.getenv("HUMANOID_RL_DATA_DIR", PROJECT_ROOT / "application" / ".data")).resolve()
MAX_UPLOAD_BYTES = 1_000_000_000
PROCESSING_KINDS = {
	JobKind.PROCESS_GVHMR,
	JobKind.PROCESS_GMR,
	JobKind.PROCESS_CSV_TO_NPZ,
}
DEVICE_KINDS = {JobKind.TRAIN, JobKind.RESUME, JobKind.PLAY, JobKind.PLAY_CHAIN}
Device = Literal["cpu", "xpu"]
DEVICE_PREFERENCE: tuple[Device, ...] = ("xpu", "cpu")


class JobSubmission(BaseModel):
	kind: JobKind
	asset_id: str | None = None
	motion_path: str | None = None
	run_id: str | None = None
	checkpoint: str | None = None
	asset_ids: list[str] = Field(default_factory=list)
	run_ids: list[str] = Field(default_factory=list)
	checkpoints: list[str] = Field(default_factory=list)
	device: Device | None = None
	env_device: Device | None = None
	max_iterations: int | None = Field(default=10001, gt=0, le=100000)
	num_envs: int | None = Field(default=4096, gt=0, le=8192)


class AssetView(Asset):
	artifacts: list[str]


class AssetFileView(BaseModel):
	path: str
	is_video: bool


class RunFileView(BaseModel):
	path: str


class RunView(BaseModel):
	id: str
	name: str
	experiment: str
	checkpoints: list[str]
	modified_at: datetime


def _asset_file(asset: Asset) -> Path:
	return DATA_ROOT / "uploads" / f"{asset.id}{asset.extension}"


def _has_active_job_reference(store: JobStore, matches: Callable[[dict[str, Any]], bool]) -> bool:
	return any(
		job.status in {JobStatus.QUEUED, JobStatus.RUNNING} and matches(job.payload)
		for job in store.list()
	)


def _references_asset(payload: dict[str, Any], asset_id: str) -> bool:
	if payload.get("asset_id") == asset_id or asset_id in payload.get("asset_ids", []):
		return True

	artifact_root = (DATA_ROOT / "artifacts" / asset_id).resolve()
	paths = [payload.get("motion_path"), *payload.get("motion_paths", [])]
	for path in paths:
		if not isinstance(path, str):
			continue
		try:
			if Path(path).resolve().is_relative_to(artifact_root):
				return True
		except (OSError, RuntimeError):
			return True
	return False


def _references_run(payload: dict[str, Any], run_id: str, run_dir: Path) -> bool:
	if payload.get("run_id") == run_id or run_id in payload.get("run_ids", []):
		return True

	paths = [payload.get("checkpoint_path"), *payload.get("checkpoint_paths", [])]
	for path in paths:
		if not isinstance(path, str):
			continue
		try:
			if Path(path).resolve().is_relative_to(run_dir):
				return True
		except (OSError, RuntimeError):
			return True
	return False


def _artifact_paths(asset_id: str) -> dict[str, Path]:
	root = DATA_ROOT / "artifacts" / asset_id
	return {
		"gvhmr": root / "gvhmr" / asset_id / "hmr4d_results.pt",
		"gmr_pickle": root / "gmr" / f"{asset_id}_g1.pkl",
		"gmr_csv": root / "gmr" / "csv" / f"{asset_id}_g1.csv",
		"motion_npz": root / "motion.npz",
	}


def _preview_paths(asset_id: str) -> dict[str, Path]:
	return {
		"gvhmr_global": DATA_ROOT / "artifacts" / asset_id / "gvhmr" / asset_id / f"{asset_id}_3_incam_global_horiz.mp4",
		"gmr_video": DATA_ROOT / "artifacts" / asset_id / "gmr" / f"unitree_g1_{asset_id}.mp4",
	}


def _asset_view(asset: Asset) -> AssetView:
	artifacts = [name for name, path in _artifact_paths(asset.id).items() if path.is_file()]
	return AssetView(**asset.model_dump(), artifacts=artifacts)


def _asset_file_entries(asset: Asset) -> list[AssetFileView]:
	entries: list[AssetFileView] = []
	upload_root = DATA_ROOT / "uploads"
	upload = _managed_path(upload_root, _asset_file(asset))
	if upload.is_file():
		entries.append(AssetFileView(path=f"input/{Path(asset.filename).name}", is_video=True))

	artifact_parent = DATA_ROOT / "artifacts"
	artifact_root = _managed_path(artifact_parent, artifact_parent / asset.id)
	for path in sorted(artifact_root.rglob("*")):
		if path.is_symlink():
			raise HTTPException(status_code=409, detail="Asset files cannot include symbolic links.")
		if not path.is_file():
			continue
		_managed_path(artifact_parent, path)
		relative_path = path.relative_to(artifact_root).as_posix()
		media_type, _ = mimetypes.guess_type(path.name)
		entries.append(
			AssetFileView(
				path=f"artifacts/{relative_path}",
				is_video=bool(media_type and media_type.startswith("video/")),
			)
		)
	return entries


def _resolve_asset_file(asset: Asset, relative_path: str) -> Path:
	parts = relative_path.split("/")
	if len(parts) < 2 or any(part in {"", ".", ".."} for part in parts):
		raise HTTPException(status_code=404, detail="Asset file not found.")

	if parts[0] == "input" and len(parts) == 2 and parts[1] == Path(asset.filename).name:
		root = DATA_ROOT / "uploads"
		path = _asset_file(asset)
	elif parts[0] == "artifacts":
		root = DATA_ROOT / "artifacts"
		path = root / asset.id
		_managed_path(root, path)
		path = path.joinpath(*parts[1:])
	else:
		raise HTTPException(status_code=404, detail="Asset file not found.")

	return _managed_path(root, path)


def _resolve_motion_path(path: str) -> Path:
	resolved = Path(path).expanduser().resolve()
	allowed_roots = [
		(DATA_ROOT / "artifacts").resolve(),
		(DATA_ROOT / "motions").resolve(),
	]
	if not any(resolved.is_relative_to(root) for root in allowed_roots):
		raise HTTPException(status_code=422, detail="Motion path is outside supported data directories.")
	if not resolved.is_file() or resolved.suffix != ".npz":
		raise HTTPException(status_code=422, detail="Motion path must refer to an existing NPZ file.")
	return resolved


def _run_root() -> Path:
	return DATA_ROOT / "runs" / "rsl_rl"


def _detect_devices() -> list[Device]:
	devices: list[Device] = ["cpu"]
	python = PROJECT_ROOT / "third_party/unitree_rl_mjlab/.venv/bin/python"
	if not python.is_file():
		return devices
	probe = (
		"import json, torch; devices = []; "
		"devices += ['xpu'] if hasattr(torch, 'xpu') and torch.xpu.is_available() else []; "
		"print(json.dumps(devices))"
	)
	try:
		result = subprocess.run(
			[str(python), "-c", probe], capture_output=True, text=True, check=True, timeout=10
		)
		devices.extend(json.loads(result.stdout))
		return [device for device in DEVICE_PREFERENCE if device in devices]
	except (OSError, subprocess.SubprocessError, json.JSONDecodeError):
		return devices


def _preferred_device(available_devices: list[Device]) -> Device:
	return next((device for device in DEVICE_PREFERENCE if device in available_devices), "cpu")


def _resolve_checkpoint(run_id: str, checkpoint: str) -> Path:
	run_dir = _resolve_run_directory(run_id)
	if Path(checkpoint).name != checkpoint:
		raise HTTPException(status_code=422, detail="Checkpoint must be a filename in the selected run.")
	path = (run_dir / checkpoint).resolve()
	if not path.is_relative_to(run_dir) or not path.is_file() or path.suffix != ".pt":
		raise HTTPException(status_code=404, detail="Checkpoint not found in the selected run.")
	return path


def _resolve_run_directory(run_id: str) -> Path:
	root = _run_root().resolve()
	relative_path = Path(run_id)
	if relative_path.is_absolute() or len(relative_path.parts) != 2 or any(part in {".", ".."} for part in relative_path.parts):
		raise HTTPException(status_code=404, detail="Training run not found.")
	if (root / relative_path.parts[0]).is_symlink() or (root / relative_path).is_symlink():
		raise HTTPException(status_code=404, detail="Training run not found.")
	run_dir = (root / relative_path).resolve()
	if not run_dir.is_relative_to(root) or not run_dir.is_dir():
		raise HTTPException(status_code=404, detail="Training run not found.")
	return run_dir


def _load_run_job_config(run_id: str, run_dir: Path) -> dict[str, Any]:
	config_path = run_dir / "job_config.json"
	if config_path.is_symlink() or not config_path.is_file():
		raise HTTPException(status_code=409, detail="This run has no saved training configuration and cannot be resumed.")
	try:
		resolved_config_path = config_path.resolve(strict=True)
		if not resolved_config_path.is_relative_to(run_dir):
			raise ValueError("Configuration is outside the selected run.")
		config = json.loads(resolved_config_path.read_text(encoding="utf-8"))
	except (OSError, RuntimeError, ValueError, json.JSONDecodeError) as error:
		raise HTTPException(status_code=409, detail="The saved training configuration is invalid.") from error
	if not isinstance(config, dict) or config.get("schema_version") != 1:
		raise HTTPException(status_code=409, detail="The saved training configuration has an unsupported format.")
	if (
		config.get("run_id") != run_id
		or config.get("run_name") != run_dir.name
		or config.get("experiment") != run_dir.parent.name
	):
		raise HTTPException(status_code=409, detail="The saved training configuration does not match the selected run.")
	if not isinstance(config.get("motion_path"), str):
		raise HTTPException(status_code=409, detail="The saved training configuration has no motion path.")
	for key, maximum in (("max_iterations", 100_000), ("num_envs", 8192)):
		value = config.get(key)
		if isinstance(value, bool) or not isinstance(value, int) or not 0 < value <= maximum:
			raise HTTPException(status_code=409, detail=f"The saved training configuration has an invalid {key} value.")
	for key in ("device", "env_device"):
		value = config.get(key)
		if not isinstance(value, str) or value not in {"cpu", "xpu"}:
			raise HTTPException(status_code=409, detail=f"The saved training configuration has an invalid {key} value.")
	return config


def _run_file_entries(run_dir: Path) -> list[RunFileView]:
	entries: list[RunFileView] = []
	for path in sorted(run_dir.rglob("*")):
		if path.is_symlink():
			raise HTTPException(status_code=409, detail="Run files cannot include symbolic links.")
		if not path.is_file():
			continue
		try:
			if not path.resolve().is_relative_to(run_dir):
				raise HTTPException(status_code=409, detail="Run files must remain inside the selected run.")
		except (OSError, RuntimeError) as error:
			raise HTTPException(status_code=409, detail="Could not safely inspect run files.") from error
		entries.append(RunFileView(path=path.relative_to(run_dir).as_posix()))
	return entries


def _tensorboard_port() -> int:
	configured_port = os.getenv("NEXT_PUBLIC_HUMANOID_RL_TENSORBOARD_PORT")
	if configured_port is None:
		raise HTTPException(status_code=503, detail="TensorBoard port is not configured.")
	try:
		port = int(configured_port)
	except ValueError as error:
		raise HTTPException(status_code=503, detail="Invalid TensorBoard port configuration.") from error
	if not 1 <= port <= 65535:
		raise HTTPException(status_code=503, detail="TensorBoard must use a valid port.")
	return port


def _motion_for_asset(store: JobStore, asset_id: str) -> Path:
	asset = store.get_asset(asset_id)
	if not asset:
		raise HTTPException(status_code=404, detail="Motion asset not found.")
	return _resolve_motion_path(str(DATA_ROOT / "artifacts" / asset_id / "motion.npz"))


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
	DATA_ROOT.mkdir(parents=True, exist_ok=True)
	run_root = _run_root()
	run_root.mkdir(parents=True, exist_ok=True)
	store = JobStore(DATA_ROOT / "control.sqlite3")
	store.mark_interrupted()
	runner = JobRunner(store, PROJECT_ROOT, DATA_ROOT)
	app.state.store = store
	app.state.runner = runner
	app.state.available_devices = _detect_devices()
	runner.start()
	try:
		yield
	finally:
		await runner.stop()


app = FastAPI(title="Humanoid RL", lifespan=lifespan)


def run() -> None:
	import uvicorn

	uvicorn.run(
		"backend.main:app",
		host=os.getenv("BACKEND_HOST", "127.0.0.1"),
		port=int(os.getenv("BACKEND_PORT", "8000")),
		workers=1,
		env_file=PROJECT_ROOT / "application" / ".env",
	)


def _store(request: Request) -> JobStore:
	return request.app.state.store


@app.get("/health")
def health() -> dict[str, str]:
	return {"status": "ok"}


@app.get("/devices", response_model=list[Device])
def list_devices(request: Request) -> list[Device]:
	return request.app.state.available_devices


@app.post("/assets", response_model=AssetView, status_code=201)
async def upload_asset(request: Request, file: UploadFile = File(...)) -> AssetView:
	filename = Path(file.filename or "video").name
	extension = Path(filename).suffix.lower()
	if extension not in {".mp4", ".mov"}:
		raise HTTPException(status_code=415, detail="Only MP4 and MOV videos are supported.")

	store = _store(request)
	asset_id = str(uuid4())
	upload_dir = DATA_ROOT / "uploads"
	upload_dir.mkdir(parents=True, exist_ok=True)
	destination = upload_dir / f"{asset_id}{extension}"
	size_bytes = 0
	try:
		with destination.open("wb") as output:
			while chunk := await file.read(1024 * 1024):
				size_bytes += len(chunk)
				if size_bytes > MAX_UPLOAD_BYTES:
					raise HTTPException(status_code=413, detail="Video exceeds the 1 GB upload limit.")
				output.write(chunk)
	except Exception:
		destination.unlink(missing_ok=True)
		raise
	finally:
		await file.close()

	asset = Asset(
		id=asset_id,
		filename=filename,
		extension=extension,
		size_bytes=size_bytes,
		created_at=datetime.now(timezone.utc),
	)
	store.register_asset(asset)
	return _asset_view(asset)


@app.get("/assets", response_model=list[AssetView])
def list_assets(request: Request) -> list[AssetView]:
	return [_asset_view(asset) for asset in _store(request).list_assets()]


@app.get("/assets/{asset_id}/files", response_model=list[AssetFileView])
def list_asset_files(request: Request, asset_id: str) -> list[AssetFileView]:
	asset = _store(request).get_asset(asset_id)
	if not asset:
		raise HTTPException(status_code=404, detail="Asset not found.")
	return _asset_file_entries(asset)


@app.get("/assets/{asset_id}/files/{file_path:path}")
def preview_asset_file(request: Request, asset_id: str, file_path: str) -> FileResponse:
	asset = _store(request).get_asset(asset_id)
	if not asset:
		raise HTTPException(status_code=404, detail="Asset not found.")
	path = _resolve_asset_file(asset, file_path)
	media_type, _ = mimetypes.guess_type(path.name)
	if not path.is_file() or not media_type or not media_type.startswith("video/"):
		raise HTTPException(status_code=404, detail="Video file not found.")
	return FileResponse(path, media_type=media_type, headers={"Content-Disposition": "inline"})


@app.delete("/assets/{asset_id}", status_code=204, response_class=Response)
def delete_asset(request: Request, asset_id: str) -> Response:
	store = _store(request)
	asset = store.get_asset(asset_id)
	if not asset:
		raise HTTPException(status_code=404, detail="Asset not found.")
	if _has_active_job_reference(store, lambda payload: _references_asset(payload, asset_id)):
		raise HTTPException(status_code=409, detail="Cancel active jobs using this asset before deleting it.")

	upload = _managed_path(DATA_ROOT / "uploads", _asset_file(asset))
	artifact_root = _managed_path(DATA_ROOT / "artifacts", DATA_ROOT / "artifacts" / asset_id)

	upload.unlink(missing_ok=True)
	if artifact_root.is_symlink():
		artifact_root.unlink()
	elif artifact_root.is_dir():
		shutil.rmtree(artifact_root)
	if not store.delete_asset(asset_id):
		raise HTTPException(status_code=404, detail="Asset not found.")
	return Response(status_code=204)


@app.get("/assets/{asset_id}/download")
def download_asset(request: Request, asset_id: str) -> FileResponse:
	asset = _store(request).get_asset(asset_id)
	if not asset:
		raise HTTPException(status_code=404, detail="Asset not found.")

	upload_root = DATA_ROOT / "uploads"
	source = _managed_path(upload_root, _asset_file(asset))
	if not source.is_file():
		raise HTTPException(status_code=404, detail="Uploaded video not found.")
	artifact_root = DATA_ROOT / "artifacts"
	asset_artifacts = _managed_path(artifact_root, artifact_root / asset_id)
	archive_prefix = Path("asset") / asset_id

	def write_contents(archive: zipfile.ZipFile) -> None:
		archive.write(source, (archive_prefix / "input" / Path(asset.filename).name).as_posix())
		_add_directory_to_archive(archive, asset_artifacts, (archive_prefix / "artifacts").as_posix(), artifact_root)

	return _create_zip_response(f"asset-{asset_id}.zip", write_contents)


@app.get("/assets/{asset_id}/artifacts/{artifact_name}")
def download_artifact(request: Request, asset_id: str, artifact_name: str) -> FileResponse:
	asset = _store(request).get_asset(asset_id)
	if not asset:
		raise HTTPException(status_code=404, detail="Asset not found.")
	artifact = _artifact_paths(asset_id).get(artifact_name)
	if not artifact or not artifact.is_file():
		raise HTTPException(status_code=404, detail="Artifact not found.")
	return FileResponse(artifact, filename=artifact.name)


@app.get("/assets/{asset_id}/previews/{preview_name}")
def preview_video(request: Request, asset_id: str, preview_name: str) -> FileResponse:
	asset = _store(request).get_asset(asset_id)
	if not asset:
		raise HTTPException(status_code=404, detail="Asset not found.")
	preview = _preview_paths(asset.id).get(preview_name)
	if not preview or not preview.is_file():
		raise HTTPException(status_code=404, detail="Preview not found.")
	return FileResponse(preview, media_type="video/mp4")


@app.post("/jobs", response_model=Job, status_code=202)
def submit_job(request: Request, submission: JobSubmission) -> Job:
	store = _store(request)
	payload: dict[str, Any] = submission.model_dump(exclude_none=True)
	if submission.kind in DEVICE_KINDS and submission.kind != JobKind.RESUME:
		available_devices: list[Device] = request.app.state.available_devices
		preferred_device = _preferred_device(available_devices)
		device = submission.device or preferred_device
		if device not in available_devices:
			raise HTTPException(
				status_code=422,
				detail=f"Device '{device}' is unavailable. Available devices: {', '.join(available_devices)}.",
			)
		payload["device"] = device
		if submission.kind == JobKind.TRAIN:
			env_device = submission.env_device or preferred_device
			if env_device not in available_devices:
				raise HTTPException(
					status_code=422,
					detail=f"Environment device '{env_device}' is unavailable. Available devices: {', '.join(available_devices)}.",
				)
			payload["env_device"] = env_device
	if submission.kind in PROCESSING_KINDS:
		if not submission.asset_id:
			raise HTTPException(status_code=422, detail="Processing jobs require an asset_id.")
		asset = store.get_asset(submission.asset_id)
		if not asset or not _asset_file(asset).is_file():
			raise HTTPException(status_code=404, detail="Uploaded video not found.")
		paths = _artifact_paths(asset.id)
		if submission.kind == JobKind.PROCESS_GMR and not paths["gvhmr"].is_file():
			raise HTTPException(status_code=409, detail="Run GVHMR before GMR.")
		if submission.kind == JobKind.PROCESS_CSV_TO_NPZ and not paths["gmr_csv"].is_file():
			raise HTTPException(status_code=409, detail="Run GMR before CSV-to-NPZ.")
		payload["extension"] = asset.extension
	elif submission.kind == JobKind.TRAIN:
		if submission.asset_id:
			payload["motion_path"] = str(_motion_for_asset(store, submission.asset_id))
		elif submission.motion_path:
			payload["motion_path"] = str(_resolve_motion_path(submission.motion_path))
		else:
			raise HTTPException(status_code=422, detail="Training requires an asset_id or motion_path.")
	elif submission.kind == JobKind.RESUME:
		if not submission.run_id or not submission.checkpoint:
			raise HTTPException(status_code=422, detail="Resume requires a run_id and checkpoint.")
		checkpoint_path = _resolve_checkpoint(submission.run_id, submission.checkpoint)
		run_dir = checkpoint_path.parent
		config = _load_run_job_config(submission.run_id, run_dir)
		try:
			motion_path = _resolve_motion_path(config["motion_path"])
		except HTTPException as error:
			raise HTTPException(status_code=409, detail=f"The saved motion file is unavailable: {error.detail}") from error
		available_devices = request.app.state.available_devices
		for key in ("device", "env_device"):
			if config[key] not in available_devices:
				raise HTTPException(
					status_code=409,
					detail=f"Saved {key.replace('_', ' ')} '{config[key]}' is unavailable. Available devices: {', '.join(available_devices)}.",
				)
		payload["run_name"] = config["run_name"]
		payload["experiment"] = config["experiment"]
		payload["checkpoint"] = checkpoint_path.name
		payload["motion_path"] = str(motion_path)
		payload["device"] = config["device"]
		payload["env_device"] = config["env_device"]
		payload["max_iterations"] = config["max_iterations"]
		payload["num_envs"] = config["num_envs"]
	elif submission.kind == JobKind.PLAY:
		if not submission.run_id or not submission.checkpoint:
			raise HTTPException(status_code=422, detail="Playback requires a run_id and checkpoint.")
		checkpoint_path = _resolve_checkpoint(submission.run_id, submission.checkpoint)
		motion_path = (
			_motion_for_asset(store, submission.asset_id)
			if submission.asset_id
			else _resolve_motion_path(submission.motion_path or "")
		)
		payload["checkpoint_path"] = str(checkpoint_path)
		payload["motion_path"] = str(motion_path)
	elif submission.kind == JobKind.PLAY_CHAIN:
		if len(submission.asset_ids) < 2 or len(submission.asset_ids) != len(submission.run_ids) or len(submission.run_ids) != len(submission.checkpoints):
			raise HTTPException(status_code=422, detail="Play chain requires at least two matching asset/run/checkpoint entries.")
		payload["motion_paths"] = [str(_motion_for_asset(store, asset_id)) for asset_id in submission.asset_ids]
		payload["checkpoint_paths"] = [
			str(_resolve_checkpoint(run_id, checkpoint))
			for run_id, checkpoint in zip(submission.run_ids, submission.checkpoints, strict=True)
		]
	elif submission.kind == JobKind.TENSORBOARD:
		if not submission.run_id:
			raise HTTPException(status_code=422, detail="TensorBoard requires a run_id.")
		run_dir = _resolve_run_directory(submission.run_id)
		tensorboard = PROJECT_ROOT / "third_party/unitree_rl_mjlab/.venv/bin/tensorboard"
		if not tensorboard.is_file():
			raise HTTPException(status_code=503, detail="TensorBoard is not installed in the training environment.")
		_tensorboard_port()
		payload["run_dir"] = str(run_dir)
	else:
		raise HTTPException(status_code=422, detail=f"Job kind {submission.kind.value} cannot be submitted.")

	return store.submit(submission.kind, payload)


@app.get("/jobs", response_model=list[Job])
def list_jobs(request: Request) -> list[Job]:
	return _store(request).list()


@app.get("/jobs/{job_id}", response_model=Job)
def get_job(request: Request, job_id: str) -> Job:
	job = _store(request).get(job_id)
	if not job:
		raise HTTPException(status_code=404, detail="Job not found.")
	return job


@app.get("/jobs/{job_id}/ready")
async def job_ready(request: Request, job_id: str) -> dict[str, bool]:
	job = _store(request).get(job_id)
	if not job or job.kind != JobKind.TENSORBOARD or job.status != JobStatus.RUNNING:
		return {"ready": False}
	port = _tensorboard_port()
	try:
		_, writer = await asyncio.wait_for(asyncio.open_connection("127.0.0.1", port), timeout=0.25)
	except (OSError, TimeoutError):
		return {"ready": False}
	writer.close()
	await writer.wait_closed()
	return {"ready": True}


@app.post("/jobs/{job_id}/cancel", response_model=Job)
async def cancel_job(request: Request, job_id: str) -> Job:
	job = await request.app.state.runner.cancel(job_id)
	if not job:
		raise HTTPException(status_code=409, detail="Job is not queued or running.")
	return job


@app.delete("/jobs/{job_id}", status_code=204, response_class=Response)
def delete_job(request: Request, job_id: str) -> Response:
	store = _store(request)
	job = store.get(job_id)
	if not job:
		raise HTTPException(status_code=404, detail="Job not found.")
	if job.status in {JobStatus.QUEUED, JobStatus.RUNNING}:
		raise HTTPException(status_code=409, detail="Cancel the job before deleting it.")
	if not store.delete(job_id):
		if not store.get(job_id):
			raise HTTPException(status_code=404, detail="Job not found.")
		raise HTTPException(status_code=409, detail="Job cannot be deleted while it is active.")
	shutil.rmtree(DATA_ROOT / "jobs" / job.id, ignore_errors=True)
	return Response(status_code=204)


@app.get("/jobs/{job_id}/events")
async def job_events(request: Request, job_id: str) -> StreamingResponse:
	store = _store(request)
	if not store.get(job_id):
		raise HTTPException(status_code=404, detail="Job not found.")
	log_path = DATA_ROOT / "jobs" / job_id / "worker.log"
	offset = int(request.headers.get("last-event-id", "0"))

	async def stream() -> AsyncIterator[str]:
		nonlocal offset
		while not await request.is_disconnected():
			job = store.get(job_id)
			if not job:
				break
			if log_path.is_file():
				with log_path.open("rb") as log_file:
					log_file.seek(offset)
					while line := log_file.readline():
						offset = log_file.tell()
						message = json.dumps({"line": line.decode("utf-8", errors="replace").rstrip()})
						yield f"id: {offset}\nevent: log\ndata: {message}\n\n"
			yield f"event: status\ndata: {job.model_dump_json()}\n\n"
			if job.status not in {JobStatus.QUEUED, JobStatus.RUNNING} and (not log_path.exists() or offset >= log_path.stat().st_size):
				break
			await asyncio.sleep(0.5)

	return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


@app.get("/runs")
def list_runs() -> list[RunView]:
	runs_root = _run_root()
	if not runs_root.is_dir():
		return []
	runs: list[RunView] = []
	for experiment_dir in runs_root.iterdir():
		if not experiment_dir.is_dir():
			continue
		for run_dir in experiment_dir.iterdir():
			if not run_dir.is_dir():
				continue
			checkpoints = sorted(path.name for path in run_dir.glob("*.pt"))
			modified_at = datetime.fromtimestamp(run_dir.stat().st_mtime, timezone.utc)
			runs.append(
				RunView(
					id=f"{experiment_dir.name}/{run_dir.name}",
					name=run_dir.name,
					experiment=experiment_dir.name,
					checkpoints=checkpoints,
					modified_at=modified_at,
				)
			)
	return sorted(runs, key=lambda run: run.modified_at, reverse=True)


@app.get("/runs/{experiment}/{run_name}/files", response_model=list[RunFileView])
def list_run_files(experiment: str, run_name: str) -> list[RunFileView]:
	run_dir = _resolve_run_directory(f"{experiment}/{run_name}")
	return _run_file_entries(run_dir)


@app.delete("/runs/{experiment}/{run_name}", status_code=204, response_class=Response)
async def delete_run(request: Request, experiment: str, run_name: str) -> Response:
	run_id = f"{experiment}/{run_name}"
	run_dir = _resolve_run_directory(run_id)
	store = _store(request)
	if _has_active_job_reference(store, lambda payload: _references_run(payload, run_id, run_dir)):
		raise HTTPException(status_code=409, detail="Cancel active jobs using this run before deleting it.")

	shutil.rmtree(run_dir)
	return Response(status_code=204)


@app.get("/runs/{experiment}/{run_name}/download")
def download_run(request: Request, experiment: str, run_name: str) -> FileResponse:
	run_id = f"{experiment}/{run_name}"
	run_dir = _resolve_run_directory(run_id)
	run_root = _run_root().resolve()
	archive_prefix = Path(experiment) / run_name

	def write_contents(archive: zipfile.ZipFile) -> None:
		_add_directory_to_archive(archive, run_dir, archive_prefix.as_posix(), run_root)

	return _create_zip_response(f"run-{experiment}-{run_name}.zip", write_contents)
