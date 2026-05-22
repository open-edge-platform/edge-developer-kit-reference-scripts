# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0 
import os

from app.core.config import (APP, CAMERA_FEED, CONVEYOR_BELT, DATABASE,
                             DEFECT_DETECTOR, ROBOTIC_ARM)
from app.utils import (AnalyticsStatistics, CameraFeed, ConveyorBelt,
                       DatabaseHandler, DefectDetector, RoboticArm)

image_dir = APP['image_directory']
os.makedirs(image_dir, exist_ok=True)

# Global controller instances
camera_feed_controller = None
conveyor_belt_controller = None
robotic_arm_controller = None
defect_detector = None
database_handler = None
analytics_statistics_generator = None

def get_camera_controller():
    global camera_feed_controller
    if camera_feed_controller is None:
        camera_feed_controller = CameraFeed.CameraFeed(
            camera_id=CAMERA_FEED['camera_id'],
            focus=CAMERA_FEED['focus']
        )
    return camera_feed_controller

def get_conveyor_controller():
    global conveyor_belt_controller
    if conveyor_belt_controller is None and CONVEYOR_BELT['isEnabled']:
        conveyor_belt_controller = ConveyorBelt.ConveyorBelt(
            port=CONVEYOR_BELT['port'],
            baud_rate=CONVEYOR_BELT['baud_rate']
        )
    return conveyor_belt_controller

def get_robotic_arm_controller():
    global robotic_arm_controller
    if robotic_arm_controller is None:
        robotic_arm_controller = RoboticArm.RoboticArm(
            type=ROBOTIC_ARM['type'],
            port=ROBOTIC_ARM['port'],
            speed=ROBOTIC_ARM['speed'],
            movement_mode=ROBOTIC_ARM['movement_mode'],
            sleep_time=ROBOTIC_ARM['sleep_time'],
            baud_rate=ROBOTIC_ARM['baud_rate'],
            ip_address=ROBOTIC_ARM['ip_address'],
            ip_port=ROBOTIC_ARM['ip_port']
        )
        robotic_arm_controller.move(angles=[ROBOTIC_ARM['angles']['point_0']])
    return robotic_arm_controller

def get_defect_detector():
    global defect_detector
    if defect_detector is None:
        defect_detector = DefectDetector.DefectDetector(
            deployment_path=DEFECT_DETECTOR['model_path'],
            device=DEFECT_DETECTOR['device']
        )
    return defect_detector

def get_database_handler():
    global database_handler
    if database_handler is None:
        database_handler = DatabaseHandler.DatabaseHandler(
            db_name=DATABASE['database'],
            collection_name=DATABASE['collection'],
            uri=DATABASE['uri']
        )
    return database_handler

def get_analytics_statistics_generator():
    global analytics_statistics_generator
    if analytics_statistics_generator is None:
        analytics_statistics_generator = AnalyticsStatistics.AnalyticsStatistics(
            database_handler=get_database_handler(),
            image_directory=image_dir
        )
    return analytics_statistics_generator

# Runtime variables
is_inference_in_progress = False
latest_annotated_frame = CAMERA_FEED['empty_frame']

from fastapi.templating import Jinja2Templates

templates = Jinja2Templates(directory="templates")
