# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import os
import time
import json
import shutil

from pathlib import Path
from fastapi import FastAPI
from fastapi.responses import Response, JSONResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from constants import DATA_DIR
from models import ConfigStatus, ConfigRequest, Project, ModelRequest
from modules.lerobot.physical_robot import (
    LeRobotModule,
    query_all_cameras,
    query_all_comports,
)
from modules.lerobot.finetune import LeRobotModelFineTuneModule
from modules.lerobot.simulation_robot import LeRobotSimModule
from modules.lerobot.dataset_utils import get_num_episodes_from_dataset


CONNECTED_ROBOT: LeRobotModule = None
MODEL_TRAINER: LeRobotModelFineTuneModule = None
HF_LEROBOT_DIR = "./data/datasets"


def update_config_file(config_name, config_status, config_data):
    robot_config_path = f"./data/{config_name}"
    workspace_config_path = f"{robot_config_path}/workspace.json"

    if Path(workspace_config_path).exists():
        with open(workspace_config_path, "r") as rfile:
            current_project = Project.model_validate_json(json_data=rfile.read())
            current_project.status = config_status
        with open(workspace_config_path, "w") as wfile:
            wfile.write(current_project.model_dump_json(indent=4))
    else:
        new_project = Project(
            name=config_name, status=config_status, configData=config_data
        )
        with open(workspace_config_path, "w") as wfile:
            wfile.write(new_project.model_dump_json(indent=4))

    with open(f"{DATA_DIR}/active_workspace", "w") as wfile:
        wfile.write(config_name if config_status else "")


@asynccontextmanager
async def lifespan(app: FastAPI):
    global CONNECTED_ROBOT
    """Cleanup function executed when the FastAPI server receives a shutdown signal (Ctrl+C)."""
    yield

    if CONNECTED_ROBOT != None:
        CONNECTED_ROBOT.stop()
        CONNECTED_ROBOT.join()


app = FastAPI(
    title="Embodied AI API",
    description="API to manage Embodied AI API.",
    version="1.0.0",
    lifespan=lifespan,
)

origins = [
    "http://localhost",
    "http://localhost:5173",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,  # This specifies the allowed domains
    allow_credentials=True,
    allow_methods=["*"],  # This allows all HTTP methods (POST, GET, etc.)
    allow_headers=["*"],  # This allows all headers
)


@app.get("/camera/info", tags=["LeRobot"])
def get_camera_info():
    cameras = query_all_cameras()
    return JSONResponse(cameras)


@app.get("/serial/info", tags=["LeRobot"])
def get_serial_ports():
    ttyACM_ports = query_all_comports()
    return JSONResponse(ttyACM_ports)


@app.post("/config/save", tags=["LeRobot"])
def post_config_info(request: ConfigRequest):
    config_name = request.configName

    robot_config_path = f"./data/{config_name}"
    Path(robot_config_path).mkdir(exist_ok=True)
    with open(f"{robot_config_path}/metadata.json", "w") as wfile:
        wfile.write(request.model_dump_json(indent=4))

    return JSONResponse(request.model_dump_json())


@app.post("/config/delete", tags=["LeRobot"])
def post_config_delete(request: ConfigRequest):
    config_name = request.configName
    robot_config_path = f"./data/{config_name}"

    if Path(robot_config_path).exists():
        shutil.rmtree(robot_config_path, ignore_errors=True)

    if Path(f"{HF_LEROBOT_DIR}/{config_name}").exists():
        shutil.rmtree(f"{HF_LEROBOT_DIR}/{config_name}", ignore_errors=True)

    return JSONResponse(request.model_dump_json())


@app.post("/config/activate/physical", tags=["LeRobot"])
def post_config_activate(request: ConfigStatus):
    global CONNECTED_ROBOT

    config_name = request.configName
    config_status = request.configActivated
    config_data = request.configData

    update_config_file(
        config_name=config_name, config_status=config_status, config_data=config_data
    )

    cameras = [cam.model_dump() for cam in config_data.cameras]
    fps = config_data.framerate
    robots = config_data.selectedPorts.model_dump()
    instruction = config_data.instruction
    num_of_episodes = config_data.episodes

    if config_status:
        if CONNECTED_ROBOT is not None:
            CONNECTED_ROBOT.stop()
            CONNECTED_ROBOT.disconnect()
            time.sleep(1)

        CONNECTED_ROBOT = LeRobotModule(
            name=config_name,
            cameras=cameras,
            fps=fps,
            robots=robots,
            instruction=instruction,
            num_of_episodes=num_of_episodes,
        )
        CONNECTED_ROBOT.connect()
    else:
        CONNECTED_ROBOT.disconnect()

    return JSONResponse(request.model_dump_json())


