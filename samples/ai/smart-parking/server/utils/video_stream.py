# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import math
import cv2
import sys
import time
import threading
import collections
import numpy as np
from functools import reduce
from defusedxml.ElementTree import parse

from .logger import Logger
from .car_inference import CarDetectorYolo, CarDetectorOmz

FPS = 20

class VideoStream(threading.Thread):
    def __init__(self, url, model_name, window_name, ch_id, q_data, running, broadcast_height, broadcast_width, q_cardata, conf_data, visualize=False):
        threading.Thread.__init__(self)
        self.input_type = None
        self.url = url
        self.window_name = window_name
        self.capture = cv2.VideoCapture(self.url)
        self.videoStream_logger = Logger(name=f"{window_name}")
        self.ch_id = ch_id
        self.q_data = q_data
        self.running = running
        self.broadcast_height = broadcast_height
        self.broadcast_width = broadcast_width
        self.visualize = visualize
        self.conf_data = conf_data
        self.test_data = {}
        self.q_cardata = q_cardata
        self._verify_stream_input_type(self.url)
        self.detector_yolo = None
        self.detector_omz = CarDetectorOmz('./model/intel/vehicle-detection-0201/FP16-INT8/vehicle-detection-0201.xml', 
                                           -1, 
                                           device=self.conf_data['cameras'][self.ch_id]['device'])

    def run(self):
        try:
            processing_times = collections.deque()
            value_acc = collections.deque()

            while True:
                start_time = time.time()
                time.sleep(1/FPS)
                ret, frame = self.capture.read()
                # self.videoStream_logger.log('info', f'Frame data: {frame}')
                
                if frame is not None and frame.shape != (1080, 1920, 3):
                    frame = self._preprocess_frame_size(frame, (1080, 1920))
                
                if not ret and self.input_type == 'video_file':
                    self.capture.set(cv2.CAP_PROP_POS_FRAMES, 0)
                    continue
                
                cv2.resize(frame, (self.broadcast_width, self.broadcast_height))
                
                if self.detector_omz and frame is not None:
                    h, w = frame.shape[:2]
                    input_image = self.detector_omz.preprocess(frame, self.detector_omz.height, self.detector_omz.width)
                    output = self.detector_omz.predict(input_image)
                    frame, car_bboxes, _, _ = self.detector_omz.process_results(h, w, output, frame, show_bboxes=False)
                else:
                    car_bboxes = self.detector_yolo.detect(frame, show_bboxes=False)

                # self.videoStream_logger.log(
                #     'info', f'{self.running}, {self.ch_id}')

                cp_bboxes = self._get_carpark_boundingbox(frame)

                occupied_carpark = self._occ_or_unocc(
                    frame, car_bboxes, cp_bboxes)

                value = self._carpark_data(
                    cp_bboxes, occupied_carpark)

                value_acc.append(value)
                if len(value_acc) > 30:
                    value_acc.popleft()

                carpark_value = list(value_acc)

                value_transpose = np.transpose(carpark_value)

                value_max = []
                for det_list in value_transpose:
                    values, counts = np.unique(det_list, return_counts=True)
                    most_index = np.argmax(counts)
                    most_value = int(values[most_index])
                    value_max.append(most_value)
                for i in range(len(value_max)):
                    box = cp_bboxes[i]
                    if i in occupied_carpark:
                        color = (0, 0, 255)
                    else:
                        color = (0, 255, 0)
                    cv2.rectangle(frame, (int(box[0]), int(
                        box[1])), (int(box[2]), int(box[3])), color, 3)
                no_unocc = []
                no_occ = []
                for val in value_max:
                    if val == 0:
                        no_unocc.append(val)
                    else:
                        no_occ.append(val)

                carpark_dict = self._carpark_data_update(
                    cp_bboxes, value_max
                )

                carpark_dict_calc = self._carpark_data_calc(
                    cp_bboxes, carpark_dict
                )

                for key, value in carpark_dict_calc.items():
                    self.test_data = self.update_dict_data(
                        self.test_data, key, value)

                self.q_cardata.put(self.test_data)
                
                end_time = time.time()
                latency = end_time - start_time
                processing_times.append(latency)
                if len(processing_times) > 200:
                    processing_times.popleft()
                processing_time = np.mean(processing_times) * 1000
                fps = 1000 / processing_time

                self._draw_statistics(frame, fps, latency)

                try:
                    if self.running[self.ch_id]:
                        self.q_data[self.ch_id].put(frame)
                    else:
                        time.sleep(0.005)
                except FileNotFoundError:
                    sys.exit()

                if self.visualize == True:
                    cv2.namedWindow(self.window_name)
                    if ret:
                        cv2.imshow(self.window_name, frame)
                    if cv2.waitKey(5) & 0xFF == ord('q'):
                        break
            self.capture.release()
            cv2.destroyWindow(self.window_name)

        except Exception as err:
            self.videoStream_logger.log('error', f'Error in video stream: {err}')

    def _verify_stream_input_type(self, input):
        cap = cv2.VideoCapture(input)
        if input.endswith('.mp4') or input.endswith('.avi') or input.endswith('.mov'):
            self.input_type = 'video_file'
            self.videoStream_logger.log(
                'info', f'{self.window_name} is a video input')
        elif input.isdigit() and int(input) in range(100):
            self.input_type = 'camera'
            self.videoStream_logger.log(
                'info', f'{self.window_name} is a camera input')
        elif input.startswith('rtsp://'):
            self.input_type = 'rtsp_stream'
            self.videoStream_logger.log(
                'info', f'{self.window_name} is a rtsp input')
        else:
            self.input_type = None
            self.videoStream_logger.log(
                'error', f'{self.window_name} has unsupported type input: {input}')
            sys.exit(1)
        cap.release()
        
    def _preprocess_frame_size(self, frame, target_size = (1080, 1920)):
        ih, iw = frame.shape[:2]
        th, tw = target_size

        scale = min(tw / iw, th / ih)
        nw, nh = int(iw * scale), int(ih * scale)
        pad_w = (tw - nw) // 2
        pad_h = (th - nh) // 2

        # Resize the image
        frame_resized = cv2.resize(frame, (nw, nh))

        frame_padded = np.full((th, tw, 3), 128, np.uint8)
        frame_padded[pad_h:pad_h+nh, pad_w:pad_w+nw, :] = frame_resized

        return frame_padded

    def _draw_statistics(self, frame, fps, latency):
        fps_origin = (10, 50)
        latency_origin = (10, 100)

        font = cv2.FONT_HERSHEY_SIMPLEX
        font_scale = 1.5
        color = (0, 0, 0)
        thickness = 3

        cv2.putText(frame, str(
            f'Stream FPS: {fps:.2f}'), fps_origin, font, font_scale, color, thickness=thickness)
        cv2.putText(frame, str(
            f'Stream latency: {latency:.2f}'), latency_origin, font, font_scale, color, thickness=thickness)

    def _get_carpark_boundingbox(self, frame):
        cam_detail = self.conf_data['cameras'][self.ch_id]
        tree = parse(cam_detail['bboxes'])
        root = tree.getroot()
        size = root.findall('size')[0]
        height = int(size.find('height').text)
        width = int(size.find('width').text)
        objects = root.findall("object")
        x_ratio = self.broadcast_height/width
        y_ratio = self.broadcast_width/height
        cp_bboxes = []
        i = 0
        for object in objects:
            xmin = int(int(object.find('bndbox').find('xmin').text) * x_ratio)
            ymin = int(int(object.find('bndbox').find('ymin').text) * y_ratio)
            xmax = int(int(object.find('bndbox').find('xmax').text) * x_ratio)
            ymax = int(int(object.find('bndbox').find('ymax').text) * y_ratio)
            car_park_bboxes = [int(xmin), int(ymin), int(xmax), int(ymax)]

            i += 1
            cp_bboxes.append(car_park_bboxes)
            row = cam_detail['address'].split('_')
            cv2.putText(frame, row[2] + '_' + str(i), (int(xmin + 20 ), int(ymin - 20)), 
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)
            cv2.putText(frame, str(
                cam_detail['address']), (1100, 70), cv2.FONT_HERSHEY_SIMPLEX, 2.5, (0, 0, 0), 3)

        return cp_bboxes

    def _occ_or_unocc(self, frame, car_bboxes, cp_bboxes):
        occupied_carpark = []
        new_cp_idx = []
        for car_bbox in car_bboxes:
            cp_idx = self.matching(
                car_bbox, cp_bboxes, 50, 0.5)
            if cp_idx != -1:
                new_cp_idx.append(cp_idx)
                occupied_carpark = np.unique(new_cp_idx)
        for i in range(len(cp_bboxes)):
            box = cp_bboxes[i]
            if i in occupied_carpark:
                color = (0, 0, 255)
            else:
                color = (0, 255, 0)
            cv2.rectangle(frame, (int(box[0]), int(
                box[1])), (int(box[2]), int(box[3])), color, 3)

        return occupied_carpark
    
    def matching(self, boxA, boxB, distance_threshold=50, iou_threshold=0.5):
        distance_of_centroid = []
        carX = int((boxA[0] + boxA[2]) / 2.0)
        carY = int((boxA[1] + boxA[3]) / 2.0)
        for carpark in boxB:
            carparkX = int((carpark[0] + carpark[2]) / 2.0)
            carparkY = int((carpark[1] + carpark[3]) / 2.0)
            distance_of_centroid.append(
                math.sqrt((carX - carparkX) ** 2 + (carY - carparkY) ** 2))
        carpark_Index = distance_of_centroid.index(min(distance_of_centroid))
        if distance_of_centroid[carpark_Index] <= distance_threshold:
            iou_carpark = self.intersection_over_union(
                boxA, boxB[carpark_Index])
            if iou_carpark >= iou_threshold:
                return carpark_Index
            else:
                return -1
        else:
            return -1

    def intersection_over_union(self, boxA, boxB):
        xA = max(boxA[0], boxB[0])
        yA = max(boxA[1], boxB[1])
        xB = min(boxA[2], boxB[2])
        yB = min(boxA[3], boxB[3])
        interArea = max(0, xB-xA+1) * max(0, yB-yA+1)
        boxA_area = (boxA[2] - boxA[0] + 1) * (boxA[3] - boxA[1] + 1)
        boxB_area = (boxB[2] - boxB[0] + 1) * (boxB[3] - boxB[1] + 1)
        iou = interArea / float(boxA_area + boxB_area - interArea)
        
        return iou

    def _carpark_data(self, cp_bboxes, occupied_carpark):
        value = []
        for i in range(len(cp_bboxes)):
            if i in occupied_carpark:
                occupied_or_unoccupied = 1
                value.append(occupied_or_unoccupied)
            else:
                occupied_or_unoccupied = 0
                value.append(occupied_or_unoccupied)
                
        return value

    def _carpark_data_update(self, cp_bboxes, carpark_value_max):
        cam_detail = self.conf_data['cameras'][self.ch_id]
        cam_address = cam_detail["address"]
        for i in range(len(cp_bboxes)):
            cp_bboxes[i] = cam_address + "_" + str(i+1)
        carpark_dict = dict(zip(cp_bboxes, carpark_value_max))
        
        return carpark_dict

    def _carpark_data_calc(self, cp_bboxes, carpark_dict):
        cam_detail = self.conf_data['cameras'][self.ch_id]
        cam_address = cam_detail["address"]
        key_channel = []
        value_channel = []
        value_unoccupied = []
        value_occupied = []
        for key, value in carpark_dict.items():
            if value == 0:
                value_unoccupied.append(key)
            else:
                value_occupied.append(key)
        total_num = len(cp_bboxes)
        occupied_carpark_num = len(value_occupied)
        unoccupied_carpark_num = len(value_unoccupied)
        key_channel = ['Total', 'Occupied', 'Unoccupied']
        for i in range(len(key_channel)):
            key_channel[i] = cam_address + "_" + key_channel[i]
        value_channel = [total_num,
                         occupied_carpark_num, unoccupied_carpark_num]
        carpark_data = dict(zip(key_channel, value_channel))
        carpark_dict.update(carpark_data)
        
        return carpark_dict

    def get_key_value(self, dictionary, keys, default=None):
        return reduce(lambda d, key: d.get(key, default) if isinstance(d, dict) else default, keys.split("_"), dictionary)

    def update_key_value(self, dictionary, keys, value):
        key_list = keys.split("_")
        last_key = key_list.pop()
        nested_dict = reduce(lambda d, key: d.setdefault(
            key, {}), key_list, dictionary)
        nested_dict[last_key] = value

    def update_dict_data(self, data_dict, data_key, data_value):
        _value = self.get_key_value(data_dict, data_key)
        if _value != None:
            if data_value != _value:
                self.update_key_value(data_dict, data_key, data_value)
        else:
            # print("key not found")
            self.update_key_value(data_dict, data_key, data_value)
            
        return data_dict
