# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import logging


class Logger:
    def __init__(self, name, logLevel=logging.DEBUG, generateLogFile=False, logFile='log'):
        # Create a logger with the specified name
        self.logger = logging.getLogger(name)

        # Set the log level
        self.logger.setLevel(logLevel)

        if generateLogFile:
            # Create a file handler and add it to the logger
            file_handler = logging.FileHandler(f'{logFile}.txt')
            file_handler.setLevel(logLevel)

            # Create a formatter and add it to the file handler
            formatter = logging.Formatter(
                '%(asctime)s - %(name)s - %(levelname)s - %(message)s')
            file_handler.setFormatter(formatter)
            self.logger.addHandler(file_handler)

        # Create a stream handler and add it to the logger
        stream_handler = logging.StreamHandler()
        stream_handler.setLevel(logLevel)

        formatter = logging.Formatter(
            '%(asctime)s - %(name)s - %(levelname)s - %(message)s')
        stream_handler.setFormatter(formatter)
        self.logger.addHandler(stream_handler)

    def log(self, level, message):
        # Log the specified message at the specified log level
        if level == 'debug':
            self.logger.debug(message)
        elif level == 'info':
            self.logger.info(message)
        elif level == 'warning':
            self.logger.warning(message)
        elif level == 'error':
            self.logger.error(message)
        elif level == 'critical':
            self.logger.critical(message)
