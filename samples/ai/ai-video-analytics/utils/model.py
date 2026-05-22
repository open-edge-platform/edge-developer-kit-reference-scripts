# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import os
import cv2
import sys
import time
import requests
import numpy as np
from PIL import Image
from pathlib import Path
from functools import partial
from datetime import datetime
from transformers import BlipProcessor, BlipForQuestionAnswering, BlipForConditionalGeneration

import torch
import openvino as ov

from utils.blip_model import text_decoder_forward, OVBlipModel

from ultralytics import FastSAM, YOLO

from utils.facial_recognition.landmarks_detector import LandmarksDetector
from utils.facial_recognition.face_detector import FaceDetector
DEVICE = os.getenv("DEVICE", "CPU")
def letterbox_image(image, size):
    '''resize image with unchanged aspect ratio using padding'''
    ih, iw, _ = image.shape
    eh, ew = size
    scale = min(eh / ih, ew / iw)
    nh = int(ih * scale)
    nw = int(iw * scale)

    image = cv2.resize(image, (nw, nh), interpolation=cv2.INTER_CUBIC)
    new_img = np.full((eh, ew, 3), 128, dtype='uint8')
    # fill new image with the resized image and centered it
    new_img[(eh - nh) // 2:(eh - nh) // 2 + nh,
            (ew - nw) // 2:(ew - nw) // 2 + nw,
            :] = image.copy()
    return new_img, scale, (nw, nh)


def crop_image(image, bbox):
    x_min, y_min, x_max, y_max = bbox
    cropped_img = image[y_min:y_max, x_min:x_max]
    return cropped_img


