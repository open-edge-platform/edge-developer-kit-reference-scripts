import os
import cv2
import json
import time
import base64
import asyncio
import argparse
import logging
import subprocess  # nosec - used for subprocess calls to robot arm CLI tools
import threading
import multiprocessing
import numpy as np
from pathlib import Path
from queue import SimpleQueue
import pyrealsense2 as rs

import uvicorn
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastmcp import FastMCP, Context
from contextlib import asynccontextmanager

from utils.common import load_config, save_config
from utils.camera import create_camera_stream
from utils.model import ObjectDetector
from utils.client import OpenAIClient
from utils.platform import SO101

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp-server")

DEFAULT_PORT = 8024
SERVER_HOST = "127.0.0.1"
SERVER_PORT = DEFAULT_PORT

COLOR_CAMERA_QUEUE = SimpleQueue()
DEPTH_CAMERA_QUEUE = SimpleQueue()
CURRENT_FRAME = None
CURRENT_DEPTH_FRAME = None
CAMERA_STREAM = None
OBJECT_DETECTOR = None
OPENAI_CLIENT = None
ROBOT_ARM_CLIENT = None
CALIBRATION_STATE = "idle"  # "idle" | "awaiting_confirmation"
# "idle" | "awaiting_middle_position" | "awaiting_range_motion" | "complete" | "error"
MOTOR_CALIBRATION_STATE = "idle"
MOTOR_CALIBRATION_PROCESS = None
MOTOR_CALIBRATION_OUTPUT: list[str] = []
MOTOR_CALIBRATION_OUTPUT_LOCK = threading.Lock()
ROBOT_ARM_LOCK = asyncio.Lock()
LAST_FRAME_TIMESTAMP = 0
CURRENT_FRAME_LOCK = threading.Lock()
CONFIG = load_config("config.yaml")
MODEL_ID = CONFIG["client"]["model_id"]
ASSETS_DIR = Path("assets")
ASSETS_DIR.mkdir(parents=True, exist_ok=True)
ROBOT_FRAME = CONFIG.get("robot", {}).get("frame", [0, 0, 0])
AVAILABLE_ROBOT_TYPES = ["SO-ARM101"]
ROBOT_TYPE_MAP = {"SO-ARM101": "SO-ARM101"}
DEFAULT_PICK_HEIGHT_MM = CONFIG.get(
    "robot", {}).get("default_pick_height_mm", 30)
OFFSET_X = CONFIG.get(
    "robot", {}).get("offset_x", 0)
OFFSET_Y = CONFIG.get(
    "robot", {}).get("offset_y", 0)
OFFSET_Z = CONFIG.get(
    "robot", {}).get("offset_z", 0)
FIXED_WRIST_ROLL = 12


@asynccontextmanager
async def fastapi_lifespan(app: FastAPI):
    global CAMERA_STREAM, CONFIG

    CONFIG.setdefault("robot", {})["type"] = "none"
    save_config("config.yaml", CONFIG)

    initialize_camera()
    initialize_object_detector()
    initialize_openai_client()
    initialize_robot_arm_client()
    asyncio.create_task(frame_updater_task())

    yield

    if CAMERA_STREAM:
        CAMERA_STREAM.stop()
        logger.info("Camera stream stopped")


def initialize_camera():
    """Initialize the RealSense camera stream"""
    global CAMERA_STREAM, CONFIG

    logger.info("Initializing camera stream...")
    try:
        CAMERA_STREAM = create_camera_stream(
            camera_type=CONFIG["camera"]["type"],
            width=CONFIG["camera"]["width"],
            height=CONFIG["camera"]["height"],
            fps=CONFIG["camera"]["fps"],
            color_camera_queue=COLOR_CAMERA_QUEUE,
            depth_camera_queue=DEPTH_CAMERA_QUEUE,
        )
        CAMERA_STREAM.start()
        logger.info("Camera stream initialized successfully")
    except Exception as e:
        logger.error(f"Failed to initialize camera: {e}")
        raise


def stop_camera_stream():
    """Stop the active camera stream if it exists"""
    global CAMERA_STREAM

    if not CAMERA_STREAM:
        return

    logger.info("Stopping camera stream...")
    try:
        CAMERA_STREAM.stop()
        logger.info("Camera stream stopped successfully")
    except Exception as e:
        logger.error(f"Failed to stop camera stream: {e}")
        raise
    finally:
        CAMERA_STREAM = None


def reset_camera_state():
    """Reset camera queues and frame state"""
    global COLOR_CAMERA_QUEUE, DEPTH_CAMERA_QUEUE, CURRENT_FRAME, CURRENT_DEPTH_FRAME, LAST_FRAME_TIMESTAMP

    COLOR_CAMERA_QUEUE = SimpleQueue()
    DEPTH_CAMERA_QUEUE = SimpleQueue()
    with CURRENT_FRAME_LOCK:
        CURRENT_FRAME = None
        CURRENT_DEPTH_FRAME = None
        LAST_FRAME_TIMESTAMP = 0


def initialize_object_detector():
    """Initialize the object detection model"""
    global OBJECT_DETECTOR, CONFIG

    logger.info("Initializing object detector...")
    try:
        OBJECT_DETECTOR = ObjectDetector(
            model_name=CONFIG["fastsam"]["name"],
            device=CONFIG["fastsam"]["device"],
            imgsz=CONFIG["fastsam"]["image_size"],
            img_path=CONFIG["fastsam"]["img_path"],
        )
        logger.info("Object detector initialized successfully")
    except Exception as e:
        logger.error(f"Failed to initialize object detector: {e}")
        raise


def initialize_openai_client():
    """Initialize the OpenAI client"""
    global OPENAI_CLIENT, CONFIG

    logger.info("Initializing OpenAI client...")
    try:
        OPENAI_CLIENT = OpenAIClient(
            api_key=CONFIG["client"]["api_key"], base_url=CONFIG["client"]["base_url"]
        )
        logger.info("OpenAI client initialized successfully")
    except Exception as e:
        logger.error(f"Failed to initialize OpenAI client: {e}")
        raise


def initialize_robot_arm_client():
    """Initialize the Robot Arm client"""
    global ROBOT_ARM_CLIENT, CONFIG

    logger.info("Initializing Robot Arm client...")
    try:
        if CONFIG.get("robot", {}).get("type") == "SO-ARM101":
            ROBOT_ARM_CLIENT = SO101(
                port=CONFIG.get("robot", {}).get("port", "/dev/ttyACM0"),
                gripper_threshold=[
                    CONFIG["robot"]["gripper_open"], CONFIG["robot"]["gripper_close"]],
            )
            logger.info("SO101 robot arm client initialized successfully")
        else:
            ROBOT_ARM_CLIENT = None
            logger.info(
                f"Robotic arm type: {CONFIG.get('robot', {}).get('type')} not supported. Skipping initialization."
            )
    except Exception as e:
        logger.error(f"Failed to initialize Robot Arm client: {e}")
        raise


