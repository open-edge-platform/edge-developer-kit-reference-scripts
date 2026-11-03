# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import asyncio
import os
import base64
import time
from pathlib import Path
from typing import Optional
from contextlib import asynccontextmanager
from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
from worker_common import base_parser, create_app, instance_data_dir, serve


def parse_args():
    parser = base_parser("Real-time File Watcher Worker", default_port=8030, device=False)
    parser.add_argument(
        "--path",
        type=str,
        default=None,
        help="The folder path to monitor (default: <data dir>/watched_folder)",
    )
    return parser.parse_args()


args = parse_args()
WATCH_DIR = (
    Path(args.path).resolve()
    if args.path
    else instance_data_dir(".", args=args) / "watched_folder"
)


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


@asynccontextmanager
async def lifespan(app: FastAPI):
    WATCH_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Default watch directory: {WATCH_DIR}")
    yield


app = create_app("Real-time File Watcher Worker", lifespan=lifespan)


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
    serve(app, args)


if __name__ == "__main__":
    main()
