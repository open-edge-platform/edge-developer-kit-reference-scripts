# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import webbrowser
import os
import uvicorn
import pystray
from typing import Union
from PIL import Image, ImageDraw

from modules.llamacpp.cli import LlamaManagerCLI
from modules.ovms.cli import OVMSManagerCLI
from modules.utils import get_resource_path


class InferenceServerTrayApp:
    HOST = "127.0.0.1"
    ICON_PATH = get_resource_path("icon.ico")
    APP_TITLE = "Inference Server Manager (Running)"

    def __init__(
        self,
        fastapi_app,
        manager: Union[LlamaManagerCLI, OVMSManagerCLI] = None,
        port: int = 9090,
    ):
        self.app = fastapi_app
        self.manager = manager
        self.icon = None
        self.server_thread = None

        self.SERVER_URL = f"http://127.0.0.1:{port}"
        self.SERVER_API_URL = f"http://127.0.0.1:{port}/docs"

    def _open_browser(self):
        webbrowser.open(self.SERVER_URL)

    def _open_browser_api(self):
        webbrowser.open(self.SERVER_API_URL)

    def _open_loading_screen(self):
        webbrowser.open(self.SERVER_URL)

    def _stop_server_and_exit(self, icon):
        if icon:
            icon.stop()

        self.manager.stop_servers()

        os._exit(0)

    def _create_icon_image(self):
        try:
            return Image.open(self.ICON_PATH)
        except FileNotFoundError:
            width, height = 64, 64
            img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
            dc = ImageDraw.Draw(img)
            dc.ellipse((5, 5, width - 5, height - 5), fill="#C0392B")
            return img

    def _setup_tray_icon(self):
        img = self._create_icon_image()

        menu = (
            pystray.MenuItem("Open Management UI", self._open_browser),
            pystray.MenuItem("Open API Docs", self._open_browser_api),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Exit", self._stop_server_and_exit),
        )

        self.icon = pystray.Icon("llama-server-api", img, self.APP_TITLE, menu)

        self.icon.run_detached()

    def start(self, port: int = 9090):
        self.SERVER_URL = f"http://127.0.0.1:{port}"
        self.SERVER_API_URL = f"http://127.0.0.1:{port}/docs"
        self._setup_tray_icon()

        uvicorn.run(
            self.app, host=self.HOST, port=port, log_level="warning", factory=False
        )