async def run_blocking(func, *args, **kwargs):
    """Utility to offload blocking / CPU or IO bound calls to a worker thread.

    This prevents blocking the main asyncio event loop which also serves
    the camera streaming endpoint. Any heavy operations (model inference,
    OpenAI API calls, robot arm movement, disk IO) should use this wrapper.
    """
    return await asyncio.to_thread(func, *args, **kwargs)


def calculate_arm_to_obj(
    robot_frame,
    intrinsics,
    centroid,
    centroid_depth,
    text_prompt="detected-object",
    z=None,
):
    base_robot_arm_frame = [0, 0, 0]
    relative_position_to_arm = robot_frame
    base_x_offset = base_robot_arm_frame[0] if len(
        base_robot_arm_frame) >= 1 else 0
    base_y_offset = base_robot_arm_frame[1] if len(
        base_robot_arm_frame) >= 2 else 0
    w, h = intrinsics.width, intrinsics.height
    logger.debug(f"Intrinsic width, height: {w}, {h}")
    object_points = rs.rs2_deproject_pixel_to_point(
        intrinsics, centroid, centroid_depth
    )
    logger.info(f"Deprojection result: {object_points}")

    base_z_offset = base_robot_arm_frame[2] if len(
        base_robot_arm_frame) >= 3 else 0
    robot_z_offset = relative_position_to_arm[2] if len(
        relative_position_to_arm) >= 3 else 0
    robot_x_offset = relative_position_to_arm[0] if len(
        relative_position_to_arm) >= 1 else 0
    robot_y_offset = relative_position_to_arm[1] if len(
        relative_position_to_arm) >= 2 else 0
    obj_final_x = (
        base_x_offset
        + robot_x_offset
        + object_points[1] * 1000
    )
    obj_final_y = (
        base_y_offset
        + robot_y_offset
        - object_points[0] * 1000
    )
    camera_depth_mm = centroid_depth * 1000.0
    point_depth_mm = object_points[2] * \
        1000 if len(object_points) >= 3 else camera_depth_mm
    obj_final_z = base_z_offset + robot_z_offset + point_depth_mm
    if z is None:
        z = obj_final_z if camera_depth_mm > 0 else DEFAULT_PICK_HEIGHT_MM
    object_frame = {
        "x": obj_final_x,
        "y": -obj_final_y,
        "z": z,
    }
    return object_frame


def update_current_frame():
    """Thread-safe function to update the current frame for inference"""
    global CURRENT_FRAME, CURRENT_DEPTH_FRAME, LAST_FRAME_TIMESTAMP

    color_frame = None
    depth_frame = None

    while not COLOR_CAMERA_QUEUE.empty():
        color_frame = COLOR_CAMERA_QUEUE.get()
        if not DEPTH_CAMERA_QUEUE.empty():
            depth_frame = DEPTH_CAMERA_QUEUE.get()

    while not DEPTH_CAMERA_QUEUE.empty():
        depth_frame = DEPTH_CAMERA_QUEUE.get()

    if color_frame is not None:
        with CURRENT_FRAME_LOCK:
            CURRENT_FRAME = color_frame.copy()  # Make a copy to avoid race conditions
            if depth_frame is not None:
                CURRENT_DEPTH_FRAME = depth_frame
            LAST_FRAME_TIMESTAMP = time.time()


def get_current_frame_for_inference():
    """Thread-safe function to get copies of the current color and depth frames"""
    global CURRENT_FRAME_LOCK, CURRENT_FRAME, CURRENT_DEPTH_FRAME, LAST_FRAME_TIMESTAMP
    with CURRENT_FRAME_LOCK:
        if CURRENT_FRAME is not None:
            color_copy = CURRENT_FRAME.copy()
            depth_copy = (
                CURRENT_DEPTH_FRAME if CURRENT_DEPTH_FRAME is not None else None
            )
            return color_copy, depth_copy, LAST_FRAME_TIMESTAMP
        return None, None, 0


async def generate_mjpeg_stream():
    """Generate MJPEG stream data"""
    boundary = "frame"

    while True:
        try:
            # Update current frame for inference (non-blocking)
            update_current_frame()

            # Get frame for streaming using the most recent snapshot
            with CURRENT_FRAME_LOCK:
                color_frame = (
                    CURRENT_FRAME.copy() if CURRENT_FRAME is not None else None
                )

            if color_frame is None:
                # Generate a black placeholder frame with an error message
                h = CONFIG["camera"]["height"]
                w = CONFIG["camera"]["width"]
                placeholder = np.zeros((h, w, 3), dtype=np.uint8)
                msg = "Failed to connect to camera,"
                msg2 = "please check the camera connection."
                font = cv2.FONT_HERSHEY_SIMPLEX
                font_scale = max(0.6, w / 1280)
                thickness = max(1, int(font_scale * 2))
                for i, line in enumerate([msg, msg2]):
                    (tw, th), _ = cv2.getTextSize(
                        line, font, font_scale, thickness)
                    x = (w - tw) // 2
                    y = h // 2 + i * int(th * 2)
                    cv2.putText(placeholder, line, (x, y), font,
                                font_scale, (200, 200, 200), thickness, cv2.LINE_AA)
                _, buffer = cv2.imencode(".jpg", placeholder, [
                                         cv2.IMWRITE_JPEG_QUALITY, 70])
                frame_bytes = buffer.tobytes()
                yield (
                    b"--" + boundary.encode() + b"\r\n"
                    b"Content-Type: image/jpeg\r\n"
                    b"Content-Length: "
                    + str(len(frame_bytes)).encode()
                    + b"\r\n\r\n"
                    + frame_bytes
                    + b"\r\n"
                )
                await asyncio.sleep(1.0 / CONFIG["camera"]["fps"])
                continue

            # Draw a red bounding box with the configured inference bbox if available
            bbox = CONFIG["inference"].get("bbox", [0, 0, 100, 100])
            cv2.rectangle(
                color_frame, (bbox[0], bbox[1]), (bbox[2],
                                                  bbox[3]), (0, 0, 255), 2
            )

            if color_frame is not None:
                # Encode frame as JPEG
                _, buffer = cv2.imencode(
                    ".jpg", color_frame, [cv2.IMWRITE_JPEG_QUALITY, 50]
                )
                frame_bytes = buffer.tobytes()

                # Create MJPEG frame with boundary
                yield (
                    b"--" + boundary.encode() + b"\r\n"
                    b"Content-Type: image/jpeg\r\n"
                    b"Content-Length: "
                    + str(len(frame_bytes)).encode()
                    + b"\r\n\r\n"
                    + frame_bytes
                    + b"\r\n"
                )

            # Control the streaming rate
            await asyncio.sleep(1.0 / CONFIG["camera"]["fps"])

        except Exception as e:
            logger.error(f"Error in MJPEG stream generation: {e}")
            await asyncio.sleep(1)


