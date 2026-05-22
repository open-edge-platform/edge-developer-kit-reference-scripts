#!/usr/bin/env python3

# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

# Open source Library
import os
import cv2
import sys
import time
import math
import numpy as np
import openvino as ov
from argparse import ArgumentParser
from multiprocessing import Manager, SimpleQueue, Lock
from flask import Flask, Response
from influxdb import InfluxDBClient
from queue import Queue, Empty
from threading import Thread

# Own Library
from utils.logger import Logger
from utils.validate_camera_config import read_config
from utils.video_stream import VideoStream
from utils.influxdb import influx

import gi
from gi.repository import Gst
gi.require_version('GObject', '2.0')
gi.require_version('Gst', '1.0')

app = Flask(__name__)
APP_LOGGER = Logger(name="Smart Parking Client")

# Config
CERT_DIR = "/etc/smart-parking/certs"
SERVER_HOST = os.getenv('SERVER_HOST', 'smart-parking-server')

# Stream config
NUM_CH = 1
FPS = 30
BROADCAST_H, BROADCAST_W = 1920, 1080
RUNNING = []
MUTEX = Lock()
CONFIG_PATH = None
CONF_DATA, URL_DATA = {}, {}
Q_DATA = {}
CURRENT_FRAMES = []
INFLUX_CLIENT = InfluxDBClient('influxdb', 8086, 'admin', 'admin')
Q_CARPARKDATA = Queue()


@app.route('/camera/<cam_id>')
def open_stream(cam_id):
    """
    Route to individual video stream identified by <cam_id>.
    If <cam_id> is 'all' render HTML that shows all video streams.
    Calls _stream_channel(cam_id) function.
    """
    try:
        if not cam_id.isnumeric():
            return Response("The URL does not exist", 401)
        cam_id = int(cam_id)
        if cam_id >= NUM_CH:
            return Response("The URL does not exist", 401)
        return Response(_stream_channel(cam_id),
                        mimetype='multipart/x-mixed-replace; boundary=frame')
    except Exception as err:
        APP_LOGGER.log('info', f'Error: {err}')


@app.route('/camera/all')
def get_all_streams():
    """
    Route to show all running video streams
    """
    return Response(_get_all_streams(NUM_CH),
                    mimetype='multipart/x-mixed-replace; boundary=frame')


@app.route('/health')
def healthcheck():
    """
    Healthcheck endpoint for Docker and monitoring.
    """
    return Response("OK", status=200)


@app.route('/')
def default_route():
    """
    Route to show all running video streams
    """
    return Response("Smart Parking APP")


def _stream_channel(cam_id):
    """
    Generator.
    Yield frames that belongs to <cam_id>.
    """
    global Q_DATA, RUNNING, CURRENT_FRAMES
    MUTEX.acquire()
    RUNNING[cam_id] = True
    MUTEX.release()
    q = Q_DATA[cam_id]
    max_try = 4000
    try:
        while True:
            if q.empty() and max_try > 0:
                MUTEX.acquire()
                RUNNING[cam_id] = True
                MUTEX.release()
                max_try -= 1
                time.sleep(0.01)
                continue
            elif q.empty() and max_try <= 0:
                APP_LOGGER.log(
                    'error', 'Unable to recevie frames from pipeline, Unknown error.')
                break
            max_try = 4000
            frame = q.get()
            CURRENT_FRAMES[cam_id] = frame
            frame_resized = cv2.resize(frame, (BROADCAST_H, BROADCAST_W))
            ret, frame = cv2.imencode('.jpg', frame_resized)
            # cv2.resize(frame, (BROADCAST_H, BROADCAST_W))

            if not ret:
                continue
            time.sleep(1/FPS)
            yield (b' --frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' +
                   frame.tobytes() + b'\r\n\r\n')
    except Exception as err:
        APP_LOGGER.log('error', f'Error: {err}')
    finally:
        MUTEX.acquire()
        RUNNING[cam_id] = False
        MUTEX.release()
        CURRENT_FRAMES[cam_id] = None
        # empty the queue
        while not q.empty():
            _ = q.get()


