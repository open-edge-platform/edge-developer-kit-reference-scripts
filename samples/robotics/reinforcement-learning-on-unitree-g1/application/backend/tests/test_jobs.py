import asyncio
import io
import json
import sys
import zipfile
from types import SimpleNamespace

from backend.jobs import Job, JobKind, JobStatus, JobStore
from fastapi.testclient import TestClient
from backend.runner import JobRunner

from backend import main


def test_claim_next_serializes_training_but_allows_other_jobs(tmp_path):
    store = JobStore(tmp_path / "jobs.sqlite3")
    first = store.submit(JobKind.TRAIN, {"run": "first"})
    second = store.submit(JobKind.PROCESS_GVHMR, {"video": "second"})
    third = store.submit(JobKind.RESUME, {"run": "third"})
    fourth = store.submit(JobKind.PROCESS_GMR, {"video": "fourth"})

    claimed_first = store.claim_next()
    assert claimed_first is not None
    assert claimed_first.id == first.id
    assert claimed_first.status == JobStatus.RUNNING
    claimed_second = store.claim_next()
    assert claimed_second is not None
    assert claimed_second.id == second.id
    claimed_fourth = store.claim_next()
    assert claimed_fourth is not None
    assert claimed_fourth.id == fourth.id
    assert store.claim_next() is None

    store.finish(first.id, exit_code=0)
    claimed_third = store.claim_next()
    assert claimed_third is not None
    assert claimed_third.id == third.id


def test_claim_next_allows_only_one_playback_job_at_a_time(tmp_path):
    store = JobStore(tmp_path / "jobs.sqlite3")
    play = store.submit(JobKind.PLAY, {})
    play_chain = store.submit(JobKind.PLAY_CHAIN, {})

    claimed_play = store.claim_next()
    assert claimed_play is not None
    assert claimed_play.id == play.id
    assert store.claim_next() is None

    store.finish(play.id, exit_code=0)
    claimed_chain = store.claim_next()
    assert claimed_chain is not None
    assert claimed_chain.id == play_chain.id


def test_claim_next_allows_only_one_tensorboard_job_at_a_time(tmp_path):
    store = JobStore(tmp_path / "jobs.sqlite3")
    first = store.submit(JobKind.TENSORBOARD, {"run_id": "first"})
    second = store.submit(JobKind.TENSORBOARD, {"run_id": "second"})

    claimed = store.claim_next()
    assert claimed is not None
    assert claimed.id == first.id
    assert store.claim_next() is None

    store.finish(first.id, exit_code=0)
    next_claimed = store.claim_next()
    assert next_claimed is not None
    assert next_claimed.id == second.id


def test_delete_only_removes_terminal_jobs(tmp_path):
    store = JobStore(tmp_path / "jobs.sqlite3")
    succeeded = store.submit(JobKind.TRAIN, {})
    store.claim_next()
    store.finish(succeeded.id, exit_code=0)
    running = store.submit(JobKind.PLAY, {})
    store.claim_next()
    queued = store.submit(JobKind.PROCESS_GMR, {})

    assert store.delete(running.id) is False
    assert store.delete(queued.id) is False
    assert store.delete(succeeded.id) is True
    assert store.get(succeeded.id) is None
    assert store.get(running.id).status == JobStatus.RUNNING
    assert store.get(queued.id).status == JobStatus.QUEUED


def test_restart_marks_queued_and_running_jobs_interrupted(tmp_path):
    store = JobStore(tmp_path / "jobs.sqlite3")
    first = store.submit(JobKind.TRAIN, {})
    running = store.submit(JobKind.PLAY, {})
    queued = store.submit(JobKind.PROCESS_GMR, {})
    store.claim_next()
    store.finish(first.id, exit_code=0)
    store.claim_next()

    store.mark_interrupted()

    assert store.get(first.id).status == JobStatus.SUCCEEDED
    assert store.get(running.id).status == JobStatus.INTERRUPTED
    assert store.get(queued.id).status == JobStatus.INTERRUPTED
    assert store.claim_next() is None


def test_upload_and_stage_order_validation(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "DATA_ROOT", tmp_path)

    with TestClient(main.app) as client:
        response = client.post(
            "/assets",
            files={"file": ("../walk.mp4", b"video-bytes", "video/mp4")},
        )
        assert response.status_code == 201
        asset = response.json()
        assert asset["filename"] == "walk.mp4"
        assert asset["artifacts"] == []

        queued_gmr = client.post(
            "/jobs",
            json={"kind": "process_gmr", "asset_id": asset["id"]},
        )
        assert queued_gmr.status_code == 409
        assert client.get("/jobs").json() == []


def test_list_asset_files_includes_upload_and_nested_artifacts(tmp_path, monkeypatch):
    data_root = tmp_path / "data"
    monkeypatch.setattr(main, "DATA_ROOT", data_root)
    monkeypatch.setattr(main.JobRunner, "start", lambda self: None)

    with TestClient(main.app) as client:
        asset = client.post(
            "/assets",
            files={"file": ("walk.mp4", b"video-bytes", "video/mp4")},
        ).json()
        artifact_dir = data_root / "artifacts" / asset["id"] / "gmr" / "nested"
        artifact_dir.mkdir(parents=True)
        (artifact_dir / "preview.mov").write_bytes(b"preview")
        (artifact_dir / "motion.npz").write_bytes(b"motion")

        response = client.get(f"/assets/{asset['id']}/files")

    assert response.status_code == 200
    assert response.json() == [
        {"path": "input/walk.mp4", "is_video": True},
        {"path": "artifacts/gmr/nested/motion.npz", "is_video": False},
        {"path": "artifacts/gmr/nested/preview.mov", "is_video": True},
    ]


def test_asset_file_routes_handle_missing_assets_and_empty_files(tmp_path, monkeypatch):
    data_root = tmp_path / "data"
    monkeypatch.setattr(main, "DATA_ROOT", data_root)
    monkeypatch.setattr(main.JobRunner, "start", lambda self: None)

    with TestClient(main.app) as client:
        asset = client.post(
            "/assets",
            files={"file": ("walk.mp4", b"video-bytes", "video/mp4")},
        ).json()
        missing_asset = client.get("/assets/missing/files")
        missing_video = client.get(f"/assets/{asset['id']}/files/artifacts/not-a-video.mp4")
        (data_root / "uploads" / f"{asset['id']}.mp4").unlink()
        empty_files = client.get(f"/assets/{asset['id']}/files")

    assert empty_files.json() == []
    assert missing_asset.status_code == 404
    assert missing_video.status_code == 404