async def frame_updater_task():
    """Background task to continuously update the current frame"""
    while True:
        try:
            update_current_frame()
            await asyncio.sleep(0.1)  # Update every 100ms
        except Exception as e:
            logger.error(f"Error in frame updater: {e}")
            await asyncio.sleep(1)


async def analyze_object_single(detection_results, requested_object):
    """
    Analyze each detected object individually using OpenAI API.
    """
    global OPENAI_CLIENT, MODEL_ID
    analysis_results = {}
    for i, (key, result) in enumerate(detection_results.items()):
        cropped_bgr = result["image"].copy()
        _, buffer = cv2.imencode(".png", cropped_bgr)
        cropped_b64 = base64.b64encode(buffer).decode("utf-8")
        conversation = [
            {
                "role": "system",
                "content": "You are a helpful and precise assistant. When asked to verify an image, respond concisely and only as instructed. Analyze the color correctly."
            },
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{cropped_b64}"},
                    },
                    {
                        "type": "text",
                        "text": f"Is this a {requested_object}? Reply in one word: Yes or No.",
                    },
                ],
            }
        ]
        response = await run_blocking(
            OPENAI_CLIENT.create_chat_completion,
            model=MODEL_ID,
            messages=conversation,
            stream=False,
            extra_body={"chat_template_kwargs": {"enable_thinking": False}}
        )
        analysis_result = response.choices[0].message.content
        analysis_results[f"object_{i}"] = {
            "result": analysis_result,
            "image": cropped_bgr,
            "box": result["box"],
        }
    return analysis_results


async def analyze_object_batch(detection_results, requested_object, batch_size=8):
    """
    Analyze detected objects in batches (max batch_size).
    """
    global OPENAI_CLIENT, MODEL_ID
    analysis_results = {}
    items = list(detection_results.items())[:batch_size]
    batch_conversations = []
    images = []
    for i, (key, result) in enumerate(items):
        cropped_bgr = result["image"].copy()
        _, buffer = cv2.imencode(".png", cropped_bgr)
        cropped_b64 = base64.b64encode(buffer).decode("utf-8")
        batch_conversations.append({
            "role": "user",
            "content": [
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/jpeg;base64,{cropped_b64}"},
                },
                {
                    "type": "text",
                    "text": f"Is this a {requested_object}? Reply in one word: Yes or No.",
                },
            ],
        })
        images.append(cropped_bgr)

    responses = []
    for idx, conversation in enumerate(batch_conversations):
        response = await run_blocking(
            OPENAI_CLIENT.create_chat_completion,
            model=MODEL_ID,
            messages=[conversation],
            stream=False,
            extra_body={"chat_template_kwargs": {"enable_thinking": False}}
        )
        responses.append(response)
    for i, response in enumerate(responses):
        analysis_result = response.choices[0].message.content
        analysis_results[f"object_{i}"] = {
            "result": analysis_result,
            "image": images[i],
            "box": items[i][1]["box"],
            "mask": items[i][1].get("mask"),
        }
    return analysis_results


mcp = FastMCP("Robotics-MCP-Server")
mcp_app = mcp.http_app(path="/mcp")


@asynccontextmanager
async def combined_lifespan(app: FastAPI):
    async with fastapi_lifespan(app):
        async with mcp_app.lifespan(mcp_app):
            yield

allowed_cors = json.loads(
    os.getenv("ALLOWED_CORS", '["http://localhost", "http://127.0.0.1"]'))
app = FastAPI(
    title="Robotics-API-Server",
    version="1.0.0",
    lifespan=combined_lifespan
)
app.mount("/apps", mcp_app)
app.mount("/assets", StaticFiles(directory=ASSETS_DIR), name="assets")
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_cors,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/healthcheck")
async def healthcheck():
    return {"status": True}


@app.post("/api/mcp/connect")
async def mcp_connect():
    """Connect to the MCP server and return available tools."""
    try:
        tools = await mcp._list_tools()
        tools_payload = [
            {
                "id": t.name,
                "name": t.name,
                "description": t.description or "",
            }
            for t in tools
        ]
        return {"message": "Connected to MCP server", "tools": tools_payload}
    except Exception as exc:
        logger.exception("Failed to list MCP tools")
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/mcp/agent")
async def mcp_agent(request: Request):
    """Run the MCP agent with the provided conversation."""
    global OPENAI_CLIENT, MODEL_ID

    body = await request.json()
    messages = body.get("messages", [])
    tool_id: str | None = body.get("toolId") or None
    use_mcp: bool = body.get("useMcp", True)
    language: str = body.get("language", "english")

    if not messages:
        raise HTTPException(status_code=400, detail="No messages provided")

    color_frame, _, _ = get_current_frame_for_inference()
    image_content: list[dict] = []
    if color_frame is not None:
        _, buffer = cv2.imencode(".jpg", color_frame, [
                                 cv2.IMWRITE_JPEG_QUALITY, 70])
        frame_b64 = base64.b64encode(buffer).decode("utf-8")
        image_content = [
            {
                "type": "image_url",
                "image_url": {"url": f"data:image/jpeg;base64,{frame_b64}"},
            }
        ]

    # Build the conversation for the LLM, injecting the live camera frame into
    # the last user message so the model has visual context.
    llm_messages: list[dict] = []
    for i, msg in enumerate(messages):
        role = msg.get("role", "user")
        content = msg.get("content", "")
        if role == "user" and i == len(messages) - 1 and image_content:
            llm_messages.append(
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": content},
                        *image_content,
                    ],
                }
            )
        else:
            llm_messages.append({"role": role, "content": content})

    try:
        if use_mcp:
            # Use MCP tool calling flow via the FastMCP client
            available_tools = await mcp._list_tools()
            if tool_id:
                available_tools = [
                    t for t in available_tools if t.name == tool_id]

            tools_spec = [
                {
                    "type": "function",
                    "function": {
                        "name": t.name,
                        "description": t.description or "",
                        "parameters": t.input_schema if hasattr(t, "input_schema") else {},
                    },
                }
                for t in available_tools
            ]

            response = await run_blocking(
                OPENAI_CLIENT.create_chat_completion,
                model=MODEL_ID,
                messages=llm_messages,
                stream=False,
                tools=tools_spec if tools_spec else None,
            )

            choice = response.choices[0]
            # If the model wants to call a tool, execute it and get the final answer
            if choice.finish_reason == "tool_calls" and choice.message.tool_calls:
                tool_results = []
                for tc in choice.message.tool_calls:
                    fn_name = tc.function.name
                    try:
                        fn_args = json.loads(tc.function.arguments or "{}")
                    except json.JSONDecodeError:
                        fn_args = {}
                    logger.info(
                        f"Calling MCP tool: {fn_name} with args: {fn_args}")
                    tool_result = await mcp._call_tool(fn_name, fn_args)
                    result_text = tool_result.content[0].text if tool_result.content else ""
                    tool_results.append(
                        {
                            "tool_call_id": tc.id,
                            "role": "tool",
                            "name": fn_name,
                            "content": result_text,
                        }
                    )

                follow_up_messages = [
                    *llm_messages,
                    choice.message,
                    *tool_results,
                ]
                final_response = await run_blocking(
                    OPENAI_CLIENT.create_chat_completion,
                    model=MODEL_ID,
                    messages=follow_up_messages,
                    stream=False,
                )
                output = final_response.choices[0].message.content or ""
            else:
                output = choice.message.content or ""
        else:
            response = await run_blocking(
                OPENAI_CLIENT.create_chat_completion,
                model=MODEL_ID,
                messages=llm_messages,
                stream=False,
            )
            output = response.choices[0].message.content or ""

        return {"output": output}
    except Exception as exc:
        logger.exception("Agent request failed")
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/camera/status")
async def get_camera_status():
    """Return whether the camera is producing live frames."""
    _, _, last_ts = get_current_frame_for_inference()
    is_live = last_ts > 0 and (time.time() - last_ts) < 5.0
    return {"ready": is_live}