def _get_all_streams(num_ch):
    """
    Generator.
    Combine and yield frames from all running video streams.
    """
    global Q_DATA, CURRENT_FRAMES, RUNNING, BROADCAST_H, BROADCAST_W
    height, width = BROADCAST_W, BROADCAST_H
    num_rows = math.floor(math.sqrt(num_ch+1))
    num_cols = 2
    idx = 0
    MUTEX.acquire()
    for i in range(num_ch):
        RUNNING[i] = True
    MUTEX.release()
    base = np.zeros((height*num_rows, width*num_cols, 3), np.uint8)
    try:
        while True:
            for idx in range(num_ch):
                if idx >= num_ch:
                    break
                if CURRENT_FRAMES[idx] is None:
                    if Q_DATA[idx].empty():
                        time.sleep(0.01)
                        continue
                    q_width, q_height, _ = Q_DATA[idx].get().shape
                    if q_height != BROADCAST_H and q_width != BROADCAST_W:
                        frame = cv2.resize(
                            Q_DATA[idx].get(), (BROADCAST_H, BROADCAST_W))
                    else:
                        frame = Q_DATA[idx].get()
                else:
                    frame = CURRENT_FRAMES[idx]
                x = int(width * int(idx % num_cols))
                y = int(height * int(idx / num_cols))
                base[y: y + height, x: x + width] = frame
                cv2.resize(frame, (720, 400))
            base_resize = cv2.resize(base, (1920, 540))
            ret, base_en = cv2.imencode('.jpg', base_resize)
            if not ret:
                continue
            time.sleep(1/FPS)
            yield (b' --frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' +
                   base_en.tobytes() + b'\r\n\r\n')
    except Exception as err:
        APP_LOGGER.log('error', f'Error: {err}')
    finally:
        for idx in range(num_ch):
            if CURRENT_FRAMES[idx] is None:
                MUTEX.acquire()
                RUNNING[idx] = False
                MUTEX.release()
                while not Q_DATA[idx].empty():
                    _ = Q_DATA[idx].get()


def get_camera_input(config):
    camera_src = []
    for data in config['cameras']:
        camera_src.append(data['path'])

    return camera_src


def get_args():
    parser = ArgumentParser()
    parser.add_argument("-c", "--config_path",
                        help="Required. Input source config file for camera. Default: ./configs/camera.json",
                        required=False,
                        default="./configs/camera_config.json",
                        type=str
                        )
    parser.add_argument("--model_name", help="Optional. Device for model inferencing. Default: yolov8n",
                        required=False, default="yolov8n", type=str)
    parser.add_argument("-device",
                        "--device",
                        help="Optional. Device for model inferencing. Default: CPU",
                        required=False, default="CPU", type=str)
    return parser.parse_args()


def validate_args(args):
    assert os.path.isfile(args.config_path) == True
    APP_LOGGER.log(
        "info", f"Camera config file exists in {args.config_path}")
    APP_LOGGER.log("info", f"Running model name: {args.model_name}")
    assert (args.device == 'CPU' or args.device == 'GPU')
    APP_LOGGER.log(
        "info", f"Running model inference using device: {args.device}")


def init_all(over_write=False):
    """
    Initialize global variables and
    update datasources and dashboards on grafana server
    """
    global NUM_CH, CONF_DATA

    num_ch, conf_data, given_devices = read_config('./configs/camera_config.json')
    APP_LOGGER.log(
        'debug', f'Camera conf_data - `{conf_data}`')
    for cam_detail in conf_data['cameras']:
        cap = cv2.VideoCapture(cam_detail['path'])
        ret, _ = cap.read()
        if not ret or not cap.isOpened():
            APP_LOGGER.log(
                'error', f'Unable to open source - `{cam_detail["path"]}`')
            sys.exit(-1)
        cap.release()
    core = ov.Core()
    for device in given_devices:
        if device not in core.available_devices:
            APP_LOGGER.log(
                'error', f'Device not found - `{device}`. 'f'All available devices - {core.available_devices}.')
            sys.exit(-1)
    if not over_write or conf_data == CONF_DATA:
        return
    NUM_CH, CONF_DATA = num_ch, conf_data