def test_asset_file_routes_reject_traversal_and_symlinks(tmp_path, monkeypatch):
    data_root = tmp_path / "data"
    monkeypatch.setattr(main, "DATA_ROOT", data_root)
    monkeypatch.setattr(main.JobRunner, "start", lambda self: None)

    with TestClient(main.app) as client:
        asset = client.post(
            "/assets",
            files={"file": ("walk.mp4", b"video-bytes", "video/mp4")},
        ).json()
        outside = data_root / "outside.mp4"
        outside.write_bytes(b"secret")
        asset_dir = data_root / "artifacts" / asset["id"]
        asset_dir.mkdir(parents=True)
        (asset_dir / "linked.mp4").symlink_to(outside)

        traversal = client.get(f"/assets/{asset['id']}/files/artifacts/../outside.mp4")
        linked_file = client.get(f"/assets/{asset['id']}/files/artifacts/linked.mp4")
        listed_files = client.get(f"/assets/{asset['id']}/files")

    assert traversal.status_code in {404, 409}
    assert linked_file.status_code == 409
    assert listed_files.status_code == 409


def test_asset_video_file_is_served_inline_and_non_video_is_not(tmp_path, monkeypatch):
    data_root = tmp_path / "data"
    monkeypatch.setattr(main, "DATA_ROOT", data_root)
    monkeypatch.setattr(main.JobRunner, "start", lambda self: None)

    with TestClient(main.app) as client:
        asset = client.post(
            "/assets",
            files={"file": ("walk.mp4", b"video-bytes", "video/mp4")},
        ).json()
        artifact_dir = data_root / "artifacts" / asset["id"] / "gmr"
        artifact_dir.mkdir(parents=True)
        video = artifact_dir / "preview.mp4"
        video.write_bytes(b"preview-bytes")
        motion = artifact_dir / "motion.npz"
        motion.write_bytes(b"motion")

        video_response = client.get(f"/assets/{asset['id']}/files/artifacts/gmr/preview.mp4")
        range_response = client.get(
            f"/assets/{asset['id']}/files/artifacts/gmr/preview.mp4",
            headers={"Range": "bytes=0-3"},
        )
        non_video_response = client.get(f"/assets/{asset['id']}/files/artifacts/gmr/motion.npz")

    assert video_response.status_code == 200
    assert video_response.content == b"preview-bytes"
    assert video_response.headers["content-type"].startswith("video/mp4")
    assert video_response.headers["content-disposition"] == "inline"
    assert range_response.status_code == 206
    assert range_response.content == b"prev"
    assert range_response.headers["content-range"] == "bytes 0-3/13"
    assert non_video_response.status_code == 404


def test_delete_job_removes_terminal_history_and_logs(tmp_path, monkeypatch):
    data_root = tmp_path / "data"
    monkeypatch.setattr(main, "DATA_ROOT", data_root)
    monkeypatch.setattr(main.JobRunner, "start", lambda self: None)

    with TestClient(main.app) as client:
        store = client.app.state.store
        job = store.submit(JobKind.TRAIN, {})
        store.claim_next()
        store.finish(job.id, exit_code=0)
        log_dir = data_root / "jobs" / job.id
        log_dir.mkdir(parents=True)
        (log_dir / "worker.log").write_text("completed output")

        queued = store.submit(JobKind.PLAY, {})
        active_response = client.delete(f"/jobs/{queued.id}")
        deleted_response = client.delete(f"/jobs/{job.id}")
        missing_response = client.delete(f"/jobs/{job.id}")

    assert active_response.status_code == 409
    assert deleted_response.status_code == 204
    assert missing_response.status_code == 404
    assert store.get(job.id) is None
    assert store.get(queued.id).status == JobStatus.QUEUED
    assert not log_dir.exists()


def test_delete_asset_removes_source_artifacts_and_preview(tmp_path, monkeypatch):
    data_root = tmp_path / "data"
    project_root = tmp_path / "project"
    monkeypatch.setattr(main, "DATA_ROOT", data_root)
    monkeypatch.setattr(main, "PROJECT_ROOT", project_root)
    monkeypatch.setattr(main.JobRunner, "start", lambda self: None)

    with TestClient(main.app) as client:
        asset = client.post(
            "/assets",
            files={"file": ("walk.mp4", b"video-bytes", "video/mp4")},
        ).json()
        source = data_root / "uploads" / f"{asset['id']}.mp4"
        artifact_dir = data_root / "artifacts" / asset["id"]
        artifact_dir.mkdir(parents=True)
        (artifact_dir / "motion.npz").write_bytes(b"motion")
        preview = project_root / "third_party/GMR/videos" / f"unitree_g1_{asset['id']}.mp4"
        preview.parent.mkdir(parents=True)
        preview.write_bytes(b"preview")

        deleted = client.delete(f"/assets/{asset['id']}")
        missing = client.delete(f"/assets/{asset['id']}")

    assert deleted.status_code == 204
    assert missing.status_code == 404
    assert not source.exists()
    assert not artifact_dir.exists()
    assert not preview.exists()


def test_delete_asset_rejects_active_jobs_that_reference_it(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "DATA_ROOT", tmp_path / "data")
    monkeypatch.setattr(main.JobRunner, "start", lambda self: None)

    with TestClient(main.app) as client:
        asset = client.post(
            "/assets",
            files={"file": ("walk.mp4", b"video-bytes", "video/mp4")},
        ).json()
        job = client.app.state.store.submit(JobKind.PROCESS_GVHMR, {"asset_id": asset["id"]})

        response = client.delete(f"/assets/{asset['id']}")

        assert client.app.state.store.get_asset(asset["id"]) is not None
        assert client.app.state.store.get(job.id) is not None

    assert response.status_code == 409