@app.get("/snapshot")
async def get_snapshot():
    """Return the current camera frame as a single JPEG image."""
    from fastapi.responses import Response as FastAPIResponse
    color_frame, _, _ = get_current_frame_for_inference()
    if color_frame is None:
        raise HTTPException(
            status_code=503, detail="No camera frame available")
    _, buffer = cv2.imencode(".jpg", color_frame, [
                             cv2.IMWRITE_JPEG_QUALITY, 70])
    return FastAPIResponse(content=buffer.tobytes(), media_type="image/jpeg")


@app.get("/client/config")
async def get_client_config():
    """Return the OpenAI-compatible client configuration for external consumers."""
    return {
        "base_url": CONFIG["client"]["base_url"],
        "model_id": CONFIG["client"]["model_id"],
    }


@app.post("/camera/reload")
async def reload_camera():
    try:
        stop_camera_stream()
        reset_camera_state()
        initialize_camera()
    except Exception as exc:
        logger.exception("Failed to reload camera")
        raise HTTPException(
            status_code=500, detail="Failed to reload camera")

    return {"status": True, "message": "Camera reloaded successfully"}


@app.get("/stream/camera")
async def get_camera_frame(request: Request):
    async def mjpeg_stream():
        try:
            async for frame_data in generate_mjpeg_stream():
                # Check if client is still connected
                if await request.is_disconnected():
                    logger.info("Client disconnected from camera stream")
                    break
                yield frame_data

        except Exception as e:
            logger.error(f"Error in camera stream endpoint: {e}")
            return

    return StreamingResponse(
        mjpeg_stream(),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Access-Control-Allow-Origin": "*",
            "Pragma": "no-cache",
        },
    )


@app.get("/inference/scene_description")
async def get_scene_description():
    global OBJECT_DETECTOR, OPENAI_CLIENT, MODEL_ID

    color_frame, depth_frame, _ = get_current_frame_for_inference()
    if color_frame is None:
        raise HTTPException(
            status_code=503, detail="No camera frame available")
    _, buffer = cv2.imencode(".png", color_frame)
    color_frame_b64 = base64.b64encode(buffer).decode("utf-8")

    conversation = [
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": "Describe the overall scene in this image.",
                },
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/jpeg;base64,{color_frame_b64}"},
                },
            ],
        }
    ]

    response = OPENAI_CLIENT.create_chat_completion(
        model=MODEL_ID, messages=conversation, stream=False
    )
    scene_description = response.choices[0].message.content

    logger.info(f"Scene description response: {scene_description}")
    return scene_description


@app.get("/robot/types")
async def get_robot_types():
    """Return the list of supported robot types."""
    return {"types": AVAILABLE_ROBOT_TYPES}


@app.get("/robot/type")
async def get_robot_type():
    """Return the currently configured robot type."""
    current = CONFIG.get("robot", {}).get("type", None)
    # Map internal key back to display name
    reverse_map = {v: k for k, v in ROBOT_TYPE_MAP.items()}
    display = reverse_map.get(current, current)
    return {"type": display}


@app.post("/robot/type")
async def set_robot_type(body: dict):
    """Set the robot type and reinitialize the robot arm client."""
    global ROBOT_ARM_CLIENT, CONFIG

    requested = body.get("type")
    if requested not in AVAILABLE_ROBOT_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported robot type '{requested}'. Available types: {AVAILABLE_ROBOT_TYPES}",
        )

    internal_type = ROBOT_TYPE_MAP[requested]
    CONFIG.setdefault("robot", {})["type"] = internal_type
    await run_blocking(save_config, "config.yaml", CONFIG)

    if ROBOT_ARM_CLIENT is not None:
        try:
            await run_blocking(ROBOT_ARM_CLIENT.disconnect)
        except Exception as exc:
            logger.warning(
                f"Could not disconnect robot arm before type change: {exc}")
        ROBOT_ARM_CLIENT = None

    try:
        initialize_robot_arm_client()
    except Exception as exc:
        logger.warning(
            f"Robot arm initialization failed after type change (hardware may not be connected): {exc}"
        )
        ROBOT_ARM_CLIENT = None

    return {"status": True, "type": requested, "message": f"Robot type set to '{requested}'"}


@app.get("/robot/calibrate/status")
async def get_calibration_status():
    """Return the current calibration state."""
    return {"state": CALIBRATION_STATE}


@app.post("/robot/calibrate/start")
async def start_calibration():
    """Phase 1: move the arm to the pick calibration position using offsets from config.

    After calling this endpoint the operator should visually verify that the arm
    is positioned correctly above the target pick location, then call
    POST /robot/calibrate/confirm to complete the calibration sequence.
    """
    global CALIBRATION_STATE, ROBOT_ARM_CLIENT, CONFIG

    if ROBOT_ARM_CLIENT is None:
        raise HTTPException(
            status_code=503, detail="Robot arm is not connected")

    if CALIBRATION_STATE != "idle":
        raise HTTPException(
            status_code=409,
            detail=f"Calibration already in progress (state: '{CALIBRATION_STATE}'). "
            "Call POST /robot/calibrate/confirm to finish or reset the state.",
        )

    offset_x = CONFIG.get("robot", {}).get("offset_x", 0)
    offset_y = CONFIG.get("robot", {}).get("offset_y", 0)
    offset_z = CONFIG.get("robot", {}).get("offset_z", 0)

    try:
        await run_blocking(ROBOT_ARM_CLIENT.calibrate_start, offset_x, offset_y, offset_z)
    except Exception as exc:
        logger.exception("Calibration start failed")
        raise HTTPException(status_code=500, detail=str(exc))

    CALIBRATION_STATE = "awaiting_confirmation"
    return {
        "status": True,
        "state": CALIBRATION_STATE,
        "message": "Arm moved to pick calibration position. "
                   "Verify alignment, then call POST /robot/calibrate/confirm to complete.",
    }


