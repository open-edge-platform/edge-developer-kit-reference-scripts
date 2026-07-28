# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import asyncio
import os
import base64
import time
import uvicorn
import argparse
from pathlib import Path
from typing import Optional
from contextlib import asynccontextmanager
from fastapi.middleware.cors import CORSMiddleware
from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler


# THE ARGUMENT PARSER
def parse_args():
    parser = argparse.ArgumentParser(description="Real-time File Watcher Worker")
    parser.add_argument(
        "--path",
        type=str,
        default="./watched_folder",
        help="The folder path to monitor (default: ./watched_folder)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=8030,
        help="Port for the worker to listen on (default: 8030)",
    )
    return parser.parse_args()


args = parse_args()
WATCH_DIR = Path(args.path).resolve()


# THE FILE WATCHER HANDLER (per-connection)
class ImageWatcherHandler(FileSystemEventHandler):
    def __init__(self, loop, websocket: WebSocket):
        self.loop = loop
        self.websocket = websocket
        self.supported_extensions = (".png", ".jpg", ".jpeg", ".gif", ".webp")

    def on_created(self, event):
        if not event.is_directory and event.src_path.lower().endswith(
            self.supported_extensions
        ):
            # Give the OS a moment to release the file handle (Important for Windows)
            time.sleep(1.0)
            try:
                with open(event.src_path, "rb") as img:
                    encoded = base64.b64encode(img.read()).decode("utf-8")
                    payload = {
                        "filename": os.path.basename(event.src_path),
                        "base64": encoded,
                    }
                    asyncio.run_coroutine_threadsafe(
                        self.websocket.send_json(payload), self.loop
                    )
            except Exception as e:
                print(f"Error reading file: {e}")


# THE LIFESPAN HANDLER
@asynccontextmanager
async def lifespan(app: FastAPI):
    WATCH_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Default watch directory: {WATCH_DIR}")
    yield


# THE APP
app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    path: Optional[str] = Query(default=None),
):
    await websocket.accept()
    watch_dir = Path(path).resolve() if path else WATCH_DIR
    watch_dir.mkdir(parents=True, exist_ok=True)
    print(f"Client connected, watching: {watch_dir}")

    loop = asyncio.get_running_loop()
    handler = ImageWatcherHandler(loop, websocket)
    observer = Observer()
    observer.schedule(handler, str(watch_dir), recursive=False)
    observer.start()

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        observer.stop()
        observer.join()
        print(f"Client disconnected, stopped watching: {watch_dir}")


def main():
    uvicorn.run(
        app,
        host=os.environ.get("SERVER_HOST", "127.0.0.1"),
        port=int(os.environ.get("SERVER_PORT", args.port)),
    )


if __name__ == "__main__":
    main()
