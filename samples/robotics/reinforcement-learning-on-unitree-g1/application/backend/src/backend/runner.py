# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import asyncio
import json
import os
import shutil
import signal
from pathlib import Path

from .jobs import Job, JobKind, JobStatus, JobStore

_RUN_DIRECTORY_LOG_PREFIX = b"[INFO] Logging experiment in directory: "
_RUN_CONFIG_NAME = "job_config.json"


class JobRunner:
    def __init__(
        self,
        store: JobStore,
        project_root: Path,
        data_root: Path,
        run_directory_timeout: float = 600,
    ) -> None:
        self.store = store
        self.project_root = project_root
        self.data_root = data_root
        self.run_directory_timeout = run_directory_timeout
        self._stopping = False
        self._task: asyncio.Task[None] | None = None
        self._tasks: dict[str, asyncio.Task[None]] = {}
        self._processes: dict[str, asyncio.subprocess.Process] = {}
        self._canceled: set[str] = set()

    def start(self) -> None:
        self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        self._stopping = True
        await asyncio.gather(
            *(self._terminate_process(job_id) for job_id in tuple(self._processes))
        )
        if self._task:
            await self._task

    async def cancel(self, job_id: str) -> Job | None:
        canceled = self.store.cancel_queued(job_id)
        if canceled:
            return canceled
        job = self.store.get(job_id)
        if not job or job.status != JobStatus.RUNNING or job_id not in self._tasks:
            return None
        self._canceled.add(job_id)
        await self._terminate_process(job_id)
        return self.store.cancel_running(job_id) or self.store.get(job_id)

    async def _terminate_process(self, job_id: str) -> None:
        process = self._processes.get(job_id)
        if not process or process.returncode is not None:
            return
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            return
        try:
            await asyncio.wait_for(process.wait(), timeout=8)
        except TimeoutError:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            await process.wait()

    async def _run(self) -> None:
        while not self._stopping:
            for job_id, task in tuple(self._tasks.items()):
                if task.done():
                    self._tasks.pop(job_id)
                    if not task.cancelled():
                        task.exception()

            claimed = False
            while not self._stopping:
                job = self.store.claim_next()
                if job is None:
                    break
                self._tasks[job.id] = asyncio.create_task(self._run_job_guarded(job))
                claimed = True

            if not claimed:
                await asyncio.sleep(0.5)
        if self._tasks:
            await asyncio.gather(*self._tasks.values(), return_exceptions=True)

    async def _run_job_guarded(self, job: Job) -> None:
        try:
            await self._run_job(job)
        except Exception as exc:
            self.store.finish(job.id, exit_code=1, error=str(exc))
        finally:
            self._processes.pop(job.id, None)

    async def _run_job(self, job: Job) -> None:
        if self._stopping:
            self.store.interrupt_running(job.id, "Backend shutting down; resubmit this job.")
            return
        self._prepare_job(job)
        job_dir = self.data_root / "jobs" / job.id
        job_dir.mkdir(parents=True, exist_ok=True)
        log_path = job_dir / "worker.log"
        process = None
        output_task = None
        config_task = None
        config_written = False
        try:
            command, cwd = self._command_for(job)
            process = await asyncio.create_subprocess_exec(
                *command,
                cwd=cwd,
                env={
                    **os.environ,
                    "HUMANOID_RL_DATA_DIR": str(self.data_root.resolve()),
                    "PYTHONUNBUFFERED": "1",
                },
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                start_new_session=True,
            )
            self._processes[job.id] = process
            if self._stopping or job.id in self._canceled:
                await self._terminate_process(job.id)
            with log_path.open("ab") as log_file:
                assert process.stdout is not None
                pending = bytearray()
                skip_lf = False

                def write_line(line: bytes) -> None:
                    nonlocal config_task
                    log_file.write(line)
                    log_file.write(b"\n")
                    log_file.flush()
                    if (
                        job.kind in {JobKind.TRAIN, JobKind.RESUME}
                        and config_task is None
                        and line.startswith(_RUN_DIRECTORY_LOG_PREFIX)
                    ):
                        announced_path = line[len(_RUN_DIRECTORY_LOG_PREFIX):].decode(
                            "utf-8", errors="replace"
                        ).strip()
                        config_task = asyncio.create_task(
                            self._wait_and_write_run_config(job, announced_path, cwd)
                        )

                output_task = asyncio.create_task(process.stdout.read(4096))
                while True:
                    waiting = {output_task}
                    if config_task is not None:
                        waiting.add(config_task)
                    done, _ = await asyncio.wait(waiting, return_when=asyncio.FIRST_COMPLETED)
                    if config_task is not None and config_task in done:
                        await config_task
                        config_task = None
                        config_written = True
                    if output_task not in done:
                        continue
                    chunk = output_task.result()
                    if not chunk:
                        output_task = None
                        break
                    for value in chunk:
                        if skip_lf:
                            skip_lf = False
                            if value == 0x0A:
                                continue
                        if value in (0x0A, 0x0D):
                            write_line(bytes(pending))
                            pending.clear()
                            skip_lf = value == 0x0D
                        else:
                            pending.append(value)
                    output_task = asyncio.create_task(process.stdout.read(4096))
                if pending:
                    write_line(bytes(pending))
            exit_code = await process.wait()
            if exit_code == 0 and job.kind in {JobKind.TRAIN, JobKind.RESUME}:
                if config_task is not None:
                    await config_task
                    config_task = None
                    config_written = True
                if not config_written:
                    raise RuntimeError("Training process exited without announcing its run directory.")
            elif config_task is not None:
                config_task.cancel()
                await asyncio.gather(config_task, return_exceptions=True)
                config_task = None
        except Exception as exc:
            if output_task is not None and not output_task.done():
                output_task.cancel()
                await asyncio.gather(output_task, return_exceptions=True)
            if config_task is not None and not config_task.done():
                config_task.cancel()
                await asyncio.gather(config_task, return_exceptions=True)
            if process is not None and getattr(process, "returncode", None) is None:
                await self._terminate_process(job.id)
            self.store.finish(job.id, exit_code=1, error=str(exc))
            return

        if self._stopping:
            self.store.interrupt_running(job.id, "Backend shutting down; resubmit this job.")
        elif job.id in self._canceled:
            self.store.cancel_running(job.id)
            self._canceled.discard(job.id)
        else:
            error = None if exit_code == 0 else f"Process exited with code {exit_code}."
            self.store.finish(job.id, exit_code=exit_code, error=error)

    async def _wait_and_write_run_config(self, job: Job, announced_path: str, cwd: str) -> Path:
        run_root = (self.data_root / "runs" / "rsl_rl").resolve()
        path = Path(announced_path).expanduser()
        if not path.is_absolute():
            path = Path(cwd) / path
        path = Path(os.path.abspath(path))
        try:
            relative_path = path.relative_to(run_root)
        except ValueError as exc:
            raise ValueError("Training announced a run directory outside the configured run root.") from exc
        if len(relative_path.parts) != 2 or any(part in {"", ".", ".."} for part in relative_path.parts):
            raise ValueError("Training announced an invalid run directory.")

        deadline = asyncio.get_running_loop().time() + self.run_directory_timeout
        while not path.is_dir():
            if asyncio.get_running_loop().time() >= deadline:
                raise TimeoutError("Training run directory was not created before the startup timeout.")
            await asyncio.sleep(0.1)

        current = run_root
        for part in relative_path.parts:
            current = current / part
            if current.is_symlink():
                raise ValueError("Training run directories cannot contain symbolic links.")
        resolved_path = path.resolve(strict=True)
        if not resolved_path.is_relative_to(run_root):
            raise ValueError("Training run directory resolved outside the configured run root.")

        payload = job.payload
        config = {
            "schema_version": 1,
            "job_id": job.id,
            "kind": job.kind.value,
            "task": "Unitree-G1-Tracking-Sim2Real-No-Curriculum",
            "run_id": f"{relative_path.parts[0]}/{relative_path.parts[1]}",
            "experiment": relative_path.parts[0],
            "run_name": relative_path.parts[1],
            "motion_path": str(Path(payload["motion_path"]).expanduser().resolve()),
            "max_iterations": int(payload["max_iterations"]),
            "num_envs": int(payload["num_envs"]),
            "device": payload["device"],
            "env_device": payload.get("env_device", payload["device"]),
        }
        if job.kind == JobKind.RESUME:
            config["source_run_id"] = payload["run_id"]
            config["source_checkpoint"] = payload["checkpoint"]

        config_path = resolved_path / _RUN_CONFIG_NAME
        if config_path.exists() or config_path.is_symlink():
            raise FileExistsError(f"Run configuration already exists: {config_path}")
        temporary_path = resolved_path / f".{_RUN_CONFIG_NAME}.{job.id}.tmp"
        try:
            with temporary_path.open("x", encoding="utf-8") as config_file:
                json.dump(config, config_file, indent=2)
                config_file.write("\n")
                config_file.flush()
                os.fsync(config_file.fileno())
            os.replace(temporary_path, config_path)
        finally:
            temporary_path.unlink(missing_ok=True)
        return config_path

    def _prepare_job(self, job: Job) -> None:
        asset_id = job.payload.get("asset_id")
        if not asset_id:
            return
        artifact_root = self.data_root / "artifacts" / asset_id
        motion_path = artifact_root / "motion.npz"
        if job.kind == JobKind.PROCESS_GVHMR:
            shutil.rmtree(artifact_root / "gvhmr", ignore_errors=True)
            shutil.rmtree(artifact_root / "gmr", ignore_errors=True)
            motion_path.unlink(missing_ok=True)
        elif job.kind == JobKind.PROCESS_GMR:
            shutil.rmtree(artifact_root / "gmr", ignore_errors=True)
            motion_path.unlink(missing_ok=True)
        elif job.kind == JobKind.PROCESS_CSV_TO_NPZ:
            motion_path.unlink(missing_ok=True)

    def _command_for(self, job: Job) -> tuple[list[str], str]:
        scripts = self.project_root / "scripts"
        payload = job.payload
        if job.kind == JobKind.PROCESS_GVHMR:
            asset_id = payload["asset_id"]
            video_path = self.data_root / "uploads" / f"{asset_id}{payload['extension']}"
            output_dir = self.data_root / "artifacts" / asset_id / "gvhmr"
            return ["bash", str(scripts / "process" / "process-gvhmr.sh"), str(video_path), str(output_dir)], str(self.project_root)
        if job.kind == JobKind.PROCESS_GMR:
            asset_id = payload["asset_id"]
            prediction = self.data_root / "artifacts" / asset_id / "gvhmr" / asset_id / "hmr4d_results.pt"
            output_dir = self.data_root / "artifacts" / asset_id / "gmr"
            return ["bash", str(scripts / "process" / "process-gmr.sh"), str(prediction), str(output_dir), asset_id], str(self.project_root)
        if job.kind == JobKind.PROCESS_CSV_TO_NPZ:
            asset_id = payload["asset_id"]
            csv_path = self.data_root / "artifacts" / asset_id / "gmr" / "csv" / f"{asset_id}_g1.csv"
            output_path = self.data_root / "artifacts" / asset_id / "motion.npz"
            return ["bash", str(scripts / "process" / "process-csv-to-npz.sh"), str(csv_path), str(output_path)], str(self.project_root)
        if job.kind == JobKind.TRAIN:
            return [
                "bash",
                str(scripts / "train.sh"),
                payload["motion_path"],
                str(payload["max_iterations"]),
                str(payload["num_envs"]),
                payload["device"],
                payload["env_device"],
                job.id[:8],
            ], str(self.project_root)
        if job.kind == JobKind.RESUME:
            return [
                "bash",
                str(scripts / "resume.sh"),
                payload["motion_path"],
                payload["run_name"],
                payload["checkpoint"],
                str(payload["max_iterations"]),
                payload["env_device"],
                payload["experiment"],
                str(payload["num_envs"]),
                payload["device"],
                job.id[:8],
            ], str(self.project_root)
        if job.kind == JobKind.PLAY:
            return [
                "bash",
                str(scripts / "play.sh"),
                payload["motion_path"],
                payload["checkpoint_path"],
                payload["device"],
                os.environ.get("NEXT_PUBLIC_HUMANOID_RL_PLAYBACK_PORT", "8000"),
            ], str(self.project_root)
        if job.kind == JobKind.PLAY_CHAIN:
            pairs = [
                value
                for checkpoint, motion in zip(
                    payload["checkpoint_paths"], payload["motion_paths"], strict=True
                )
                for value in (checkpoint, motion)
            ]
            return [
                "bash",
                str(scripts / "play_chain.sh"),
                payload["device"],
                "--port",
                os.environ.get("NEXT_PUBLIC_HUMANOID_RL_PLAYBACK_PORT", "8000"),
                *pairs,
            ], str(self.project_root)
        if job.kind == JobKind.TENSORBOARD:
            tensorboard = self.project_root / "third_party/unitree_rl_mjlab/.venv/bin/tensorboard"
            return [
                str(tensorboard),
                "--logdir",
                payload["run_dir"],
                "--host",
                os.environ.get("TENSORBOARD_HOST", "127.0.0.1"),
                "--port",
                os.environ["NEXT_PUBLIC_HUMANOID_RL_TENSORBOARD_PORT"],
                "--path_prefix",
                "/tensorboard",
            ], str(self.project_root)
        raise ValueError(f"Unsupported job kind: {job.kind}")