@app.post("/robot/calibrate/confirm")
async def confirm_calibration():
    """Phase 2: confirm the pick position and cycle through the container pose.

    Equivalent to pressing 'q' in the original calibrate-arm.py script.
    """
    global CALIBRATION_STATE, ROBOT_ARM_CLIENT

    if ROBOT_ARM_CLIENT is None:
        raise HTTPException(
            status_code=503, detail="Robot arm is not connected")

    if CALIBRATION_STATE != "awaiting_confirmation":
        raise HTTPException(
            status_code=409,
            detail=f"No calibration in progress (state: '{CALIBRATION_STATE}'). "
            "Call POST /robot/calibrate/start first.",
        )

    try:
        await run_blocking(ROBOT_ARM_CLIENT.calibrate_confirm)
    except Exception as exc:
        logger.exception("Calibration confirm failed")
        CALIBRATION_STATE = "idle"
        raise HTTPException(status_code=500, detail=str(exc))

    CALIBRATION_STATE = "idle"
    return {
        "status": True,
        "state": CALIBRATION_STATE,
        "message": "Calibration complete. Arm cycled through container pose and returned home.",
    }


@app.get("/robot/gripper-config")
async def get_gripper_config():
    """Return the current gripper open/close thresholds from config."""
    robot_cfg = CONFIG.get("robot", {})
    return {
        "gripper_open": robot_cfg.get("gripper_open", 60),
        "gripper_close": robot_cfg.get("gripper_close", 40),
    }


@app.post("/robot/gripper-config")
async def set_gripper_config(body: dict):
    """Persist updated gripper open/close thresholds to config.yaml and
    reinitialize the robot arm client so the new values take effect immediately.
    """
    global CONFIG, ROBOT_ARM_CLIENT

    gripper_open = body.get("gripper_open")
    gripper_close = body.get("gripper_close")

    if gripper_open is None or gripper_close is None:
        raise HTTPException(
            status_code=400,
            detail="Both 'gripper_open' and 'gripper_close' values are required.",
        )

    try:
        gripper_open = float(gripper_open)
        gripper_close = float(gripper_close)
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=400, detail="Gripper values must be numbers."
        ) from exc

    CONFIG.setdefault("robot", {})["gripper_open"] = gripper_open
    CONFIG["robot"]["gripper_close"] = gripper_close

    try:
        await run_blocking(save_config, "config.yaml", CONFIG)
    except Exception as exc:
        logger.exception("Failed to save config")
        raise HTTPException(status_code=500, detail=str(exc))

    # Reinitialize the arm client so the new thresholds are applied immediately
    if ROBOT_ARM_CLIENT is not None:
        try:
            await run_blocking(ROBOT_ARM_CLIENT.disconnect)
        except Exception as exc:
            logger.warning(f"Could not disconnect arm before reinit: {exc}")
        ROBOT_ARM_CLIENT = None

    try:
        initialize_robot_arm_client()
    except Exception as exc:
        logger.warning(
            f"Robot arm reinit after gripper config change failed: {exc}")
        ROBOT_ARM_CLIENT = None

    return {
        "status": True,
        "gripper_open": gripper_open,
        "gripper_close": gripper_close,
        "message": "Gripper configuration saved and robot arm reinitialized.",
    }


# ── ArUco camera calibration ──────────────────────────────────────

ARUCO_ALIGN_TOLERANCE_PX = 15


def _detect_aruco_bbox(color_frame: np.ndarray):
    """Detect ArUco markers 0 and 1 (DICT_4X4_50) and compute the inference
    bounding box as 80 % of the rectangle spanned by both markers.

    Returns a dict with keys: detected (bool), bbox (list|None),
    marker0_center (list|None), marker1_center (list|None),
    centroid (list|None), frame_center (list), aligned (bool|None),
    offset_x (int|None), offset_y (int|None), message (str).
    """
    frame_h, frame_w = color_frame.shape[:2]
    frame_cx = frame_w // 2
    frame_cy = frame_h // 2

    aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
    detector = cv2.aruco.ArucoDetector(
        aruco_dict, cv2.aruco.DetectorParameters()
    )
    corners, ids, _ = detector.detectMarkers(color_frame)

    base = {
        "frame_center": [frame_cx, frame_cy],
        "centroid": None,
        "aligned": None,
        "offset_x": None,
        "offset_y": None,
    }

    if ids is None:
        return {**base, "detected": False, "bbox": None,
                "marker0_center": None, "marker1_center": None,
                "message": "No ArUco markers detected in the current frame."}

    id_map = {
        int(id_val[0]): corner.reshape(-1, 2)
        for corner, id_val in zip(corners, ids)
    }

    if 0 not in id_map or 1 not in id_map:
        found = sorted(id_map.keys())
        return {**base, "detected": False, "bbox": None,
                "marker0_center": None, "marker1_center": None,
                "message": f"Need markers 0 and 1; found: {found}."}

    def _center(pts):
        return pts.mean(axis=0).tolist()

    board_corners = np.vstack((id_map[0], id_map[1]))
    x_min = int(np.min(board_corners[:, 0]))
    y_min = int(np.min(board_corners[:, 1]))
    x_max = int(np.max(board_corners[:, 0]))
    y_max = int(np.max(board_corners[:, 1]))

    cx = (x_min + x_max) // 2
    cy = (y_min + y_max) // 2
    new_w = int((x_max - x_min) * 0.8)
    new_h = int((y_max - y_min) * 0.8)

    bbox = [
        cx - new_w // 2,
        cy - new_h // 2,
        cx + new_w // 2,
        cy + new_h // 2,
    ]

    offset_x = cx - frame_cx
    offset_y = cy - frame_cy
    aligned = (
        abs(offset_x) <= ARUCO_ALIGN_TOLERANCE_PX
        and abs(offset_y) <= ARUCO_ALIGN_TOLERANCE_PX
    )

    return {
        "detected": True,
        "bbox": bbox,
        "marker0_center": _center(id_map[0]),
        "marker1_center": _center(id_map[1]),
        "centroid": [cx, cy],
        "frame_center": [frame_cx, frame_cy],
        "aligned": aligned,
        "offset_x": offset_x,
        "offset_y": offset_y,
        "message": "ArUco markers 0 and 1 detected successfully.",
    }


@app.get("/camera/aruco-detect")
async def aruco_detect():
    """Detect ArUco markers in the current camera frame and return the
    computed bounding box without persisting anything.
    """
    color_frame, _, _ = get_current_frame_for_inference()
    if color_frame is None:
        raise HTTPException(
            status_code=503, detail="No camera frame available.")

    result = await run_blocking(_detect_aruco_bbox, color_frame)
    return result