def test_delete_run_rejects_active_jobs_and_removes_run_directory(tmp_path, monkeypatch):
    data_root = tmp_path / "data"
    project_root = tmp_path / "project"
    run_dir = data_root / "runs/rsl_rl/g1_tracking/run-a"
    run_dir.mkdir(parents=True)
    (run_dir / "model_0.pt").write_bytes(b"checkpoint")
    monkeypatch.setattr(main, "DATA_ROOT", data_root)
    monkeypatch.setattr(main, "PROJECT_ROOT", project_root)
    monkeypatch.setattr(main.JobRunner, "start", lambda self: None)

    with TestClient(main.app) as client:
        store = client.app.state.store
        store.submit(JobKind.RESUME, {"run_id": "g1_tracking/run-a"})
        blocked = client.delete("/runs/g1_tracking/run-a")
        store.mark_interrupted()
        deleted = client.delete("/runs/g1_tracking/run-a")
        missing = client.delete("/runs/g1_tracking/run-a")

    assert blocked.status_code == 409
    assert deleted.status_code == 204
    assert missing.status_code == 404
    assert not run_dir.exists()


def test_delete_run_requires_active_tensorboard_job_to_be_canceled(tmp_path, monkeypatch):
    project_root = tmp_path / "project"
    data_root = tmp_path / "data"
    run_dir = data_root / "runs/rsl_rl/g1_tracking/run-a"
    run_dir.mkdir(parents=True)
    monkeypatch.setattr(main, "DATA_ROOT", data_root)
    monkeypatch.setattr(main, "PROJECT_ROOT", project_root)
    monkeypatch.setattr(main.JobRunner, "start", lambda self: None)

    with TestClient(main.app) as client:
        job = client.app.state.store.submit(
            JobKind.TENSORBOARD,
            {"run_id": "g1_tracking/run-a", "run_dir": str(run_dir)},
        )
        client.app.state.store.claim_next()
        blocked = client.delete("/runs/g1_tracking/run-a")
        assert client.app.state.store.get(job.id).status == JobStatus.RUNNING
        client.app.state.store.finish(job.id, exit_code=0)
        response = client.delete("/runs/g1_tracking/run-a")

    assert blocked.status_code == 409
    assert response.status_code == 204
    assert not run_dir.exists()


def test_list_runs_uses_data_root_and_ignores_legacy_runs(tmp_path, monkeypatch):
    data_root = tmp_path / "data"
    project_root = tmp_path / "project"
    run_dir = data_root / "runs/rsl_rl/g1_tracking/new-run"
    legacy_run_dir = project_root / "third_party/unitree_rl_mjlab/logs/rsl_rl/g1_tracking/old-run"
    run_dir.mkdir(parents=True)
    legacy_run_dir.mkdir(parents=True)
    (run_dir / "model_0.pt").write_bytes(b"checkpoint")
    (legacy_run_dir / "model_0.pt").write_bytes(b"legacy checkpoint")
    monkeypatch.setattr(main, "DATA_ROOT", data_root)
    monkeypatch.setattr(main, "PROJECT_ROOT", project_root)
    monkeypatch.setattr(main.JobRunner, "start", lambda self: None)

    with TestClient(main.app) as client:
        response = client.get("/runs")

    assert response.status_code == 200
    assert [run["id"] for run in response.json()] == ["g1_tracking/new-run"]
    assert legacy_run_dir.exists()


def test_download_asset_archives_input_artifacts_and_generated_preview(tmp_path, monkeypatch):
    data_root = tmp_path / "data"
    project_root = tmp_path / "project"
    monkeypatch.setattr(main, "DATA_ROOT", data_root)
    monkeypatch.setattr(main, "PROJECT_ROOT", project_root)
    monkeypatch.setattr(main.JobRunner, "start", lambda self: None)

    with TestClient(main.app) as client:
        asset = client.post(
            "/assets",
            files={"file": ("walk.mp4", b"video-bytes", "video/mp4")},
        ).json()
        artifact_dir = data_root / "artifacts" / asset["id"] / "gmr"
        artifact_dir.mkdir(parents=True)
        (artifact_dir / "processed.npz").write_bytes(b"processed")
        preview = project_root / "third_party/GMR/videos" / f"unitree_g1_{asset['id']}.mp4"
        preview.parent.mkdir(parents=True)
        preview.write_bytes(b"preview")

        response = client.get(f"/assets/{asset['id']}/download")

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    assert response.headers["content-disposition"].endswith(f'filename="asset-{asset["id"]}.zip"')
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        assert set(archive.namelist()) == {
            f"asset/{asset['id']}/input/walk.mp4",
            f"asset/{asset['id']}/artifacts/gmr/processed.npz",
            f"asset/{asset['id']}/generated-videos/{preview.name}",
        }
        assert archive.read(f"asset/{asset['id']}/input/walk.mp4") == b"video-bytes"


def test_download_asset_requires_existing_upload(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "DATA_ROOT", tmp_path / "data")
    monkeypatch.setattr(main.JobRunner, "start", lambda self: None)

    with TestClient(main.app) as client:
        asset = client.post(
            "/assets",
            files={"file": ("walk.mp4", b"video-bytes", "video/mp4")},
        ).json()
        (tmp_path / "data" / "uploads" / f"{asset['id']}.mp4").unlink()

        missing_upload = client.get(f"/assets/{asset['id']}/download")
        missing_asset = client.get("/assets/not-an-asset/download")

    assert missing_upload.status_code == 404
    assert missing_asset.status_code == 404


def test_download_asset_rejects_symlinked_artifact_directory(tmp_path, monkeypatch):
    data_root = tmp_path / "data"
    monkeypatch.setattr(main, "DATA_ROOT", data_root)
    monkeypatch.setattr(main.JobRunner, "start", lambda self: None)

    with TestClient(main.app) as client:
        asset = client.post(
            "/assets",
            files={"file": ("walk.mp4", b"video-bytes", "video/mp4")},
        ).json()
        artifacts_root = data_root / "artifacts"
        artifacts_root.mkdir(parents=True)
        unrelated = artifacts_root / "unrelated"
        unrelated.mkdir()
        (unrelated / "secret.txt").write_text("not this asset")
        (artifacts_root / asset["id"]).symlink_to(unrelated, target_is_directory=True)

        response = client.get(f"/assets/{asset['id']}/download")

    assert response.status_code == 409