class ImageCaptionPipeline:
    def __init__(self, device="GPU") -> None:
        self.core = ov.Core()

        blip_vision_path = Path("./data/model/blip_vision_model.xml")
        text_encoder_path = Path("./data/model/blip_text_encoder.xml")
        text_decoder_path = Path(
            "./data/model/blip_text_decoder_with_past.xml")

        self.processor = BlipProcessor.from_pretrained(
            "Salesforce/blip-vqa-base")
        self.model = BlipForQuestionAnswering.from_pretrained(
            "Salesforce/blip-vqa-base")

        self.ov_model = self._optimize_model_for_ov(
            blip_vision_path, text_encoder_path, text_decoder_path, device)

        self.fastsam = FastSAM("./data/model/fastsam/FastSAM-s.pt")
        self.yolo_world = YOLO("./data/model/yolo/yolov8s-worldv2.pt")

    def _optimize_model_for_ov(self, blip_vision_path, text_encoder_path, text_decoder_path, device="CPU"):
        os.makedirs("./data/model", exist_ok=True)
        os.makedirs("./data/sample", exist_ok=True)

        vision_model = self.model.vision_model
        vision_model.eval()

        text_encoder = self.model.text_encoder
        text_encoder.eval()

        text_decoder = self.model.text_decoder
        text_decoder.eval()

        if not blip_vision_path.exists() or not text_encoder_path.exists() or not text_decoder_path.exists():
            print("OV optimized model not found. Start convertion ...")
            url = 'https://storage.googleapis.com/sfr-vision-language-research/BLIP/demo.jpg'
            response = requests.get(url)
            if response.status_code != 200:
                print('Failed to download file:', response.status_code)
                sys.exit(1)

            if not os.path.exists("./data/sample/demo.jpg"):
                with open('./data/sample/demo.jpg', 'wb') as file:
                    file.write(response.content)

            raw_image = Image.open("./data/sample/demo.jpg").convert("RGB")
            question = "how many dogs are in the picture?"
            inputs = self.processor(raw_image, question, return_tensors="pt")
        else:
            print("OV optimized model found. Skipping convertion ...")

        if not blip_vision_path.exists():
            print("Converting BLIP vision model ...")
            with torch.no_grad():
                ov_vision_model = ov.convert_model(
                    vision_model, example_input=inputs["pixel_values"])
            ov.save_model(ov_vision_model, blip_vision_path)

        if not text_encoder_path.exists():
            print("Converting BLIP text encoder model ...")
            vision_outputs = vision_model(inputs["pixel_values"])
            image_embeds = vision_outputs[0]
            image_attention_mask = torch.ones(
                image_embeds.size()[:-1], dtype=torch.long)
            input_dict = {
                "input_ids": inputs["input_ids"],
                "attention_mask": inputs["attention_mask"],
                "encoder_hidden_states": image_embeds,
                "encoder_attention_mask": image_attention_mask,
            }
            # export PyTorch model
            with torch.no_grad():
                ov_text_encoder = ov.convert_model(
                    text_encoder, example_input=input_dict)
            # save model on disk for next usages
            ov.save_model(ov_text_encoder, text_encoder_path)

        if not text_decoder_path.exists():
            print("Converting BLIP text decoder model ...")
            input_ids = torch.tensor([[30522]])  # begin of sequence token id
            # attention mask for input_ids
            attention_mask = torch.tensor([[1]])
            # encoder last hidden state from text_encoder
            encoder_hidden_states = torch.rand((1, 10, 768))
            # attention mask for encoder hidden states
            encoder_attention_mask = torch.ones((1, 10), dtype=torch.long)

            input_dict = {
                "input_ids": input_ids,
                "attention_mask": attention_mask,
                "encoder_hidden_states": encoder_hidden_states,
                "encoder_attention_mask": encoder_attention_mask,
            }
            text_decoder_outs = text_decoder(**input_dict)
            # extend input dictionary with hidden states from previous step
            input_dict["past_key_values"] = text_decoder_outs["past_key_values"]

            text_decoder.config.torchscript = True
            with torch.no_grad():
                ov_text_decoder = ov.convert_model(
                    text_decoder, example_input=input_dict)
            # save model on disk for next usages
            ov.save_model(ov_text_decoder, text_decoder_path)

        print(f"Loading model on device: {device}")
        ov_vision_model = self.core.compile_model(blip_vision_path, device)
        ov_text_encoder = self.core.compile_model(text_encoder_path, device)
        ov_text_decoder_with_past = self.core.compile_model(
            text_decoder_path, device)
        text_decoder.forward = partial(
            text_decoder_forward, ov_text_decoder_with_past=ov_text_decoder_with_past)
        return OVBlipModel(self.model.config, self.model.decoder_start_token_id, ov_vision_model, ov_text_encoder, text_decoder)

    def _yolo_world_inference(self, image, classes=["car", "bus", "bicycle"], imgsz=640, debug=False):
        yolo_world_results = []
        data = None
        letterbox_img, scale, new_size = letterbox_image(image, (imgsz, imgsz))
        offset_y = imgsz - min(new_size)
        self.yolo_world.set_classes(classes)
        try:
            results = self.yolo_world.predict(letterbox_img)
            if results and isinstance(results, list) and len(results) > 0:
                first_result = results[0]
                if first_result is not None and hasattr(first_result, "boxes") and first_result.boxes is not None:
                    if hasattr(first_result.boxes, "xyxy") and first_result.boxes.xyxy is not None:
                        data = first_result
                        bbox_data = [box.numpy() for box in data.boxes.xyxy]
                        formatted_bbox = []
                        for bbox in bbox_data:
                            bbox[1] = bbox[1] - offset_y / 2
                            bbox[3] = bbox[3] - offset_y / 2
                            bbox /= scale
                            formatted_bbox.append(bbox)

                        for i, bbox in enumerate(formatted_bbox):
                            coordinates = [int(bbox[0]), int(bbox[1]), int(bbox[2]), int(bbox[3])]
                            cropped_image = crop_image(image, coordinates)
                            yolo_world_results.append(cropped_image)
                            if debug:
                                os.makedirs("./data/temp/debug", exist_ok=True)
                                now = datetime.now()
                                timestamp = now.strftime("%Y-%m-%d_%H-%M-%S")
                                cv2.imwrite(f"./data/temp/debug/image_{i}_{timestamp}.jpg", cropped_image)
            return yolo_world_results
        except Exception as e:
            print(f"Error during YOLO inference: {e}")
            return None
        

    def _fastsam_inference(self, image, retina_masks=True, imgsz=640, conf=0.75, iou=0.9, debug=False):
        fastsam_results = []
        data = None
        letterbox_img, scale, new_size = letterbox_image(image, (imgsz, imgsz))
        offset_y = imgsz - min(new_size)
        try:
            results = self.fastsam(
                letterbox_img,
                device="cpu",
                retina_masks=retina_masks,
                imgsz=imgsz,
                conf=conf,
                iou=iou
            )
            if results and isinstance(results, list) and len(results) > 0:
                first_result = results[0]
                if first_result is not None and hasattr(first_result, "boxes") and first_result.boxes is not None:
                    if hasattr(first_result.boxes, "xyxy") and first_result.boxes.xyxy is not None:
                        data = first_result
                        bbox_data = [box.numpy() for box in data.boxes.xyxy]
                        formatted_bbox = []
                        for bbox in bbox_data:
                            bbox[1] = bbox[1] - offset_y/2
                            bbox[3] = bbox[3] - offset_y/2
                            bbox /= scale
                            formatted_bbox.append(bbox)

                        for i, bbox in enumerate(formatted_bbox):
                            coordinates = [int(bbox[0]), int(bbox[1]),
                                        int(bbox[2]), int(bbox[3])]
                            cropped_image = crop_image(image, coordinates)
                            fastsam_results.append(cropped_image)
                            if debug:
                                os.makedirs("./data/temp/debug", exist_ok=True)
                                cv2.imwrite(
                                    f"./data/temp/debug/image_{i}.jpg", cropped_image)
            return fastsam_results
        except Exception as e:
            print(f"Error during FastSAM inference: {e}")
            return None
        

    def _filter_captions(self, captions: list):
        captions_list = list(set(captions))
        constraint_captions = [
            'blurry',
            'ghost',
            'reflection'
        ]
        filtered_captions = [
            caption for caption in captions_list if caption not in constraint_captions]
        return ', '.join(filtered_captions)

    def inference(self, frame_data: list, query: str):
        captions = []
        results = []
        print(f"Running image captioning on {len(frame_data)} images")
        for frame in frame_data:
            start = time.perf_counter()
            inference_results = self._yolo_world_inference(
                frame['video_frame'])
            # inference_results = self._fastsam_inference(frame['video_frame'])
            for image in inference_results:
                inputs = self.processor(
                    image, return_tensors="pt")
                output = self.ov_model.generate_caption(
                    **inputs, max_length=20)
                caption = self.processor.decode(
                    output[0], skip_special_tokens=True)
                print(
                    f"Answer: {caption}. Inference time: {time.perf_counter() - start:.2} secs.")
                captions.append(caption)

            filtered_captions = self._filter_captions(captions)
            print(filtered_captions)
            results.append(
                {
                    "captions": filtered_captions,
                    "metadatas": {
                        "video_path": frame['video_path'],
                        "timestamp": frame['timestamp']
                    }
                }
            )
        return results

    def test_generate_caption(self):
        raw_image = Image.open("./data/sample/demo.jpg").convert("RGB")
        question = "how many dogs are in the picture?"
        inputs = self.processor(raw_image, question, return_tensors="pt")
        for i in range(10):
            start = time.perf_counter()
            out = self.ov_model.generate_caption(
                inputs["pixel_values"], max_length=20)
            caption = self.processor.decode(out[0], skip_special_tokens=True)
            print(
                f"Caption: {caption}. Inference time: {time.perf_counter() - start:.2} secs.")