@app.post("/camera/aruco-calibrate")
async def aruco_calibrate():
    """Detect ArUco markers 0 and 1 and save the computed bounding box to
    config.yaml as ``inference.bbox``.
    """
    global CONFIG

    color_frame, _, _ = get_current_frame_for_inference()
    if color_frame is None:
        raise HTTPException(
            status_code=503, detail="No camera frame available.")

    result = await run_blocking(_detect_aruco_bbox, color_frame)

    if not result["detected"]:
        raise HTTPException(status_code=422, detail=result["message"])

    CONFIG.setdefault("inference", {})["bbox"] = result["bbox"]
    try:
        await run_blocking(save_config, "config.yaml", CONFIG)
    except Exception as exc:
        logger.exception("Failed to save config after ArUco calibration")
        raise HTTPException(status_code=500, detail=str(exc))

    return {
        "status": True,
        "bbox": result["bbox"],
        "marker0_center": result["marker0_center"],
        "marker1_center": result["marker1_center"],
        "message": f"Bounding box saved: {result['bbox']}",
    }


# ── Motor calibration (lerobot) ───────────────────────────────────

_MOTOR_CALIBRATION_OUTPUT_MAX = 100  # maximum lines kept in memory


def _read_motor_calibration_output(proc: subprocess.Popen) -> None:
    """Background thread: drain subprocess stdout into MOTOR_CALIBRATION_OUTPUT."""
    global MOTOR_CALIBRATION_OUTPUT, MOTOR_CALIBRATION_STATE
    try:
        for raw_line in proc.stdout:  # type: ignore[union-attr]
            line = raw_line.rstrip()
            with MOTOR_CALIBRATION_OUTPUT_LOCK:
                MOTOR_CALIBRATION_OUTPUT.append(line)
                if len(MOTOR_CALIBRATION_OUTPUT) > _MOTOR_CALIBRATION_OUTPUT_MAX:
                    del MOTOR_CALIBRATION_OUTPUT[0]
        # Process exited – mark complete or error based on return code
        proc.wait()
        with MOTOR_CALIBRATION_OUTPUT_LOCK:
            if MOTOR_CALIBRATION_STATE not in ("idle", "complete"):
                MOTOR_CALIBRATION_STATE = (
                    "complete" if proc.returncode == 0 else "error"
                )
    except Exception as exc:
        logger.warning(f"Motor calibration output reader error: {exc}")


@app.get("/robot/motor-calibrate/status")
async def get_motor_calibration_status():
    """Return the current motor calibration state and the last 20 output lines."""
    with MOTOR_CALIBRATION_OUTPUT_LOCK:
        output = MOTOR_CALIBRATION_OUTPUT[-20:]
        state = MOTOR_CALIBRATION_STATE
    return {"state": state, "output": output}


@app.post("/robot/motor-calibrate/start")
async def start_motor_calibration():
    """Start the lerobot motor-calibration process.

    The robot arm client will be disconnected before calibration so that the
    serial port is free. After calibration completes and the arm is
    reconnected via POST /robot/type, the arm will resume normally.

    Phase sequence:
      0. Call this endpoint – the process starts and asks whether to use an
         existing calibration file or run a new calibration.
      1. Call POST /robot/motor-calibrate/next with choice="use_existing" to
         write the existing calibration file (no physical movement required),
         or choice="run" to proceed with a full calibration.
      2. (run only) Call POST /robot/motor-calibrate/next after positioning all
         joints at the midpoint of their range.
      3. (run only) Call POST /robot/motor-calibrate/next again after sweeping
         each joint through its full range to finish calibration.
    """
    global MOTOR_CALIBRATION_STATE, MOTOR_CALIBRATION_PROCESS, MOTOR_CALIBRATION_OUTPUT, ROBOT_ARM_CLIENT, CONFIG

    if MOTOR_CALIBRATION_STATE in ("awaiting_calibration_choice", "awaiting_middle_position", "awaiting_range_motion"):
        raise HTTPException(
            status_code=409,
            detail=f"Motor calibration already in progress (state: '{MOTOR_CALIBRATION_STATE}'). "
            "Call POST /robot/motor-calibrate/next to advance.",
        )

    # Release the serial port so lerobot-calibrate can open it
    if ROBOT_ARM_CLIENT is not None:
        try:
            await run_blocking(ROBOT_ARM_CLIENT.disconnect)
        except Exception as exc:
            logger.warning(f"Could not gracefully disconnect robot arm: {exc}")
        ROBOT_ARM_CLIENT = None

    # Terminate any leftover process and wait for it to release the serial port
    if MOTOR_CALIBRATION_PROCESS and MOTOR_CALIBRATION_PROCESS.poll() is None:
        MOTOR_CALIBRATION_PROCESS.terminate()
        try:
            MOTOR_CALIBRATION_PROCESS.wait(timeout=5)
        except subprocess.TimeoutExpired:
            MOTOR_CALIBRATION_PROCESS.kill()
            MOTOR_CALIBRATION_PROCESS.wait()

    port = CONFIG.get("robot", {}).get("port", "/dev/ttyACM0")
    robot_id = CONFIG.get("robot", {}).get("id", "SO101Follower")

    with MOTOR_CALIBRATION_OUTPUT_LOCK:
        MOTOR_CALIBRATION_OUTPUT = []

    try:
        proc = subprocess.Popen(
            [
                "lerobot-calibrate",
                "--robot.type=so101_follower",
                f"--robot.port={port}",
                f"--robot.id={robot_id}",
            ],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=500,
            detail="lerobot-calibrate not found. Ensure the worker venv is active.",
        ) from exc

    MOTOR_CALIBRATION_PROCESS = proc
    MOTOR_CALIBRATION_STATE = "awaiting_calibration_choice"

    threading.Thread(
        target=_read_motor_calibration_output,
        args=(proc,),
        daemon=True,
    ).start()

    return {
        "status": True,
        "state": MOTOR_CALIBRATION_STATE,
        "message": "Motor calibration started. Choose whether to use the existing "
                   "calibration file or run a new calibration.",
    }