@app.post("/config/activate/simulation", tags=["LeRobot"])
def post_config_activate(request: ConfigStatus):
    global CONNECTED_ROBOT

    config_name = request.configName
    config_status = request.configActivated
    config_data = request.configData

    if config_status:
        if CONNECTED_ROBOT is not None:
            CONNECTED_ROBOT.stop()
        CONNECTED_ROBOT = LeRobotSimModule()
        CONNECTED_ROBOT.connect()
    else:
        CONNECTED_ROBOT.disconnect()

    return ""


@app.get("/video/feed", tags=["LeRobot"])
async def get_video_feed():
    global CONNECTED_ROBOT

    if CONNECTED_ROBOT.is_robot_disconnected.is_set():
        return Response("Feed is stopped.", status_code=503)

    return StreamingResponse(
        CONNECTED_ROBOT.live_stream(),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )


@app.get("/episode/start", tags=["Episode"])
def get_episode_start():
    global CONNECTED_ROBOT
    status, episode = CONNECTED_ROBOT.start_episode()
    if not status:
        return JSONResponse(
            {"status": "Maximum Number of Episodes has reached", "episode": episode},
            status_code=400,
        )

    return JSONResponse(
        {"status": "Recording Episode Start", "episode": episode + 1}, status_code=200
    )


@app.get("/episode/stop", tags=["Episode"])
def get_episode_start():
    global CONNECTED_ROBOT
    status = CONNECTED_ROBOT.stop_episode()


@app.get("/episode/save", tags=["Episode"])
def get_episode_save():
    global CONNECTED_ROBOT
    status, episode = CONNECTED_ROBOT.save_episode()
    if not status:
        return JSONResponse(
            {"status": "Maximum Number of Episodes has reached", "episode": episode},
            status_code=400,
        )
    return JSONResponse(
        {"status": "Episode saved", "episode": episode}, status_code=200
    )


@app.get("/episode/reset", tags=["Episode"])
def get_episode_reset():
    global CONNECTED_ROBOT
    status = CONNECTED_ROBOT.reset_episode()
    return JSONResponse({"status": "Episode reset"}, status_code=200)


@app.get("/episode/replay/{episode}", tags=["Episode"])
def get_episode_replay(episode: int):
    global CONNECTED_ROBOT
    return StreamingResponse(
        CONNECTED_ROBOT.replay_episode(episode - 1),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )


@app.get("/episode/metadata", tags=["Episode"])
def get_episode_metadata():
    global CONNECTED_ROBOT
    num_of_recorded_episodes = CONNECTED_ROBOT.get_dataset_metadata()
    return JSONResponse({"episodes": num_of_recorded_episodes})


@app.post("/train/model", tags=["Model FineTune"])
def post_train_act(request: ModelRequest):
    global MODEL_TRAINER
    if request.status == "Running":
        session_id = request.sessionId
        repo_id = request.dataset
        policy_type = request.model.lower()
        device = request.accelerator.lower()
        steps = request.hyperparameters.steps
        logFreq = request.hyperparameters.logFreq
        saveFreq = request.hyperparameters.saveFreq
        MODEL_TRAINER = LeRobotModelFineTuneModule(
            session_id=session_id,
            repo_id=repo_id,
            policy_type=policy_type,
            steps=steps,
            logFreq=logFreq,
            saveFreq=saveFreq,
        )
        MODEL_TRAINER.start()
    else:
        if MODEL_TRAINER is not None:
            MODEL_TRAINER.stop()


@app.get("/train/status", tags=["Model FineTune"])
async def get_train_status():
    global MODEL_TRAINER
    if MODEL_TRAINER is not None:
        return StreamingResponse(
            MODEL_TRAINER.monitor_training(), media_type="text/event-stream"
        )


@app.get("/datasets", tags=["Datasets"])
async def get_datasets():
    data_dir = Path(DATA_DIR)
    if not data_dir.is_dir():
        return []

    datasets = []
    for p in data_dir.iterdir():
        dataset = {}
        if p.is_dir() and not p.name.startswith("."):
            dataset["name"] = p.name
            dataset["path"] = p.as_posix()

            with open(f"{p.as_posix()}/metadata.json") as rfile:
                json_data: dict = json.loads(rfile.read())

            dataset["num_episodes"] = json_data.get("configData", {}).get(
                "episodes", -1
            )
            datasets.append(dataset)

    return datasets


@app.get("/datasets/{name}", tags=["Datasets"])
async def get_dataset_metadata(name: str):

    if not Path(f"data/{name}/metadata.json").exists():
        return []

    with open(f"data/{name}/metadata.json") as rfile:
        json_data: dict = json.loads(rfile.read())

    episodes = [
        {"episode": i + 1, "path": "video.mp4"}
        for i in range(get_num_episodes_from_dataset(name))
    ]

    return episodes


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app=app, host=os.getenv("SERVER_HOST","127.0.0.1"), port=5989)