class FaceDataPipeline:
    QUEUE_SIZE = 16

    def __init__(self):
        core = ov.Core()
        current_dir = os.getcwd()
        #Face Detection 
        m_fd = os.path.join(current_dir,"data/model/facial_recognition/face-detection-retail-0004.xml")
        fd_input_size = (0,0)
        t_fd = 0.6
        exp_r_fd = 1.15
        device_fd = DEVICE
        self.face_detector = FaceDetector(core, m_fd,
                                          fd_input_size,
                                          confidence_threshold=t_fd,
                                          roi_scale_factor=exp_r_fd)
        
        #Landmarks Detector
        m_lm = os.path.join(current_dir,"data/model/facial_recognition/landmarks-regression-retail-0009.xml")
        self.landmarks_detector = LandmarksDetector(core,m_lm)
        device_lm = DEVICE

        self.face_detector.deploy(device_fd)
        self.landmarks_detector.deploy(device_lm, self.QUEUE_SIZE)


    def process(self, frame):
        rois = self.face_detector.infer((frame,))
        if self.QUEUE_SIZE < len(rois):
            rois = rois[:self.QUEUE_SIZE]

        landmarks = self.landmarks_detector.infer((frame, rois))
        if len(landmarks) != 0:
            face_landmarks = landmarks[0].flatten().tolist()
        else:
            face_landmarks = []

        return face_landmarks

    def inference(self, frame_data: list):
        results = []
        print(f"Running face detection on {len(frame_data)}")
        for frame in frame_data:
            start = time.perf_counter()
            frame['video_frame'] = cv2.cvtColor(frame['video_frame'],cv2.COLOR_BGR2RGB)
            
            face_landmarks = self.process(frame['video_frame'])
            
            if len(face_landmarks) != 0:
                print(f"Face detected. Inference time: {time.perf_counter() - start:.2} secs.")
                results.append(
                    {
                        "metadatas": {
                            "video_path": frame['video_path'],
                            "timestamp": frame['timestamp']
                        },
                        "face_landmarks" : face_landmarks
                    }
                )
            else:
                print(f"No Face detected. Inference time: {time.perf_counter() - start:.2} secs.")
        return results