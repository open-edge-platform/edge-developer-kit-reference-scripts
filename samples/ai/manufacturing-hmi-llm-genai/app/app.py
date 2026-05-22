# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0 
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from app.api.endpoints import camera_feed, inference, statistics_analytics
from app.core.globals import camera_feed_controller

app = FastAPI()

app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

app.include_router(camera_feed.router)
app.include_router(inference.router)
app.include_router(statistics_analytics.router)

@app.on_event("shutdown")
def shutdown_event():
    if camera_feed_controller is not None:
        camera_feed_controller.set_stop_trigger()