def test_download_run_archives_only_the_selected_run(tmp_path, monkeypatch):
    project_root = tmp_path / "project"
    data_root = tmp_path / "data"
    run_dir = data_root / "runs/rsl_rl/g1_tracking/run-a"
    unrelated_run = data_root / "runs/rsl_rl/g1_tracking/run-b"
    aliased_run = data_root / "runs/rsl_rl/g1_tracking/run-alias"
    run_dir.mkdir(parents=True)
    unrelated_run.mkdir(parents=True)
    (run_dir / "model_0.pt").write_bytes(b"checkpoint")
    (run_dir / "logs" ).mkdir()
    (run_dir / "logs" / "progress.csv").write_text("step,reward\n")
    (unrelated_run / "model_0.pt").write_bytes(b"other")
    aliased_run.symlink_to(run_dir, target_is_directory=True)
    monkeypatch.setattr(main, "PROJECT_ROOT", project_root)
    monkeypatch.setattr(main, "DATA_ROOT", data_root)
    monkeypatch.setattr(main.JobRunner, "start", lambda self: None)

    with TestClient(main.app) as client:
        response = client.get("/runs/g1_tracking/run-a/download")
        missing = client.get("/runs/g1_tracking/missing/download")
        traversal = client.get("/runs/../unitree_rl_mjlab/download")
        symlinked = client.get("/runs/g1_tracking/run-alias/download")

    assert response.status_code == 200
    assert response.headers["content-disposition"].endswith('filename="run-g1_tracking-run-a.zip"')
    assert missing.status_code == 404
    assert traversal.status_code == 404
    assert symlinked.status_code == 404
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        assert set(archive.namelist()) == {
            "g1_tracking/run-a/model_0.pt",
            "g1_tracking/run-a/logs/progress.csv",
        }


def test_list_run_files_returns_nested_paths_and_handles_empty_or_missing_runs(tmp_path, monkeypatch):
    project_root = tmp_path / "project"
    data_root = tmp_path / "data"
    run_root = data_root / "runs/rsl_rl/g1_tracking"
    run_dir = run_root / "run-a"
    empty_run = run_root / "run-empty"
    (run_dir / "logs/nested").mkdir(parents=True)
    empty_run.mkdir(parents=True)
    (run_dir / "model_0.pt").write_bytes(b"checkpoint")
    (run_dir / "logs/nested/progress.csv").write_text("step,reward\n")
    monkeypatch.setattr(main, "PROJECT_ROOT", project_root)
    monkeypatch.setattr(main, "DATA_ROOT", data_root)
    monkeypatch.setattr(main.JobRunner, "start", lambda self: None)

    with TestClient(main.app) as client:
        files = client.get("/runs/g1_tracking/run-a/files")
        empty = client.get("/runs/g1_tracking/run-empty/files")
        missing = client.get("/runs/g1_tracking/missing/files")

    assert files.status_code == 200
    assert files.json() == [{"path": "logs/nested/progress.csv"}, {"path": "model_0.pt"}]
    assert empty.status_code == 200
    assert empty.json() == []
    assert missing.status_code == 404


def test_list_run_files_rejects_symlinks(tmp_path, monkeypatch):
    data_root = tmp_path / "data"
    run_dir = data_root / "runs/rsl_rl/g1_tracking/run-a"
    outside = tmp_path / "outside.txt"
    run_dir.mkdir(parents=True)
    outside.write_text("outside")
    (run_dir / "linked.txt").symlink_to(outside)
    monkeypatch.setattr(main, "DATA_ROOT", data_root)
    monkeypatch.setattr(main.JobRunner, "start", lambda self: None)

    with TestClient(main.app) as client:
        response = client.get("/runs/g1_tracking/run-a/files")

    assert response.status_code == 409


def test_asset_preview_routes_serve_inline_videos_and_return_404_when_missing(tmp_path, monkeypatch):
    data_root = tmp_path / "data"
    project_root = tmp_path / "project"
    monkeypatch.setattr(main, "DATA_ROOT", data_root)
    monkeypatch.setattr(main, "PROJECT_ROOT", project_root)
    monkeypatch.setattr(main.JobRunner, "start", lambda self: None)

    with TestClient(main.app) as client:
        asset = client.post(
            "/assets",
            files={"file": ("walk.mp4", b"video-bytes", "video/mp4")},
        ).json()
        preview_paths = main._preview_paths(asset["id"])
        assert preview_paths["gvhmr_global"].name == f"{asset['id']}_3_incam_global_horiz.mp4"
        for preview in preview_paths.values():
            preview.parent.mkdir(parents=True, exist_ok=True)
            preview.write_bytes(b"rendered-video")

        for preview_name in preview_paths:
            response = client.get(f"/assets/{asset['id']}/previews/{preview_name}")
            assert response.status_code == 200
            assert response.headers["content-type"] == "video/mp4"
            assert "attachment" not in response.headers.get("content-disposition", "")
            assert response.content == b"rendered-video"

        missing = client.get(f"/assets/{asset['id']}/previews/unknown")
        assert missing.status_code == 404


def test_training_rejects_motion_paths_outside_data_roots(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "DATA_ROOT", tmp_path / "data")

    with TestClient(main.app) as client:
        response = client.post(
            "/jobs",
            json={"kind": "train", "motion_path": str(tmp_path / "outside.npz")},
        )

    assert response.status_code == 422