@app.post("/robot/motor-calibrate/next")
async def next_motor_calibration_step(request: Request):
    """Advance the motor calibration by sending input to the running process.

    When state is ``awaiting_calibration_choice``:
      - Pass ``{"choice": "use_existing"}`` (or omit the body) to write the
        existing calibration file and complete immediately.
      - Pass ``{"choice": "run"}`` to start a fresh calibration, transitioning
        to the ``awaiting_middle_position`` phase.

    When state is ``awaiting_middle_position``:
      - Call with no body (or any body) to confirm the mid-range position and
        transition to ``awaiting_range_motion``.

    When state is ``awaiting_range_motion``:
      - Call with no body (or any body) to confirm the full range sweep and
        finish calibration.
    """
    global MOTOR_CALIBRATION_STATE, MOTOR_CALIBRATION_PROCESS

    if MOTOR_CALIBRATION_STATE not in (
        "awaiting_calibration_choice",
        "awaiting_middle_position",
        "awaiting_range_motion",
    ):
        raise HTTPException(
            status_code=409,
            detail=f"No motor calibration in progress (state: '{MOTOR_CALIBRATION_STATE}'). "
            "Call POST /robot/motor-calibrate/start first.",
        )

    if MOTOR_CALIBRATION_PROCESS is None or MOTOR_CALIBRATION_PROCESS.poll() is not None:
        MOTOR_CALIBRATION_STATE = "error"
        raise HTTPException(
            status_code=500,
            detail="Calibration process is no longer running.",
        )

    body: dict = {}
    try:
        body = await request.json()
    except Exception:
        pass

    if MOTOR_CALIBRATION_STATE == "awaiting_calibration_choice":
        choice = body.get("choice", "use_existing")
        if choice == "run":
            # Type 'c' + Enter to start a new calibration
            try:
                MOTOR_CALIBRATION_PROCESS.stdin.write(
                    "c\n")  # type: ignore[union-attr]
                # type: ignore[union-attr]
                MOTOR_CALIBRATION_PROCESS.stdin.flush()
            except Exception as exc:
                MOTOR_CALIBRATION_STATE = "error"
                raise HTTPException(status_code=500, detail=str(exc)) from exc
            MOTOR_CALIBRATION_STATE = "awaiting_middle_position"
            message = (
                "Running new calibration. Move all joints to the "
                "middle of their range, then click Confirm."
            )
        else:
            # Press Enter to use the existing calibration file
            try:
                MOTOR_CALIBRATION_PROCESS.stdin.write(
                    "\n")  # type: ignore[union-attr]
                # type: ignore[union-attr]
                MOTOR_CALIBRATION_PROCESS.stdin.flush()
            except Exception as exc:
                MOTOR_CALIBRATION_STATE = "error"
                raise HTTPException(status_code=500, detail=str(exc)) from exc
            # Wait for the process to finish writing calibration and disconnecting
            try:
                await run_blocking(MOTOR_CALIBRATION_PROCESS.wait, timeout=15)
            except Exception:
                pass
            MOTOR_CALIBRATION_STATE = "complete"
            # Reconnect the robot arm now that the serial port is free again
            try:
                initialize_robot_arm_client()
                logger.info(
                    "Robot arm reconnected after using existing calibration.")
            except Exception as exc:
                logger.warning(
                    f"Robot arm reconnection after calibration failed: {exc}")
            message = (
                "Existing calibration file applied. "
                "Robot arm reconnected automatically."
            )
    elif MOTOR_CALIBRATION_STATE == "awaiting_middle_position":
        try:
            MOTOR_CALIBRATION_PROCESS.stdin.write(
                "\n")  # type: ignore[union-attr]
            MOTOR_CALIBRATION_PROCESS.stdin.flush()  # type: ignore[union-attr]
        except Exception as exc:
            MOTOR_CALIBRATION_STATE = "error"
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        MOTOR_CALIBRATION_STATE = "awaiting_range_motion"
        message = (
            "Middle position confirmed. Now move each joint slowly through its "
            "full range of motion, then call POST /robot/motor-calibrate/next again."
        )
    else:  # awaiting_range_motion
        try:
            MOTOR_CALIBRATION_PROCESS.stdin.write(
                "\n")  # type: ignore[union-attr]
            MOTOR_CALIBRATION_PROCESS.stdin.flush()  # type: ignore[union-attr]
        except Exception as exc:
            MOTOR_CALIBRATION_STATE = "error"
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        MOTOR_CALIBRATION_STATE = "complete"
        # Wait briefly for the process to finish writing calibration files
        try:
            await run_blocking(MOTOR_CALIBRATION_PROCESS.wait, timeout=10)
        except Exception:
            pass
        # Reconnect the robot arm now that the serial port is free again
        try:
            initialize_robot_arm_client()
            logger.info("Robot arm reconnected after motor calibration.")
        except Exception as exc:
            logger.warning(
                f"Robot arm reconnection after calibration failed: {exc}")
        message = (
            "Range of motion confirmed. Calibration files written and "
            "robot arm reconnected automatically."
        )

    return {"status": True, "state": MOTOR_CALIBRATION_STATE, "message": message}


