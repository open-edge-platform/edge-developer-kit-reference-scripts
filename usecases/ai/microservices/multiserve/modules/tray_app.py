# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import pystray
import webbrowser
import os
import uvicorn
from typing import Union
from PIL import Image, ImageDraw

from modules.llamacpp.cli import LlamaManagerCLI
from modules.ovms.cli import OVMSManagerCLI
from modules.utils import get_resource_path

class InferenceServerTrayApp:
    HOST = "0.0.0.0" 
    PORT = 8000
    SERVER_URL = f"http://127.0.0.1:{PORT}"
    SERVER_API_URL = f"http://127.0.0.1:{PORT}/docs"
    ICON_PATH = get_resource_path("icon.ico")
    APP_TITLE = 'Inference Server Manager (Running)'

    def __init__(self, fastapi_app, manager: Union[LlamaManagerCLI, OVMSManagerCLI] = None):
        self.app = fastapi_app
        self.manager = manager
        self.icon = None
        self.server_thread = None

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
            img = Image.new('RGBA', (width, height), (0, 0, 0, 0)) 
            dc = ImageDraw.Draw(img)
            dc.ellipse((5, 5, width - 5, height - 5), fill='#C0392B') 
            return img

    def _setup_tray_icon(self, is_loading=False):
        img = self._create_icon_image()
        
        menu = (
            pystray.MenuItem('Open Management UI', self._open_browser),
            pystray.MenuItem('Open API Docs', self._open_browser_api),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem('Exit', self._stop_server_and_exit)
        )
        
        self.icon = pystray.Icon(
            'llama-server-api', 
            img, 
            self.APP_TITLE, 
            menu
        )
        
        self.icon.run_detached()
        
    def start(self, no_browser: bool = True):
        self._setup_tray_icon(is_loading=False)
        
        # if not no_browser:
        #     self._open_loading_screen()

        uvicorn.run(self.app, host=self.HOST, port=self.PORT, log_level="warning", factory=False)