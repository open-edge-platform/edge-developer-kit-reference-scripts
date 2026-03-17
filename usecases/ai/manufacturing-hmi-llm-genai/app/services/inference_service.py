# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0 
import os


from app.core import globals
from app.core.config import CAMERA_FEED, CONVEYOR_BELT, ROBOTIC_ARM
from app.core.globals import (get_camera_controller, get_conveyor_controller,
                              get_database_handler, get_defect_detector,
                              get_robotic_arm_controller)

# Assign config variables to local variables for efficiency
image_dir = globals.image_dir
empty_frame = CAMERA_FEED['empty_frame']
steps_to_camera = CONVEYOR_BELT['steps_to_camera']
steps_from_camera = CONVEYOR_BELT['steps_from_camera']
is_conveyor_enabled = CONVEYOR_BELT['isEnabled']
robot_angles = ROBOTIC_ARM['combined_angles']

def run_inference() -> None:
    """
    Run the inference process on the next PCB in the queue.

    This function controls the entire defect detection pipeline:
    - Captures images from the camera.
    - Performs inference using the defect detection model.
    - Annotates and saves images if a defect is found.
    - Logs results to the database.
    - Controls the robotic arm and conveyor belt based on results.

    The process attempts inference for up to 10 frames.
    If a defect is found, the loop breaks early.
    """
    # Initialize controllers
    camera_feed_controller = get_camera_controller()
    database_handler = get_database_handler()
    conveyor_belt_controller = get_conveyor_controller()
    robotic_arm_controller = get_robotic_arm_controller()
    defect_detector = get_defect_detector()

    # Set initial inference states
    globals.is_inference_in_progress = True
    globals.latest_annotated_frame = empty_frame

    # Get PCB ID and set image path
    pcb_id = database_handler.get_next_pcb_id()
    image_filename = f"pcb_{pcb_id}.png"
    image_path = os.path.join(image_dir, image_filename)

    # Move the PCB into the inspection area
    robotic_arm_controller.control_gripper(state=0)
    robotic_arm_controller.move(angles=robot_angles['infer_1'])
    robotic_arm_controller.control_gripper(state=1)
    robotic_arm_controller.move(angles=robot_angles['infer_2'])
    robotic_arm_controller.control_gripper(state=0)
    if is_conveyor_enabled:
        conveyor_belt_controller.move(steps=steps_to_camera)

    for _ in range(10):
        frame = camera_feed_controller.get_pre_processed_frame()
        prediction, is_defect_present = defect_detector.detect_defect(frame=frame)

        if is_defect_present:
            pcb_status = "fail"
            globals.latest_annotated_frame = defect_detector.get_annotated_frame(frame=frame, prediction=prediction)
            camera_feed_controller.save_frame(image_path=image_path, frame=globals.latest_annotated_frame)
            database_handler.insert_document(pcb_id=pcb_id, status=pcb_status, image_path=image_path, prediction=prediction)

            # Move PCB to rejection area and reject it
            if is_conveyor_enabled:
                conveyor_belt_controller.move(steps=steps_from_camera)
            robotic_arm_controller.control_gripper(state=1)
            robotic_arm_controller.move(angles=robot_angles['fail'])
            robotic_arm_controller.control_gripper(state=0)
            robotic_arm_controller.move(angles=robot_angles['home'])
            break
    else:
        # No defects found after 10 frames
        pcb_status = "pass"
        globals.latest_annotated_frame = frame
        camera_feed_controller.save_frame(image_path=image_path, frame=frame)
        database_handler.insert_document(pcb_id=pcb_id, status=pcb_status, image_path=image_path)

        # Move PCB to approval area and approve it
        if is_conveyor_enabled:
            conveyor_belt_controller.move(steps=steps_from_camera)
        robotic_arm_controller.control_gripper(state=1)
        robotic_arm_controller.move(angles=robot_angles['pass'])
        robotic_arm_controller.control_gripper(state=0)
        robotic_arm_controller.move(angles=robot_angles['home'])

    globals.is_inference_in_progress = False