def summary_carparkdata(CARPARK_DATA, site):

    site_value = []
    site_total = 0
    site_occupied = 0
    site_unoccupied = 0

    for lvl in list(CARPARK_DATA[site].keys()):
        for rw in list(CARPARK_DATA[site][lvl].keys()):
            site_total += CARPARK_DATA[site][lvl][rw]["Total"]
            site_occupied += CARPARK_DATA[site][lvl][rw]["Occupied"]
            site_unoccupied += CARPARK_DATA[site][lvl][rw]["Unoccupied"]

    site_value.append(site_total)
    site_value.append(site_occupied)
    site_value.append(site_unoccupied)
    site_values = dict(zip(
        ["TotalCarpark", "TotalOccupiedCarpark", "TotalUnoccupiedCarpark"], site_value))

    return site_values


def level_carparkdata(CARPARK_DATA, site, level):

    level_value = []
    level_total = 0
    level_occupied = 0
    level_unoccupied = 0

    for rw in list(CARPARK_DATA[site][level].keys()):
        level_total += CARPARK_DATA[site][level][rw]["Total"]
        level_occupied += CARPARK_DATA[site][level][rw]["Occupied"]
        level_unoccupied += CARPARK_DATA[site][level][rw]["Unoccupied"]

    level_value.append(level_total)
    level_value.append(level_occupied)
    level_value.append(level_unoccupied)
    level_data = dict(zip(["Total", "Occupied", "Unoccupied"], level_value))
    level_values = dict(zip({level}, [level_data]))

    return level_values


def data_query(Q_CARPARKDATA):
    CARPARK_DATA = {}

    while True:
        try:
            item = Q_CARPARKDATA.get()
        except Empty:
            continue
        else:
            site = list(item.keys())[0]
            level = list(item[site].keys())[0]
            row = list(item[site][level].keys())[0]

            if len(CARPARK_DATA.keys()) == 0:
                CARPARK_DATA[site] = item[site]
            else:
                if level in list(CARPARK_DATA[site].keys()):
                    CARPARK_DATA[site][level][row] = item[site][level][row]
                else:
                    CARPARK_DATA[site][level] = item[site][level]

            site_values = summary_carparkdata(CARPARK_DATA, site)
            level_values = level_carparkdata(CARPARK_DATA, site, level)
            CARPARK_DATA.update(site_values)
            CARPARK_DATA.update(level_values)
            influx(CARPARK_DATA, INFLUX_CLIENT)
            Q_CARPARKDATA.task_done()


def main():
    global CONFIG_PATH, Q_DATA, RUNNING, CURRENT_FRAMES, BROADCAST_H, BROADCAST_W, Q_CARPARKDATA

    APP_LOGGER.log("info", "Starting Smart Parking Client...")
    args = get_args()
    APP_LOGGER.log('debug', f'Arguments: {args}')
    validate_args(args)
    init_all(over_write=True)

    camera_src_list = get_camera_input(CONF_DATA)
    APP_LOGGER.log(
        'info', f'Current inference streaming running: {len(camera_src_list)}')
    data_thread = Thread(
        target=data_query,
        args=(Q_CARPARKDATA,),
        daemon=True
    )
    data_thread.start()

    threads = []
    manager = Manager()
    RUNNING = manager.list([False]*NUM_CH)
    CURRENT_FRAMES = [None]*NUM_CH
    Q_DATA = {key: SimpleQueue() for key in range(0, NUM_CH)}
    for i, url in enumerate(camera_src_list):
        thread = VideoStream(
            url, args.model_name, f"Camera {i+1}", i, Q_DATA, RUNNING, BROADCAST_H, BROADCAST_W, Q_CARPARKDATA, CONF_DATA)
        thread.start()
        threads.append(thread)
    try:
        # SSL
        # app.run(host=SERVER_HOST, port=8000, threaded=True, ssl_context=(
        #     f'{CERT_DIR}/smart-parking.pem', f'{CERT_DIR}/smart-parking-key.pem'))
        app.run(host=SERVER_HOST, port=8000, threaded=True)
    except KeyboardInterrupt:
        data_thread.join()
        for thread in threads:
            thread.join()

        cv2.destroyAllWindows()
        sys.exit(1)


if __name__ == '__main__':
    main()