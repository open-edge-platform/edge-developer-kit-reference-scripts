# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import numpy as np
import threading
import time
import subprocess  # nosec B404
import sys
import zmq
import os
import signal
import cv2
import queue

from modules.lerobot.utils import create_dynamic_grid
from modules.lerobot.base_robot import BaseRobotModule

ZMQ_ADDRESS = "tcp://localhost:5555"
SUBSCRIPTION_TOPIC = b"NUMPY_DATA" 

def run_robot_script(task_name: str):
    try:
        process = subprocess.Popen(  # nosec B602,B404
            [sys.executable, "./apps/mujoco_runner.py"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            start_new_session=True,
        )
        return process.pid
    except FileNotFoundError:
        print("Fail to run task")

class LeRobotSimModule(BaseRobotModule):
    def __init__(self):
        super().__init__()
        self.is_robot_disconnected = threading.Event()
        self.is_robot_disconnected.set()

        self.stop_event = threading.Event()
        self.max_queue_size = 1
        self.frame_queue = queue.Queue(maxsize=self.max_queue_size)

    def run(self):
        # pid = run_robot_script("mujoco_runner")

        context = zmq.Context()
        socket = context.socket(zmq.SUB)
        socket.connect(ZMQ_ADDRESS)
        socket.setsockopt(zmq.SUBSCRIBE, SUBSCRIPTION_TOPIC)

        while not self.stop_event.is_set():
            topic = socket.recv_string() 
            received_array = socket.recv_pyobj()

            cv_images = []
            for k, v in received_array['pixels'].items():
                if isinstance(v, np.ndarray):
                    cv_image = cv2.cvtColor(v, cv2.COLOR_BGR2RGB)
                    cv_image = cv2.resize(cv_image, (640, 480))
                    cv_images.append(cv_image)
    
            try:
                if self.frame_queue.full():
                    self.frame_queue.get_nowait()

                grided_images = create_dynamic_grid(cv_images)
                self.frame_queue.put_nowait(grided_images)
            except:
                pass
    
            time.sleep(0.05)

        socket.close()

        # try:
        #     os.kill(pid, 0)
        # except OSError:
        #     pass

        # signal_to_send = signal.SIGKILL
        # try:
        #     os.kill(pid, signal_to_send)
        # except Exception as e:
        #     pass

    def live_stream(self):
        retries = 5

        while retries > 0:
            if not self.is_robot_disconnected.is_set():
                break
            time.sleep(1)
            retries -= 1

        if retries == 0:
            yield b''
            return 
        
        print(retries)

        while not self.is_robot_disconnected.is_set():
            print("try ....")
            try:
                frame = self.frame_queue.get(timeout=1)
                print(frame)
            except queue.Empty:
                continue

            ret, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 90])
            if not ret:
                continue

            frame_bytes = buffer.tobytes()
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
            
    def connect(self):
        self.is_robot_disconnected.clear()
        self.start()

    def disconnect(self):
        self.is_robot_disconnected.set()

    def stop(self):
        self.stop_event.set()

    def start_episode(self):
        return super().start_episode()
    
    def stop_episode(self):
        return super().stop_episode()
    
    def reset_episode(self):
        return super().reset_episode()
    
    def replay_episode(self):
        return super().replay_episode()

    def get_dataset_metadata(self):
        return -1