def test_training_motion_must_be_staged_under_data_root(tmp_path, monkeypatch):
    data_root = tmp_path / "data"
    project_root = tmp_path / "project"
    motion_path = data_root / "motions/g1/reference.npz"
    legacy_motion_path = project_root / "third_party/unitree_rl_mjlab/src/assets/motions/g1/reference.npz"
    motion_path.parent.mkdir(parents=True)
    motion_path.write_bytes(b"motion")
    legacy_motion_path.parent.mkdir(parents=True)
    legacy_motion_path.write_bytes(b"motion")
    monkeypatch.setattr(main, "DATA_ROOT", data_root)
    monkeypatch.setattr(main, "PROJECT_ROOT", project_root)
    monkeypatch.setattr(main.JobRunner, "start", lambda self: None)

    with TestClient(main.app) as client:
        staged = client.post("/jobs", json={"kind": "train", "motion_path": str(motion_path)})
        legacy = client.post("/jobs", json={"kind": "train", "motion_path": str(legacy_motion_path)})

    assert staged.status_code == 202
    assert staged.json()["payload"]["motion_path"] == str(motion_path)
    assert legacy.status_code == 422


def test_device_endpoint_and_job_validation_use_available_devices(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "DATA_ROOT", tmp_path / "data")
    monkeypatch.setattr(main.JobRunner, "start", lambda self: None)

    with TestClient(main.app) as client:
        client.app.state.available_devices = ["cpu", "xpu"]

        assert client.get("/devices").json() == ["cpu", "xpu"]
        cpu_job = client.post("/jobs", json={"kind": "resume", "device": "cpu"})
        assert cpu_job.status_code == 422
        assert "Resume requires" in cpu_job.json()["detail"]

        xpu_job = client.post("/jobs", json={"kind": "resume", "device": "xpu"})
        assert xpu_job.status_code == 422
        assert "Resume requires" in xpu_job.json()["detail"]

        cuda_job = client.post("/jobs", json={"kind": "resume", "device": "cuda"})
        assert cuda_job.status_code == 422


def test_training_accepts_independent_devices_and_defaults_by_preference(tmp_path, monkeypatch):
    data_root = tmp_path / "data"
    motion_path = data_root / "artifacts" / "motion.npz"
    motion_path.parent.mkdir(parents=True)
    motion_path.write_bytes(b"motion")
    monkeypatch.setattr(main, "DATA_ROOT", data_root)
    monkeypatch.setattr(main.JobRunner, "start", lambda self: None)

    with TestClient(main.app) as client:
        client.app.state.available_devices = ["cpu", "xpu"]

        selected = client.post(
            "/jobs",
            json={
                "kind": "train",
                "motion_path": str(motion_path),
                "device": "xpu",
                "env_device": "cpu",
            },
        )
        assert selected.status_code == 202
        assert selected.json()["payload"]["device"] == "xpu"
        assert selected.json()["payload"]["env_device"] == "cpu"

        defaults = client.post(
            "/jobs",
            json={"kind": "train", "motion_path": str(motion_path)},
        )
        assert defaults.status_code == 202
        assert defaults.json()["payload"]["device"] == "xpu"
        assert defaults.json()["payload"]["env_device"] == "xpu"


