# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import os
import cv2
import logging
from pathlib import Path

import torch
import openvino as ov
import supervision as sv
from ultralytics import FastSAM
from ultralytics.models.fastsam import FastSAMPredictor
from worker_common import (
    instance_data_dir,
    migrate_legacy_models_dir,
    models_dir,
    openvino_compile_config,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Debug images (debug=True) are per-instance output, so they go under the instance's data dir.
_RESULTS_DIR = instance_data_dir(".") / "results"

# Weights live under models_dir() so "Clear model cache" finds them; the worker dir is only used
# to migrate the legacy ./models/<model_name>/ copy.
_WORKER_DIR = Path(__file__).resolve().parent.parent


class OVWrapper:
    def __init__(self, ov_model, device="CPU", stride=32, ov_config={}) -> None:
        core = ov.Core()
        logger.info(f"Compiling model with device: {device}")
        self.model = core.compile_model(ov_model, device, ov_config)
        self.stride = stride
        self.format = "openvino"
        self.pt = False
        self.fp16 = False
        self.names = {0: "object"}

    def __call__(self, im, **_):
        result = self.model(im)
        return torch.from_numpy(result[0]), torch.from_numpy(result[1])


class ObjectDetector:
    def __init__(self, model_name="FastSAM-s", device="CPU", imgsz=640, img_path="./data/coco_bike.jpg") -> None:
        self.model_name = model_name
        self.device = device
        self.imgsz = imgsz
        self.img_path = img_path

        if not Path(img_path).exists():
            raise FileNotFoundError(
                f"Required warm-up image not found: {img_path}")

        model_dir = models_dir("robotics-ai", model_name)
        migration_msg = migrate_legacy_models_dir(
            _WORKER_DIR / "models" / model_name, model_dir
        )
        if migration_msg:
            logger.info(migration_msg)
        model_dir.mkdir(parents=True, exist_ok=True)

        self.model = FastSAM(str(model_dir / f"{model_name}.pt"))
        self.ov_model_path = model_dir / f"{model_name}_openvino_model" / f"{model_name}.xml"

        self._init_ov_predictor(device=device)
        overrides = dict(
            conf=0.25,
            task="segment",
            mode="predict",
            model=str(model_dir / f"{model_name}.pt"),
            save=False,
            imgsz=self.imgsz
        )
        self.predictor = FastSAMPredictor(overrides=overrides)

    def _convert_model(self, dynamic=False):
        if not self.ov_model_path.exists():
            logger.info(
                f"Exporting model to OpenVINO format, dynamic: {dynamic} ...")
            self.model.export(
                format="openvino",
                dynamic=dynamic,
                half=True,
                imgsz=self.imgsz
            )
            logger.info("Model exported successfully.")
        else:
            logger.info("OpenVINO model already exists. Skipping export.")

    def _init_ov_predictor(self, device="CPU"):
        logger.info(f"Initializing model on device: {device} ...")
        self._convert_model()

        logger.info("Running model warm-up ...")
        self.model(
            self.img_path,
            device="cpu",
            retina_masks=True,
            imgsz=self.imgsz,
            conf=0.6,
            iou=0.9
        )

        logger.info("Patching model predictor to run on OpenVINO ...")
        core = ov.Core()
        available_devices = core.available_devices
        # AUTO is OpenVINO's own device selection: never listed, always there.
        if device != "AUTO" and device.split(".")[0] not in available_devices:
            logger.warning(
                f"Requested device '{device}' is not available. Available devices: {available_devices}. Falling back to 'CPU'.")
            device = "CPU"

        # On whichever GPU runs the model, AUTO's pick included.
        ov_config = openvino_compile_config(device, gpu={"GPU_DISABLE_WINOGRAD_CONVOLUTION": "YES"})
        if ov_config:
            logger.warning("Disabling Winograd convolution for GPU device.")

        logger.info("Compiling OV model ...")
        wrapped_model = OVWrapper(
            self.ov_model_path,
            device=device,
            stride=self.model.predictor.model.stride,
            ov_config=ov_config
        )
        self.model.predictor.model = wrapped_model

    def inference(self, source, debug=False):
        if isinstance(source, str) and os.path.isfile(source):
            image_array = cv2.imread(source)
        else:
            image_array = source

        results = self.model(
            image_array,
            retina_masks=True,
            imgsz=self.imgsz,
            conf=0.6,
            iou=0.9
        )[0]

        detections = sv.Detections.from_ultralytics(results)
        logger.info(f"Detections: {len(detections)} objects found.")

        detection_results = {}
        for i, box in enumerate(detections.xyxy):
            cropped_img = image_array[int(box[1]):int(
                box[3]), int(box[0]):int(box[2])]
            detection_results[f"object_{i}"] = cropped_img

        if debug:
            bounding_box_annotator = sv.BoxAnnotator()
            label_annotator = sv.LabelAnnotator()

            annotated_image = bounding_box_annotator.annotate(
                scene=image_array.copy(), detections=detections)
            annotated_image = label_annotator.annotate(
                scene=annotated_image, detections=detections)

            _RESULTS_DIR.mkdir(parents=True, exist_ok=True)
            out_path = _RESULTS_DIR / f"detections_{self.model_name}.jpg"
            cv2.imwrite(str(out_path), annotated_image)
            logger.info(f"Annotated image saved to {out_path}")

        return results

    def _is_within_bbox(self, box, bboxes):
        x1, y1, x2, y2 = box
        for bbox in bboxes:
            bx1, by1, bx2, by2 = bbox
            if x1 >= bx1 and y1 >= by1 and x2 <= bx2 and y2 <= by2:
                return True
        return False

    def inference_with_bboxes(self, source, bboxes, debug=False):
        if isinstance(source, str) and os.path.isfile(source):
            image_array = cv2.imread(source)
        else:
            image_array = source

        results = self.model(
            image_array,
            retina_masks=True,
            imgsz=self.imgsz,
            conf=0.75,
            iou=0.9
        )[0]

        detections = sv.Detections.from_ultralytics(results)
        logger.info(f"Detections: {len(detections)} objects found.")

        detection_results = {}
        detection_id = 0
        for i, box in enumerate(detections.xyxy):
            # Keep only boxes fully inside one of ``bboxes`` (xyxy).
            if not self._is_within_bbox(box, bboxes):
                continue
            cropped_img = image_array[int(box[1]):int(
                box[3]), int(box[0]):int(box[2])]

            mask = detections.mask[i] if detections.mask is not None else None
            detection_results[f"object_{detection_id}"] = {
                'image': cropped_img, 'box': box, 'mask': mask}
            detection_id += 1
            if debug:
                _RESULTS_DIR.mkdir(parents=True, exist_ok=True)
                crop_path = _RESULTS_DIR / f"cropped_{self.model_name}_{detection_id}.jpg"
                cv2.imwrite(str(crop_path), cropped_img)
                logger.info(f"Cropped image saved to {crop_path}")

        if debug:
            bounding_box_annotator = sv.BoxAnnotator()
            label_annotator = sv.LabelAnnotator()

            annotated_image = bounding_box_annotator.annotate(
                scene=image_array.copy(), detections=detections)
            annotated_image = label_annotator.annotate(
                scene=annotated_image, detections=detections)

            _RESULTS_DIR.mkdir(parents=True, exist_ok=True)
            out_path = _RESULTS_DIR / f"detections_{self.model_name}.jpg"
            cv2.imwrite(str(out_path), annotated_image)
            logger.info(f"Annotated image saved to {out_path}")

        return detection_results


if __name__ == "__main__":
    image = cv2.imread("./data/coco_bike.jpg")
    detector = ObjectDetector("FastSAM-s")
    bboxes = [[150, 100, 200, 200]]
    results = detector.inference_with_bboxes(image, bboxes)
    logger.info(f"Number of object found in bbox: {len(results)}")
