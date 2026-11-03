# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import logging
import logging.handlers

from worker_common import instance_data_dir

logger = None


def getLogger(name=__name__):
    global logger

    log_dir = instance_data_dir(".") / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)

    if logger == None:
        logger = logging.getLogger(name)
        logger.setLevel(logging.DEBUG)
        formatter = logging.Formatter(
            "%(asctime)s - %(funcName)s - %(levelname)s - %(message)s"
        )

        fhandler = logging.handlers.RotatingFileHandler(
            log_dir / "debug.log", maxBytes=20 * 1024 * 1024, backupCount=2, encoding="utf-8"
        )
        fhandler.setFormatter(formatter)
        fhandler.setLevel(logging.INFO)
        logger.addHandler(fhandler)

        stdHandler = logging.StreamHandler()
        stdHandler.setFormatter(formatter)
        stdHandler.setLevel(logging.INFO)
        logger.addHandler(stdHandler)

    return logger