def test_resume_uses_saved_run_configuration_instead_of_submission_defaults(tmp_path, monkeypatch):
    data_root = tmp_path / "data"
    run_dir = data_root / "runs/rsl_rl/g1_tracking/run-a"
    motion_path = data_root / "motions/g1/reference.npz"
    run_dir.mkdir(parents=True)
    motion_path.parent.mkdir(parents=True)
    motion_path.write_bytes(b"motion")
    (run_dir / "model_20.pt").write_bytes(b"checkpoint")
    (run_dir / "job_config.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "run_id": "g1_tracking/run-a",
                "experiment": "g1_tracking",
                "run_name": "run-a",
                "motion_path": str(motion_path),
                "max_iterations": 40000,
                "num_envs": 2048,
                "device": "xpu",
                "env_device": "cpu",
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(main, "DATA_ROOT", data_root)
    monkeypatch.setattr(main.JobRunner, "start", lambda self: None)

    with TestClient(main.app) as client:
        client.app.state.available_devices = ["cpu", "xpu"]
        response = client.post(
            "/jobs",
            json={
                "kind": "resume",
                "run_id": "g1_tracking/run-a",
                "checkpoint": "model_20.pt",
                "device": "cpu",
                "env_device": "xpu",
                "max_iterations": 10,
                "num_envs": 4,
            },
        )

    assert response.status_code == 202
    assert response.json()["payload"]["run_name"] == "run-a"
    assert response.json()["payload"]["experiment"] == "g1_tracking"
    assert response.json()["payload"]["motion_path"] == str(motion_path.resolve())
    assert response.json()["payload"]["device"] == "xpu"
    assert response.json()["payload"]["env_device"] == "cpu"
    assert response.json()["payload"]["max_iterations"] == 40000
    assert response.json()["payload"]["num_envs"] == 2048


def test_resume_rejects_legacy_run_without_saved_configuration(tmp_path, monkeypatch):
    data_root = tmp_path / "data"
    run_dir = data_root / "runs/rsl_rl/g1_tracking/legacy-run"
    run_dir.mkdir(parents=True)
    (run_dir / "model_0.pt").write_bytes(b"checkpoint")
    monkeypatch.setattr(main, "DATA_ROOT", data_root)
    monkeypatch.setattr(main.JobRunner, "start", lambda self: None)

    with TestClient(main.app) as client:
        response = client.post(
            "/jobs",
            json={"kind": "resume", "run_id": "g1_tracking/legacy-run", "checkpoint": "model_0.pt"},
        )

    assert response.status_code == 409
    assert "no saved training configuration" in response.json()["detail"]


def test_resume_rejects_saved_devices_unavailable_on_current_host(tmp_path, monkeypatch):
    data_root = tmp_path / "data"
    run_dir = data_root / "runs/rsl_rl/g1_tracking/run-a"
    motion_path = data_root / "motions/g1/reference.npz"
    run_dir.mkdir(parents=True)
    motion_path.parent.mkdir(parents=True)
    motion_path.write_bytes(b"motion")
    (run_dir / "model_0.pt").write_bytes(b"checkpoint")
    (run_dir / "job_config.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "run_id": "g1_tracking/run-a",
                "experiment": "g1_tracking",
                "run_name": "run-a",
                "motion_path": str(motion_path),
                "max_iterations": 10,
                "num_envs": 2,
                "device": "xpu",
                "env_device": "cpu",
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(main, "DATA_ROOT", data_root)
    monkeypatch.setattr(main.JobRunner, "start", lambda self: None)

    with TestClient(main.app) as client:
        client.app.state.available_devices = ["cpu"]
        response = client.post(
            "/jobs",
            json={"kind": "resume", "run_id": "g1_tracking/run-a", "checkpoint": "model_0.pt"},
        )

    assert response.status_code == 409
    assert "Saved device 'xpu' is unavailable" in response.json()["detail"]


def test_runner_passes_device_to_training_commands(tmp_path):
    runner = JobRunner(JobStore(tmp_path / "jobs.sqlite3"), tmp_path, tmp_path)
    train = Job(
        id="train-job",
        kind=JobKind.TRAIN,
        payload={"motion_path": "motion.npz", "max_iterations": 10, "num_envs": 2, "device": "xpu", "env_device": "cpu"},
        status=JobStatus.QUEUED,
        created_at="2026-10-05T00:00:00Z",
    )
    resume = Job(
        id="resume-job",
        kind=JobKind.RESUME,
        payload={
            "motion_path": "motion.npz",
            "run_name": "run",
            "checkpoint": "model.pt",
            "max_iterations": 10,
            "num_envs": 4,
            "device": "cpu",
            "env_device": "xpu",
            "experiment": "g1_tracking",
        },
        status=JobStatus.QUEUED,
        created_at="2026-10-05T00:00:00Z",
    )

    train_command = runner._command_for(train)[0]
    assert train_command[-3:] == ["xpu", "cpu", "train-jo"]
    assert runner._command_for(resume)[0][-5:] == ["xpu", "g1_tracking", "4", "cpu", "resume-j"]


def test_runner_passes_data_root_to_child_processes(tmp_path, monkeypatch):
    async def exercise():
        data_root = tmp_path / "persistent-data"
        runner = JobRunner(
            JobStore(tmp_path / "jobs.sqlite3"), tmp_path, data_root, run_directory_timeout=1
        )
        runner._command_for = lambda job: (["fake-command"], str(tmp_path))
        job = runner.store.submit(
            JobKind.TRAIN,
            {
                "motion_path": str(tmp_path / "motion.npz"),
                "max_iterations": 10,
                "num_envs": 2,
                "device": "cpu",
                "env_device": "cpu",
            },
        )
        runner.store.claim_next()
        process = asyncio.StreamReader()
        run_dir = data_root / "runs/rsl_rl/experiment/run-a"
        run_dir.mkdir(parents=True)
        process.feed_data(f"[INFO] Logging experiment in directory: {run_dir}\n".encode())
        process.feed_eof()
        captured = {}

        async def fake_create_subprocess_exec(*command, **kwargs):
            captured.update(kwargs)

            class FakeProcess:
                stdout = process

                async def wait(self):
                    return 0

            return FakeProcess()

        monkeypatch.setattr("backend.runner.asyncio.create_subprocess_exec", fake_create_subprocess_exec)
        await runner._run_job(job)
        return captured, run_dir

    captured, run_dir = asyncio.run(exercise())

    assert captured["env"]["HUMANOID_RL_DATA_DIR"] == str((tmp_path / "persistent-data").resolve())
    assert captured["env"]["PYTHONUNBUFFERED"] == "1"
    config = (run_dir / "job_config.json").read_text()
    assert '"run_name": "run-a"' in config
    assert '"motion_path":' in config


def test_runner_waits_for_announced_run_directory_while_streaming_output(tmp_path, monkeypatch):
    async def exercise():
        data_root = tmp_path / "data"
        runner = JobRunner(
            JobStore(tmp_path / "jobs.sqlite3"), tmp_path, data_root, run_directory_timeout=1
        )
        runner._command_for = lambda job: (["fake-command"], str(tmp_path))
        job = runner.store.submit(
            JobKind.TRAIN,
            {
                "motion_path": str(tmp_path / "motion.npz"),
                "max_iterations": 20,
                "num_envs": 4,
                "device": "cpu",
                "env_device": "cpu",
            },
        )
        runner.store.claim_next()
        stdout = asyncio.StreamReader()
        release_process = asyncio.Event()
        run_dir = data_root / "runs/rsl_rl/experiment/delayed-run"
        log_path = data_root / "jobs" / job.id / "worker.log"

        class FakeProcess:
            def __init__(self):
                self.stdout = stdout
                self.returncode = None

            async def wait(self):
                await release_process.wait()
                self.returncode = 0
                return 0

        async def fake_create_subprocess_exec(*command, **kwargs):
            return FakeProcess()

        monkeypatch.setattr("backend.runner.asyncio.create_subprocess_exec", fake_create_subprocess_exec)
        task = asyncio.create_task(runner._run_job(job))
        await asyncio.sleep(0)
        stdout.feed_data(
            f"[INFO] Logging experiment in directory: {run_dir}\ninitializing\n".encode()
        )
        stdout.feed_eof()

        async def wait_for_log():
            while not log_path.exists() or b"initializing\n" not in log_path.read_bytes():
                await asyncio.sleep(0)

        await asyncio.wait_for(wait_for_log(), timeout=1)
        assert not (run_dir / "job_config.json").exists()
        await asyncio.sleep(0.01)
        assert not (run_dir / "job_config.json").exists()
        run_dir.mkdir(parents=True)

        async def wait_for_config():
            while not (run_dir / "job_config.json").is_file():
                await asyncio.sleep(0)

        await asyncio.wait_for(wait_for_config(), timeout=1)
        release_process.set()
        await task
        return runner.store.get(job.id)

    job = asyncio.run(exercise())
    assert job.status == JobStatus.SUCCEEDED


def test_runner_flushes_newline_and_carriage_return_output_while_running(tmp_path, monkeypatch):
    async def exercise():
        data_root = tmp_path / "data"
        runner = JobRunner(JobStore(tmp_path / "jobs.sqlite3"), tmp_path, data_root)
        runner._command_for = lambda job: (["fake-command"], str(tmp_path))
        job = runner.store.submit(JobKind.PROCESS_GVHMR, {})
        runner.store.claim_next()
        stdout = asyncio.StreamReader()
        allow_exit = asyncio.Event()
        log_path = data_root / "jobs" / job.id / "worker.log"

        class FakeProcess:
            def __init__(self):
                self.stdout = stdout

            async def wait(self):
                await allow_exit.wait()
                return 0

        async def fake_create_subprocess_exec(*command, **kwargs):
            return FakeProcess()

        monkeypatch.setattr("backend.runner.asyncio.create_subprocess_exec", fake_create_subprocess_exec)
        task = asyncio.create_task(runner._run_job(job))
        await asyncio.sleep(0)

        async def wait_for_log(expected):
            while not log_path.exists() or log_path.read_bytes() != expected:
                await asyncio.sleep(0)

        stdout.feed_data(b"step 1\r")
        await asyncio.wait_for(wait_for_log(b"step 1\n"), timeout=1)
        assert not task.done()
        assert runner.store.get(job.id).status == JobStatus.RUNNING

        stdout.feed_data(b"\nstep 2\rpartial")
        await asyncio.wait_for(wait_for_log(b"step 1\nstep 2\n"), timeout=1)
        stdout.feed_eof()
        await asyncio.wait_for(wait_for_log(b"step 1\nstep 2\npartial\n"), timeout=1)
        assert not task.done()
        allow_exit.set()
        await task
        assert runner.store.get(job.id).status == JobStatus.SUCCEEDED

    asyncio.run(exercise())


def test_job_events_yields_logs_before_job_finishes(tmp_path, monkeypatch):
    data_root = tmp_path / "data"
    monkeypatch.setattr(main, "DATA_ROOT", data_root)
    store = JobStore(tmp_path / "jobs.sqlite3")
    job = store.submit(JobKind.TRAIN, {})
    store.claim_next()
    log_path = data_root / "jobs" / job.id / "worker.log"
    log_path.parent.mkdir(parents=True)
    log_path.write_bytes(b"live output\n")

    class ConnectedRequest:
        headers = {}
        app = SimpleNamespace(state=SimpleNamespace(store=store))

        async def is_disconnected(self):
            return False

    async def exercise():
        response = await main.job_events(ConnectedRequest(), job.id)
        events = response.body_iterator
        log_event = await anext(events)
        status_event = await anext(events)
        await events.aclose()
        return log_event, status_event

    log_event, status_event = asyncio.run(exercise())

    assert log_event.startswith("id: 12\nevent: log\ndata:")
    assert '"line": "live output"' in log_event
    assert status_event.startswith("event: status\ndata:")
    assert '"status":"running"' in status_event
    assert store.get(job.id).status == JobStatus.RUNNING


def test_runner_passes_configured_playback_port(tmp_path, monkeypatch):
    monkeypatch.delenv("NEXT_PUBLIC_HUMANOID_RL_PLAYBACK_PORT", raising=False)
    runner = JobRunner(JobStore(tmp_path / "jobs.sqlite3"), tmp_path, tmp_path)
    play = Job(
        id="play-job",
        kind=JobKind.PLAY,
        payload={"motion_path": "motion.npz", "checkpoint_path": "model.pt", "device": "cpu"},
        status=JobStatus.QUEUED,
        created_at="2026-10-05T00:00:00Z",
    )
    play_chain = Job(
        id="play-chain-job",
        kind=JobKind.PLAY_CHAIN,
        payload={
            "checkpoint_paths": ["model-a.pt", "model-b.pt"],
            "motion_paths": ["motion-a.npz", "motion-b.npz"],
            "device": "cpu",
        },
        status=JobStatus.QUEUED,
        created_at="2026-10-05T00:00:00Z",
    )

    assert runner._command_for(play)[0][-1] == "8000"
    assert runner._command_for(play_chain)[0][2:5] == ["cpu", "--port", "8000"]

    monkeypatch.setenv("NEXT_PUBLIC_HUMANOID_RL_PLAYBACK_PORT", "8181")
    assert runner._command_for(play)[0][-1] == "8181"
    assert runner._command_for(play_chain)[0][2:5] == ["cpu", "--port", "8181"]


def test_play_validates_run_and_checkpoint_before_queueing(tmp_path, monkeypatch):
    data_root = tmp_path / "data"
    project_root = tmp_path / "project"
    run_dir = data_root / "runs/rsl_rl/g1_tracking/run-a"
    run_dir.mkdir(parents=True)
    (run_dir / "model_0.pt").write_bytes(b"checkpoint")
    monkeypatch.setattr(main, "DATA_ROOT", data_root)
    monkeypatch.setattr(main, "PROJECT_ROOT", project_root)
    monkeypatch.setattr(main.JobRunner, "start", lambda self: None)

    with TestClient(main.app) as client:
        uploaded = client.post(
            "/assets",
            files={"file": ("walk.mp4", b"video-bytes", "video/mp4")},
        ).json()
        motion_path = data_root / "artifacts" / uploaded["id"] / "motion.npz"
        motion_path.parent.mkdir(parents=True)
        motion_path.write_bytes(b"motion")

        response = client.post(
            "/jobs",
            json={
                "kind": "play",
                "asset_id": uploaded["id"],
                "run_id": "g1_tracking/run-a",
                "checkpoint": "model_0.pt",
            },
        )
        assert response.status_code == 202
        assert response.json()["payload"]["checkpoint_path"] == str(run_dir / "model_0.pt")

        traversal = client.post(
            "/jobs",
            json={"kind": "play", "run_id": "../../outside", "checkpoint": "model_0.pt", "motion_path": str(motion_path)},
        )
        assert traversal.status_code == 404


def test_play_chain_requires_matching_pairs(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "DATA_ROOT", tmp_path / "data")
    monkeypatch.setattr(main, "PROJECT_ROOT", tmp_path / "project")
    monkeypatch.setattr(main.JobRunner, "start", lambda self: None)

    with TestClient(main.app) as client:
        response = client.post(
            "/jobs",
            json={"kind": "play_chain", "asset_ids": ["one", "two"], "run_ids": ["run"], "checkpoints": ["a.pt", "b.pt"]},
        )

    assert response.status_code == 422


def test_tensorboard_job_uses_only_selected_run_and_custom_port(tmp_path, monkeypatch):
    project_root = tmp_path / "project"
    data_root = tmp_path / "data"
    run_dir = data_root / "runs/rsl_rl/g1_tracking/run-a"
    run_dir.mkdir(parents=True)
    tensorboard = project_root / "third_party/unitree_rl_mjlab/.venv/bin/tensorboard"
    tensorboard.parent.mkdir(parents=True)
    tensorboard.touch()
    monkeypatch.setattr(main, "PROJECT_ROOT", project_root)
    monkeypatch.setattr(main, "DATA_ROOT", data_root)
    monkeypatch.setattr(main.JobRunner, "start", lambda self: None)
    monkeypatch.setenv("NEXT_PUBLIC_HUMANOID_RL_TENSORBOARD_PORT", "6007")

    with TestClient(main.app) as client:
        invalid = client.post("/jobs", json={"kind": "tensorboard", "run_id": "../../outside"})
        assert invalid.status_code == 404

        response = client.post("/jobs", json={"kind": "tensorboard", "run_id": "g1_tracking/run-a"})
        runner = JobRunner(client.app.state.store, project_root, data_root)

    assert response.status_code == 202
    assert response.json()["kind"] == "tensorboard"
    assert response.json()["payload"]["run_dir"] == str(run_dir)
    job = Job(**response.json())
    args, _ = runner._command_for(job)
    assert args[0] == str(tensorboard)
    assert args[args.index("--logdir") + 1] == str(run_dir)
    assert args[args.index("--port") + 1] == "6007"


def test_tensorboard_ready_requires_running_job_and_open_port(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "DATA_ROOT", tmp_path / "data")
    monkeypatch.setattr(main, "PROJECT_ROOT", tmp_path / "project")
    monkeypatch.setattr(main.JobRunner, "start", lambda self: None)
    monkeypatch.setenv("NEXT_PUBLIC_HUMANOID_RL_TENSORBOARD_PORT", "6007")

    class Writer:
        def close(self):
            pass

        async def wait_closed(self):
            pass

    async def open_connection(*args, **kwargs):
        return None, Writer()

    monkeypatch.setattr(main.asyncio, "open_connection", open_connection)
    with TestClient(main.app) as client:
        job = client.app.state.store.submit(JobKind.TENSORBOARD, {})
        queued = client.get(f"/jobs/{job.id}/ready")
        client.app.state.store.claim_next()
        running = client.get(f"/jobs/{job.id}/ready")

    assert queued.json() == {"ready": False}
    assert running.json() == {"ready": True}


def test_runner_cancels_active_process_group(tmp_path, monkeypatch):
    async def exercise():
        store = JobStore(tmp_path / "jobs.sqlite3")
        runner = JobRunner(store, tmp_path, tmp_path)
        monkeypatch.setattr(
            runner,
            "_command_for",
            lambda job: ([sys.executable, "-c", "import time; time.sleep(30)"], str(tmp_path)),
        )
        job = store.submit(JobKind.TRAIN, {})
        runner.start()
        for _ in range(100):
            if job.id in runner._processes:
                break
            await asyncio.sleep(0.01)

        canceled = await runner.cancel(job.id)
        await runner.stop()
        return canceled

    canceled = asyncio.run(exercise())
    assert canceled is not None
    assert canceled.status == JobStatus.CANCELED


def test_runner_starts_non_training_job_while_training_runs(tmp_path):
    async def exercise():
        store = JobStore(tmp_path / "jobs.sqlite3")
        runner = JobRunner(store, tmp_path, tmp_path)
        runner._command_for = lambda job: (
            [sys.executable, "-c", "import time; time.sleep(30)"],
            str(tmp_path),
        )
        training = store.submit(JobKind.TRAIN, {})
        processing = store.submit(JobKind.PROCESS_GVHMR, {})
        runner.start()

        for _ in range(200):
            if training.id in runner._processes and processing.id in runner._processes:
                break
            await asyncio.sleep(0.01)

        both_running = (
            training.id in runner._processes
            and processing.id in runner._processes
            and store.get(training.id).status == JobStatus.RUNNING
            and store.get(processing.id).status == JobStatus.RUNNING
        )
        await runner.stop()
        return both_running

    assert asyncio.run(exercise())


def test_retrying_early_stage_invalidates_downstream_artifacts(tmp_path):
    store = JobStore(tmp_path / "jobs.sqlite3")
    runner = JobRunner(store, tmp_path, tmp_path)
    asset_id = "asset-123"
    artifact_root = tmp_path / "artifacts" / asset_id
    gmr_preview = tmp_path / "third_party/GMR/videos/unitree_g1_asset-123.mp4"
    gmr_preview.parent.mkdir(parents=True, exist_ok=True)
    gmr_preview.touch()
    for relative_path in (
        "gvhmr/asset-123/hmr4d_results.pt",
        "gmr/csv/asset-123_g1.csv",
        "motion.npz",
    ):
        path = artifact_root / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.touch()

    runner._prepare_job(
        Job(
            id="job-123",
            kind=JobKind.PROCESS_GVHMR,
            payload={"asset_id": asset_id},
            status=JobStatus.RUNNING,
            created_at="2026-10-05T00:00:00Z",
        )
    )

    assert not (artifact_root / "gvhmr").exists()
    assert not (artifact_root / "gmr").exists()
    assert not (artifact_root / "motion.npz").exists()
    assert not gmr_preview.exists()


def test_retrying_gmr_removes_only_the_asset_preview(tmp_path):
    runner = JobRunner(JobStore(tmp_path / "jobs.sqlite3"), tmp_path, tmp_path)
    videos_dir = tmp_path / "third_party/GMR/videos"
    current_preview = videos_dir / "unitree_g1_asset-123.mp4"
    other_preview = videos_dir / "unitree_g1_other-asset.mp4"
    current_preview.parent.mkdir(parents=True)
    current_preview.touch()
    other_preview.touch()

    runner._prepare_job(
        Job(
            id="job-456",
            kind=JobKind.PROCESS_GMR,
            payload={"asset_id": "asset-123"},
            status=JobStatus.RUNNING,
            created_at="2026-10-05T00:00:00Z",
        )
    )

    assert not current_preview.exists()
    assert other_preview.exists()