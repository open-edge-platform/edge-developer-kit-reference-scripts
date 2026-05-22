# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import shlex
import subprocess as sp  # nosec
import numpy as np
import openvino as ov
from pathlib import Path
from ultralytics import YOLO

from .postprocess import *


class CarDetectorOmz:
    def __init__(self, model_xml, batchsize=1, device="CPU"):
        self.core = ov.Core()
        if not Path(model_xml).exists():
            self.model_downloader()
        self.model = self.core.read_model(model=model_xml)
        self.input_layer = self.model.input(0)
        self.input_shape = self.input_layer.shape
        self.height = self.input_shape[2]
        self.width = self.input_shape[3]

        for layer in self.model.inputs:
            input_shape = layer.partial_shape
            input_shape[0] = batchsize
            self.model.reshape({layer: input_shape})
        self.compiled_model = self.core.compile_model(model=self.model, device_name=device)
        self.output_layer = self.compiled_model.output(0)
        
    def model_downloader(self, model_name='vehicle-detection-0201'):
        command = f"omz_downloader --name {model_name} --output_dir ./model"
        try:
            result = sp.run(shlex.split(command), check=True)
        except sp.CalledProcessError as e:
            raise RuntimeError(f"Export command failed with error: {e}")
        
    def predict(self, input):
        result = self.compiled_model(input)[self.output_layer]
        return result
    
    def preprocess(self, frame, height, width):
        resized_image = cv2.resize(frame, (width, height))
        resized_image = resized_image.transpose((2, 0, 1))
        input_image = np.expand_dims(resized_image, axis=0).astype(np.float32)
        return input_image
            
    def draw_boxes(self, img, bbox):
        for i, box in enumerate(bbox):
            x1, y1, x2, y2 = [int(i) for i in box]
            cv2.rectangle(img, (x1, y1), (x2, y2), (255, 0, 0), 2)
        return img
            
    def process_results(self, h, w, results, frame, thresh=0.6, show_bboxes=False):
        detections = results.reshape(-1, 7)
        boxes = []
        labels = []
        scores = []
        for i, detection in enumerate(detections):
            _, label, score, xmin, ymin, xmax, ymax = detection
            if score > thresh:
                boxes.append([xmin * w, ymin * h, xmax * w, ymax * h])
                labels.append(int(label))
                scores.append(float(score))

        if len(boxes) == 0:
            boxes = np.array([]).reshape(0, 4)
            scores = np.array([])
            labels = np.array([])
            
        if show_bboxes:
            frame = self.draw_boxes(frame, np.array(boxes))
            
        return frame, np.array(boxes), np.array(scores), np.array(labels)
    
    
class CarDetectorYolo:
    def __init__(self, model_xml, device="CPU"):
        self.yolo_model = YOLO(f'./model/yolov8n.pt')
        self.label_map = self.yolo_model.model.names
        if not Path(model_xml).exists():
            self.yolo_model.export(format='openvino', dynamic=True, int8=True)            
        self.core = ov.Core()
        self.model = self.core.read_model(model_xml)
        ov_config = {}
        if device != "CPU":
            self.model.reshape({0: [1, 3, 640, 640]})
        if "GPU" in device or ("AUTO" in device and "GPU" in self.core.available_devices):
            ov_config = {"GPU_DISABLE_WINOGRAD_CONVOLUTION": "YES"}
        self.compiled_model = self.core.compile_model(self.model, device, ov_config)
    
    def preprocess_image(self, img: np.ndarray):
        img = letterbox(img)[0]
        img = img.transpose(2, 0, 1)
        img = np.ascontiguousarray(img)
        return img

    def detect(self, image:np.ndarray, show_bboxes=False):
        num_outputs = len(self.compiled_model.outputs)
        preprocessed_image = self.preprocess_image(image)
        input_tensor = image_to_tensor(preprocessed_image)
        result = self.compiled_model(input_tensor)
        boxes = result[self.compiled_model.output(0)]
        masks = None
        if num_outputs > 1:
            masks = result[self.compiled_model.output(1)]
        input_hw = input_tensor.shape[2:]
        detections = postprocess(pred_boxes=boxes, input_hw=input_hw, orig_img=image, pred_masks=masks)
        if show_bboxes:
            result = draw_results(detections[0], image, self.label_map)
        
        return detections[0]['det']
        
    
