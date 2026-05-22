# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0 
from time import sleep

import cv2
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from app.core import globals
from app.core.globals import get_camera_controller, templates
from app.models.request_models import FocusAction

router = APIRouter()

@router.get("/")
async def index(request: Request):
    return templates.TemplateResponse("index.html", {
        "request": request,
        "is_inference_in_progress": globals.is_inference_in_progress
    })

@router.get("/video_feed")
async def video_feed():
    camera_feed_controller = get_camera_controller()
    return StreamingResponse(camera_feed_controller.generate_feed(), media_type='multipart/x-mixed-replace; boundary=frame')

@router.get("/video_feed_annotated")
async def video_feed_annotated():
    def generate_annotated_feed():
        while True:
            _, jpeg = cv2.imencode('.jpg', globals.latest_annotated_frame)
            yield (b'--frame\r\nContent-Type: image/jpeg\r\n\r\n' + jpeg.tobytes() + b'\r\n\r\n')
            sleep(1)
    return StreamingResponse(generate_annotated_feed(), media_type='multipart/x-mixed-replace; boundary=frame')

@router.post("/focus")
async def adjust_focus(action: FocusAction):
    if action.action not in ["increase", "decrease"]:
        raise HTTPException(status_code=400, detail="Invalid action")
    camera_feed_controller = get_camera_controller()
    camera_feed_controller.adjust_focus(action.action)
    return {"message": action.action}
