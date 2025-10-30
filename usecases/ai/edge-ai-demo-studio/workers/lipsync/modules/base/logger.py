# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from pathlib import Path
import logging

logger = None

def getLogger(name=__name__):
    global logger
    
    Path("logs").mkdir(parents=True, exist_ok=True)

    if logger == None:
        logger = logging.getLogger(name)
        logger.setLevel(logging.DEBUG)
        formatter = logging.Formatter('%(asctime)s - %(funcName)s - %(levelname)s - %(message)s')

        fhandler = logging.FileHandler('logs/debug.log')
        fhandler.setFormatter(formatter)
        fhandler.setLevel(logging.INFO)
        logger.addHandler(fhandler)

        stdHandler = logging.StreamHandler()
        stdHandler.setFormatter(formatter)
        stdHandler.setLevel(logging.INFO)
        logger.addHandler(stdHandler)

    return logger