@mcp.tool
async def pickup_object(requested_object: str, ctx: Context) -> str:
    """
    Detect, analyze, and pickup a specified object in the current camera frame.
    """
    global OBJECT_DETECTOR, OPENAI_CLIENT, ROBOT_ARM_CLIENT, MODEL_ID, OFFSET_X, OFFSET_Y, OFFSET_Z, FIXED_WRIST_ROLL

    color_frame, depth_frame, _ = get_current_frame_for_inference()
    if color_frame is None:
        return (
            "No frame available for inference; please ensure the camera is streaming."
        )
    # Offload model inference to a thread to avoid blocking the event loop
    st = time.time()
    detection_results = await run_blocking(
        OBJECT_DETECTOR.inference_with_bboxes,
        source=color_frame,
        bboxes=[CONFIG["inference"]["bbox"]],
        debug=False,
    )
    logger.info(
        f"Object segmentation and filtering time(secs): {time.time() - st:.2f}")

    st = time.time()
    # analysis_results = await analyze_object_single(detection_results, requested_object)
    analysis_results = await analyze_object_batch(detection_results, requested_object, batch_size=8)
    logger.info(f"Object analysis time(secs): {time.time() - st:.2f}")

    # return a string for the object that is confirmed as Yes
    for obj_id, result in analysis_results.items():
        if "yes" in result["result"].lower():
            requested_object = requested_object.replace(" ", "_")
            filename = f"{requested_object}_{int(time.time()*1000)}.jpg"
            file_path = ASSETS_DIR / filename
            # Disk IO offloaded
            await run_blocking(cv2.imwrite, str(file_path), result["image"])
            asset_url = f"http://localhost:{SERVER_PORT}/assets/{filename}"
            logger.info(
                f"Picking up {requested_object} with id {obj_id}, asset at {asset_url}"
            )
            print("BBox: ", result["box"])
            obj_xmin, obj_ymin, obj_xmax, obj_ymax = map(
                int, result["box"])

            # Default fallback to bbox center
            cx = int((obj_xmin + obj_xmax) / 2)
            cy = int((obj_ymin + obj_ymax) / 2)

            # Use mask centroid if available for better accuracy
            mask = result.get("mask")
            valid_mask_centroid = False

            if mask is not None:
                try:
                    # Ensure mask is numpy array
                    if hasattr(mask, 'cpu'):
                        mask = mask.cpu().numpy()
                    if mask.dtype != np.uint8:
                        mask = (mask * 255).astype(np.uint8)

                    if np.any(mask):
                        M = cv2.moments(mask)
                        if M["m00"] != 0:
                            cx = int(M["m10"] / M["m00"])
                            cy = int(M["m01"] / M["m00"])
                            valid_mask_centroid = True
                            logger.info(f"Using mask centroid: {cx}, {cy}")
                except Exception as e:
                    logger.warning(
                        f"Failed to calculate mask moments: {e}")

            # Calculate depth - use median of mask if available, else center point
            depth = 0.0
            if valid_mask_centroid and mask is not None:
                try:
                    # Convert depth frame to numpy array
                    depth_image = np.asanyarray(depth_frame.get_data())

                    if mask.shape == depth_image.shape:
                        masked_depth = depth_image[mask > 0]
                        valid_depths = masked_depth[masked_depth > 0]

                        if valid_depths.size > 0:
                            depth_mm = np.median(valid_depths)
                            depth = depth_mm / 1000.0
                            logger.info(
                                f"Using median depth from mask: {depth:.4f}m")
                        else:
                            depth = depth_frame.get_distance(cx, cy)
                    else:
                        logger.warning(
                            f"Mask shape {mask.shape} != Depth shape {depth_image.shape}")
                        depth = depth_frame.get_distance(cx, cy)
                except Exception as e:
                    logger.error(
                        f"Error calculating mask median depth: {e}")
                    depth = depth_frame.get_distance(cx, cy)
            else:
                depth = depth_frame.get_distance(cx, cy)

            object_pose = calculate_arm_to_obj(
                ROBOT_FRAME,
                CAMERA_STREAM.depth_intrinsics,
                [cx, cy],
                depth,
            )
            if not object_pose:
                return f"Unable to get the location of {requested_object}. Please try again."

            logger.info(
                f"Object pose for {requested_object}: {object_pose}")
            if not ROBOT_ARM_CLIENT:
                return "Robot arm client is not online. Please check the connection. Retry again after verifying the connection."

            # Translate object pose with offsets to arm
            offset_x = CONFIG["robot"]["offset_x"]/1000.0
            offset_y = CONFIG["robot"]["offset_y"]/1000.0
            offset_z = CONFIG["robot"]["offset_z"]/1000.0

            target_pose_x = -object_pose['x']/1000.0
            target_pose_y = -object_pose['y']/1000.0
            target_pose_z = object_pose['z']/1000.0

            logger.info(
                f"Translated target_pose_x: {target_pose_x}, target_pose_y: {target_pose_y}")

            if target_pose_y > 0:
                fixed_wrist_roll = -FIXED_WRIST_ROLL
            else:
                fixed_wrist_roll = FIXED_WRIST_ROLL
                offset_y = abs(offset_y)

            async with ROBOT_ARM_LOCK:
                await run_blocking(ROBOT_ARM_CLIENT._reset_home_position)

                T_current = await run_blocking(ROBOT_ARM_CLIENT.arm.get_current_ee_pose)
                current_pos = T_current[:3, 3]
                target_x = current_pos[0] + offset_x
                target_y = current_pos[1] + offset_y
                target_z = current_pos[2]

                # Move to ready pose
                await run_blocking(ROBOT_ARM_CLIENT.move_to_coordinate, target_x, target_y, target_z)
                await run_blocking(ROBOT_ARM_CLIENT.set_gripper_state, open=True)

                # Move to object pose
                T_current = await run_blocking(ROBOT_ARM_CLIENT.arm.get_current_ee_pose)
                current_pos = T_current[:3, 3]
                target_x = current_pos[0] + (target_pose_x) - 0.03
                target_y = current_pos[1] + (target_pose_y)
                target_z = current_pos[2]
                await run_blocking(ROBOT_ARM_CLIENT.move_to_coordinate, target_x, target_y, target_z, fixed_wrist_roll)

                # Move down to pick height
                T_current = await run_blocking(ROBOT_ARM_CLIENT.arm.get_current_ee_pose)
                current_pos = T_current[:3, 3]
                target_x = current_pos[0]
                target_y = current_pos[1]
                target_z = offset_z
                await run_blocking(ROBOT_ARM_CLIENT.move_to_coordinate, target_x, target_y, target_z, fixed_wrist_roll)

                # Close gripper to pick object
                await run_blocking(ROBOT_ARM_CLIENT.set_gripper_state, open=False)

                # Move to container position
                await run_blocking(ROBOT_ARM_CLIENT.move_to_joint_pose, "home")
                await run_blocking(ROBOT_ARM_CLIENT.move_to_joint_pose, "container")

                # Drop the payload
                await run_blocking(ROBOT_ARM_CLIENT.set_gripper_state, open=True)
                await run_blocking(ROBOT_ARM_CLIENT.set_gripper_state, open=False)
                await run_blocking(ROBOT_ARM_CLIENT.move_to_joint_pose, "home")
            return f"Picked up {requested_object} ({obj_id}) successfully.\n\n![{requested_object}]({asset_url})"
        else:
            continue

    return f"No {requested_object} found to pick up."


@mcp.tool
async def describe_scene(ctx: Context) -> str:
    """
    Analyze the current camera frame and provide a description of the scene.
    """
    global OPENAI_CLIENT, MODEL_ID

    color_frame, depth_frame, _ = get_current_frame_for_inference()
    if color_frame is None:
        return (
            "No frame available for inference; please ensure the camera is streaming."
        )
    _, buffer = cv2.imencode(".png", color_frame)
    color_frame_b64 = base64.b64encode(buffer).decode("utf-8")

    conversation = [
        {
            "role": "user",
            "content": [
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/jpeg;base64,{color_frame_b64}"},
                },
                {
                    "type": "text",
                    "text": "Describe the overall scene in this image.",
                },
            ],
        }
    ]

    response = await run_blocking(
        OPENAI_CLIENT.create_chat_completion,
        model=MODEL_ID,
        messages=conversation,
        stream=False,
    )
    scene_description = response.choices[0].message.content

    logger.info(f"Scene description response: {scene_description}")
    return scene_description


def parse_args():
    parser = argparse.ArgumentParser(
        description="Synthetic Image Generation FastAPI Server"
    )
    parser.add_argument(
        "--host",
        type=str,
        default="127.0.0.1",
        help="Host for the FastAPI server to listen on",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=DEFAULT_PORT,
        help="Port for the FastAPI server to listen on",
    )
    return parser.parse_args()


def main():
    global app, SERVER_HOST, SERVER_PORT
    args = parse_args()
    SERVER_HOST = args.host
    SERVER_PORT = args.port
    multiprocessing.freeze_support()
    uvicorn.run(
        app,
        host=args.host,
        port=args.port,
        log_level="info",
    )
    return 0


if __name__ == "__main__":
    main()
